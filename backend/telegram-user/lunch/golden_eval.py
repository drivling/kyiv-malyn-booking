"""Оцінка розпізнавання замовлень на «золотих» даних: реальний текст людини → які страви мали вийти.

Формат файлу — JSONL, у кожному рядку обʼєкт з полем "type":
  {"type": "menu", "key": "2026-10-02", "items": [{"dish_id": 36, "name": "Пюре", "price": 45,
                                                    "role": "second", "synonyms": ["…"]}]}
  {"type": "case", "id": "…", "menu": "2026-10-02", "text": "пюре\\nкотлети", "expected": ["Пюре", "Котлети курячі"],
   "gold": true, "source": "prod-admin"}

«gold» — очікування підтверджені людиною (ручна правка адміном / перевірка при розборі); решта — «срібло»:
те, що бот колись підтвердив у групі й ніхто не заперечив (там можуть бути й старі помилки розпізнавання).

Запуск:
  python3 -m lunch.golden_eval lunch/golden/cases.jsonl
  python3 -m lunch.golden_eval lunch/golden/cases.jsonl --baseline e73f2c5   # порівняти зі старим матчером з git
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.db import MenuItemRow, resolve_synonym_owners  # noqa: E402
from lunch.util import normalize_dish_name  # noqa: E402


@dataclass
class GoldenCase:
    id: str
    menu: str
    text: str
    expected: list[str]
    gold: bool = False
    source: str = ""


@dataclass
class Verdict:
    case: GoldenCase
    predicted: list[str]
    unmatched: list[str]
    ambiguous: dict[str, list[str]]

    @property
    def exact(self) -> bool:
        return Counter(self.predicted) == Counter(self.case.expected) and not self.unmatched

    @property
    def wrong(self) -> list[str]:
        """Страви, які розпізнали, але яких не мало бути (найгірший вид помилки: хибна страва в замовленні)."""
        return list((Counter(self.predicted) - Counter(self.case.expected)).elements())

    @property
    def missed(self) -> list[str]:
        """Страви, які мали бути, але не розпізнали (людина побачить «не розпізнав» і уточнить)."""
        return list((Counter(self.case.expected) - Counter(self.predicted)).elements())


def load_golden(path: Path) -> tuple[dict[str, list[MenuItemRow]], list[GoldenCase]]:
    menus: dict[str, list[MenuItemRow]] = {}
    cases: list[GoldenCase] = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        obj = json.loads(ln)
        if obj.get("type") == "menu":
            # синонім належить одній страві (найновіший); тут кожен текст береться як є з вигрузки
            rows: list[MenuItemRow] = []
            for i, it in enumerate(obj["items"], start=1):
                rows.append(
                    MenuItemRow(
                        id=i,
                        day_id=1,
                        name=it["name"],
                        name_norm=normalize_dish_name(it["name"]),
                        price_uah=int(it.get("price", 0)),
                        dish_id=int(it.get("dish_id", i)),
                        tray_role=it.get("role", "second"),
                        synonym_norms=tuple(normalize_dish_name(s) for s in it.get("synonyms", [])),
                    )
                )
            menus[obj["key"]] = rows
        elif obj.get("type") == "case":
            cases.append(
                GoldenCase(
                    id=obj["id"],
                    menu=obj["menu"],
                    text=obj["text"],
                    expected=list(obj["expected"]),
                    gold=bool(obj.get("gold")),
                    source=obj.get("source", ""),
                )
            )
    return menus, cases


ParseFn = Callable[[str, list[MenuItemRow]], object]


def run_cases(menus: dict[str, list[MenuItemRow]], cases: list[GoldenCase], parse: ParseFn) -> list[Verdict]:
    out: list[Verdict] = []
    for c in cases:
        r = parse(c.text, menus[c.menu])
        predicted: list[str] = []
        for line in r.lines:  # type: ignore[attr-defined]
            predicted.extend([line.raw_name] * int(line.qty))
        out.append(
            Verdict(
                case=c,
                predicted=predicted,
                unmatched=list(getattr(r, "unmatched", [])),
                ambiguous=dict(getattr(r, "ambiguous", {}) or {}),
            )
        )
    return out


def summarize(verdicts: list[Verdict]) -> dict[str, float]:
    n = len(verdicts) or 1
    exact = sum(v.exact for v in verdicts)
    with_wrong = sum(bool(v.wrong) for v in verdicts)
    with_missed = sum(bool(v.missed) for v in verdicts)
    return {
        "cases": len(verdicts),
        "exact": exact,
        "exact_pct": round(100 * exact / n, 1),
        "with_wrong_dish": with_wrong,
        "with_missed_dish": with_missed,
        "ambiguous_asked": sum(bool(v.ambiguous) for v in verdicts),
    }


def load_baseline_parse(ref: str) -> ParseFn:
    """parse_order зі старого коміту (імпорти .db/.util беремо поточні — вони сумісні)."""
    src = subprocess.run(
        ["git", "show", f"{ref}:backend/telegram-user/lunch/parse_order.py"],
        capture_output=True, text=True, check=True, cwd=_ROOT.parent.parent,
    ).stdout
    tmp = Path(tempfile.mkdtemp(prefix="lunch_baseline_"))
    pkg = tmp / "lunch_baseline"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    for name in ("db.py", "util.py", "parse_summary.py"):
        (pkg / name).write_text((Path(__file__).parent / name).read_text(encoding="utf-8"), encoding="utf-8")
    (pkg / "parse_order.py").write_text(src, encoding="utf-8")
    sys.path.insert(0, str(tmp))
    spec = importlib.util.spec_from_file_location("lunch_baseline.parse_order", pkg / "parse_order.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["lunch_baseline.parse_order"] = mod
    spec.loader.exec_module(mod)
    return mod.parse_order  # type: ignore[attr-defined]


def _fmt(v: Verdict) -> str:
    bits = []
    if v.wrong:
        bits.append("ХИБНО: " + ", ".join(v.wrong))
    if v.missed:
        bits.append("НЕ ЗНАЙДЕНО: " + ", ".join(v.missed))
    if v.ambiguous:
        bits.append("запитали: " + "; ".join(f"«{k}»→{'/'.join(o)}" for k, o in v.ambiguous.items()))
    return f"[{v.case.id}{' gold' if v.case.gold else ''}] {v.case.text!r}\n      " + " | ".join(bits)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--baseline", help="git ref зі старим parse_order для порівняння")
    ap.add_argument("--show", type=int, default=15, help="скільки розбіжностей показати")
    args = ap.parse_args(argv)

    from lunch.parse_order import parse_order

    menus, cases = load_golden(Path(args.path))
    new = run_cases(menus, cases, parse_order)
    print("НОВИЙ матчер:", summarize(new))
    if args.baseline:
        old = run_cases(menus, cases, load_baseline_parse(args.baseline))
        print(f"СТАРИЙ ({args.baseline}):", summarize(old))
    bad = [v for v in new if not v.exact]
    for v in bad[: args.show]:
        print(" ", _fmt(v))
    return 0


if __name__ == "__main__":
    sys.exit(main())
