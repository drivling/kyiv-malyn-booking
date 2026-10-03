"""Оцінка розпізнавання замовлень на «золотих» даних: реальний текст людини → які страви мали вийти.

Формат файлу — JSONL, у кожному рядку обʼєкт з полем "type":
  {"type": "menu", "key": "2026-10-02", "items": [{"dish_id": 36, "name": "Пюре", "price": 45,
                                                    "role": "second", "synonyms": ["…"]}]}
  {"type": "case", "id": "…", "menu": "2026-10-02", "text": "пюре\\nкотлети", "expected": ["Пюре", "Котлети курячі"],
   "gold": true, "source": "prod-admin"}

«gold» — очікування підтверджені людиною (ручна правка адміном / перевірка при розборі); решта — «срібло»:
те, що бот колись підтвердив у групі й ніхто не заперечив (там можуть бути й старі помилки розпізнавання).

Необовʼязкові поля кейса:
  "leftover": true — частина тексту законно не є стравою з меню (посилання на чек, «віддам готівкою», страва,
                     якої сьогодні немає): нерозпізнаний залишок не робить кейс помилковим, важливі лише страви;
  "expected": []   — це НЕ замовлення (чат, «дерунів нема», заміна): правильно — не записати жодної страви;
  "note"           — чому очікування саме таке (напр. «бот колись віддав Овочевий мікс — хибно»).

Оцінюємо так, як працює слухач: спершу фільтр looks_like_order, потім parse_order на меню дня.

Запуск:
  python3 -m lunch.golden_eval lunch/golden/cases.jsonl
  python3 -m lunch.golden_eval lunch/golden/cases.jsonl --baseline e73f2c5   # порівняти зі старим матчером з git
  python3 -m lunch.golden_eval lunch/golden/cases.jsonl --no-synonyms        # лише нечіткий збіг, без синонімів
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
    leftover: bool = False
    note: str = ""


@dataclass
class Verdict:
    case: GoldenCase
    predicted: list[str]
    unmatched: list[str]
    ambiguous: dict[str, list[str]]

    @property
    def exact(self) -> bool:
        if Counter(self.predicted) != Counter(self.case.expected):
            return False
        return not self.unmatched or self.case.leftover

    @property
    def wrong(self) -> list[str]:
        """Страви, які розпізнали, але яких не мало бути (найгірший вид помилки: хибна страва в замовленні)."""
        return list((Counter(self.predicted) - Counter(self.case.expected)).elements())

    @property
    def missed(self) -> list[str]:
        """Страви, які мали бути, але не розпізнали (людина побачить «не розпізнав» і уточнить)."""
        return list((Counter(self.case.expected) - Counter(self.predicted)).elements())


def menu_rows(
    items: list[dict], *, synonyms: bool = True, normalize: Callable[[str], str] = normalize_dish_name
) -> list[MenuItemRow]:
    """Позиції меню з JSONL (як у вигрузці історії) → MenuItemRow, як їх бачить слухач.
    normalize — нормалізація того матчера, який оцінюємо (у старого коміту вона своя)."""
    rows: list[MenuItemRow] = []
    for i, it in enumerate(items, start=1):
        rows.append(
            MenuItemRow(
                id=i,
                day_id=1,
                name=it["name"],
                name_norm=normalize(it["name"]),
                price_uah=int(it.get("price", 0)),
                dish_id=int(it.get("dish_id", i)),
                tray_role=it.get("role", "second"),
                synonym_norms=tuple(normalize(s) for s in it.get("synonyms", [])) if synonyms else (),
            )
        )
    return rows


def load_golden(
    path: Path, *, synonyms: bool = True, normalize: Callable[[str], str] = normalize_dish_name
) -> tuple[dict[str, list[MenuItemRow]], list[GoldenCase]]:
    menus: dict[str, list[MenuItemRow]] = {}
    cases: list[GoldenCase] = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        obj = json.loads(ln)
        if obj.get("type") == "menu":
            # синонім належить одній страві (найновіший); тут кожен текст береться як є з вигрузки
            menus[obj["key"]] = menu_rows(obj["items"], synonyms=synonyms, normalize=normalize)
        elif obj.get("type") == "case":
            expected = list(obj["expected"])
            cases.append(
                GoldenCase(
                    id=obj["id"],
                    menu=obj["menu"],
                    text=obj["text"],
                    expected=expected,
                    gold=bool(obj.get("gold")),
                    source=obj.get("source", ""),
                    # не-замовлення: нерозпізнаний текст — правильна відповідь
                    leftover=bool(obj.get("leftover")) or not expected,
                    note=obj.get("note", ""),
                )
            )
    return menus, cases


ParseFn = Callable[[str, list[MenuItemRow]], object]
GateFn = Callable[[str], bool]


def run_cases(
    menus: dict[str, list[MenuItemRow]],
    cases: list[GoldenCase],
    parse: ParseFn,
    gate: Optional[GateFn] = None,
) -> list[Verdict]:
    """gate — фільтр слухача (looks_like_order): відкинутий текст не стає замовленням взагалі."""
    out: list[Verdict] = []
    for c in cases:
        if gate is not None and not gate(c.text):
            out.append(Verdict(case=c, predicted=[], unmatched=[], ambiguous={}))
            continue
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
    negatives = [v for v in verdicts if not v.case.expected]
    return {
        "cases": len(verdicts),
        "exact": exact,
        "exact_pct": round(100 * exact / n, 1),
        "with_wrong_dish": with_wrong,
        "with_missed_dish": with_missed,
        "ambiguous_asked": sum(bool(v.ambiguous) for v in verdicts),
        "dishes_expected": sum(len(v.case.expected) for v in verdicts),
        "dishes_wrong": sum(len(v.wrong) for v in verdicts),
        "dishes_missed": sum(len(v.missed) for v in verdicts),
        # не-замовлення (чат, «дерунів нема»), з яких бот записав би страви
        "negatives": len(negatives),
        "false_orders": sum(bool(v.predicted) for v in negatives),
    }


def load_baseline_parse(ref: str) -> tuple[ParseFn, GateFn, Callable[[str], str]]:
    """parse_order і looks_like_order зі старого коміту — разом з його db/util/parse_summary
    (нормалізація й розбиття тексту теж частина матчера). Файлу, якого на тому коміті ще не було,
    беремо поточний."""
    tmp = Path(tempfile.mkdtemp(prefix="lunch_baseline_"))
    pkg = tmp / "lunch_baseline"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    for name in ("db.py", "util.py", "parse_summary.py", "parse_order.py"):
        res = subprocess.run(
            ["git", "show", f"{ref}:backend/telegram-user/lunch/{name}"],
            capture_output=True, text=True, cwd=_ROOT.parent.parent,
        )
        if res.returncode != 0 and name == "parse_order.py":
            raise RuntimeError(f"git show {ref}: {res.stderr.strip()}")
        src = res.stdout if res.returncode == 0 else (Path(__file__).parent / name).read_text(encoding="utf-8")
        (pkg / name).write_text(src, encoding="utf-8")
    sys.path.insert(0, str(tmp))
    spec = importlib.util.spec_from_file_location("lunch_baseline.parse_order", pkg / "parse_order.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["lunch_baseline.parse_order"] = mod
    spec.loader.exec_module(mod)
    gate = getattr(mod, "looks_like_order", None) or (lambda _t: True)
    return mod.parse_order, gate, mod.normalize_dish_name  # type: ignore[attr-defined]


def _fmt(v: Verdict) -> str:
    bits = []
    if v.wrong:
        bits.append("ХИБНО: " + ", ".join(v.wrong))
    if v.missed:
        bits.append("НЕ ЗНАЙДЕНО: " + ", ".join(v.missed))
    if v.unmatched and not v.case.leftover:
        bits.append("не розпізнав: " + "; ".join(v.unmatched))
    if v.ambiguous:
        bits.append("запитали: " + "; ".join(f"«{k}»→{'/'.join(o)}" for k, o in v.ambiguous.items()))
    return f"[{v.case.id}{' gold' if v.case.gold else ''}] {v.case.text!r}\n      " + " | ".join(bits)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--baseline", help="git ref зі старим parse_order для порівняння")
    ap.add_argument("--no-synonyms", action="store_true", help="меню без синонімів: лише нечіткий збіг назв")
    ap.add_argument("--show", type=int, default=15, help="скільки розбіжностей показати")
    args = ap.parse_args(argv)

    from lunch.parse_order import looks_like_order, parse_order

    menus, cases = load_golden(Path(args.path), synonyms=not args.no_synonyms)
    new = run_cases(menus, cases, parse_order, gate=looks_like_order)
    print("НОВИЙ матчер:", summarize(new))
    if args.baseline:
        old_parse, old_gate, old_norm = load_baseline_parse(args.baseline)
        old_menus, _ = load_golden(Path(args.path), synonyms=not args.no_synonyms, normalize=old_norm)
        old = run_cases(old_menus, cases, old_parse, gate=old_gate)
        print(f"СТАРИЙ ({args.baseline}):", summarize(old))
        fixed = [n for o, n in zip(old, new) if n.exact and not o.exact]
        broken = [n for o, n in zip(old, new) if o.exact and not n.exact]
        print(f"виправлено: {len(fixed)}, зламано: {len(broken)}")
        for v in broken[: args.show]:
            print("  ЗЛАМАНО", _fmt(v))
    bad = [v for v in new if not v.exact]
    for v in bad[: args.show]:
        print(" ", _fmt(v))
    return 0


if __name__ == "__main__":
    sys.exit(main())
