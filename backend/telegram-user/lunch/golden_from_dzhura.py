"""Чернетка золотих кейсів з повідомлень групи («Джура») + історії обідів — для ручної перевірки.

  curl -H "Authorization: admin-authenticated" "$API/admin/lunch/history?from=2026-09-01&to=2026-10-02" > history.json
  curl -H "Authorization: admin-authenticated" "$API/admin/dzhura/chats/<id групи>/export?from=2026-09-01&to=2026-10-02" > dzhura.json
  python3 -m lunch.golden_from_dzhura history.json dzhura.json draft.jsonl

Чим це більше за `golden_from_history` (там лише підсумкові рядки замовлень із БД):
  * замовлення, яких у БД немає зовсім (слухач перезапускався, день закрито) — «unrecorded»;
  * текст до й після редагування повідомлення (у БД лежить один із них);
  * що бот відповів у групі (останню версію відповіді — після ручної правки адміна її редагують);
  * повідомлення-не-замовлення (чат, «дерунів нема», заміни) — кандидати в негативні кейси (expected: []).

Очікування в чернетці — лише підказка: рядки з БД → відповідь бота → поточний матчер. У полі "review"
перелічено, що не сходиться (БД ≠ матчер, бот ≠ БД, правлене повідомлення…). Кожен кейс треба переглянути
очима й виправити expected / додати "leftover" чи "note" (формат — див. golden_eval). Імен і Telegram-id тут
немає, але тексти — справжні: чернетку в репозиторій не комітимо, лише перевірений і знеособлений набір.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.golden_eval import menu_rows  # noqa: E402
from lunch.golden_from_history import convert  # noqa: E402
from lunch.parse_order import parse_order  # noqa: E402
from lunch.parse_payment import looks_like_card_number, parse_payment  # noqa: E402
from lunch.parse_summary import looks_like_day_summary  # noqa: E402

KYIV = ZoneInfo("Europe/Kyiv")
# «Імʼя, заказ:» + рядки «• ×2 Страва — 80 грн (40/шт)» (formatters.format_order_confirm)
_BOT_CONFIRM_RE = re.compile(r"^.+?, заказ:\n", re.S)
_BOT_LINE_RE = re.compile(r"^• (?:×(?P<qty>\d+) )?(?P<dish>.+?) — \d+ грн")


def kyiv_date(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(KYIV).date().isoformat()


def bot_confirm_dishes(text: str) -> list[str]:
    out: list[str] = []
    for ln in text.splitlines():
        m = _BOT_LINE_RE.match(ln)
        if m:
            out.extend([m["dish"]] * int(m["qty"] or 1))
    return out


def _same_text(a: str, b: str) -> bool:
    return re.sub(r"\s+", " ", a).strip().lower() == re.sub(r"\s+", " ", b).strip().lower()


def _order_dishes(order: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for ln in order.get("lines") or []:
        out.extend([ln["name"]] * int(ln.get("qty") or 1))
    return out


def build_draft(history: dict[str, Any], export: dict[str, Any]) -> list[dict[str, Any]]:
    menus_out = [r for r in convert(history) if r["type"] == "menu"]
    menus = {m["key"]: menu_rows(m["items"]) for m in menus_out}
    orders_by_day = {d["date"]: d.get("orders") or [] for d in history.get("days", [])}

    messages = export.get("messages") or []
    confirms: dict[str, str] = {}
    for m in messages:
        if m.get("isOutgoing") and m.get("replyToTgMessageId") and _BOT_CONFIRM_RE.match(m.get("text") or ""):
            confirms[m["replyToTgMessageId"]] = m["text"]  # остання відповідь на повідомлення

    cases: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    used_orders: set[int] = set()

    def add(day: str, cid: str, text: str, expected: list[str], source: str, review: list[str]) -> None:
        key = (day, re.sub(r"\s+", " ", text).strip().lower())
        if key in seen:
            return
        seen.add(key)
        now = parse_order(text, menus[day])
        now_dishes = [ln.raw_name for ln in now.lines for _ in range(int(ln.qty))]
        if Counter(now_dishes) != Counter(expected) or (expected and now.unmatched):
            review = [*review, f"матчер зараз: {now_dishes or '∅'}" + (f", не розпізнав {now.unmatched}" if now.unmatched else "")]
        cases.append(
            {"type": "case", "id": f"{day}#{cid}", "menu": day, "text": text, "expected": expected,
             "gold": False, "source": source, "review": review}
        )

    for m in messages:
        text = (m.get("text") or "").strip()
        if m.get("isOutgoing") or len(text) < 3 or m.get("deletedAt"):
            continue
        day = kyiv_date(m["sentAt"])
        if day not in menus:
            continue  # без точного меню дня оцінка недостовірна
        if looks_like_day_summary(text) or parse_payment(text) or looks_like_card_number(text):
            continue
        review: list[str] = ["повідомлення редагували"] if m.get("editedAt") else []
        order = next((o for o in reversed(orders_by_day.get(day, [])) if _same_text(o.get("rawText") or "", text)), None)
        bot = bot_confirm_dishes(confirms[m["tgMessageId"]]) if m["tgMessageId"] in confirms else None
        if order is not None:
            used_orders.add(order["id"])
            expected = _order_dishes(order)
            if order.get("unmatchedText") or any(ln.get("unavailable") for ln in order.get("lines") or []):
                review.append(f"у БД неповне: не розпізнано {order.get('unmatchedText')!r}")
            if bot is not None and Counter(bot) != Counter(expected):
                review.append(f"бот відповів: {bot}")
            source = "history-touched" if order.get("touchedAfterCreate") or order.get("trayCountManual") else "history-auto"
            add(day, f"o{order['id']}", text, expected, source, review)
        elif bot is not None:
            add(day, f"m{m['tgMessageId']}", text, bot, "bot-reply", [*review, "замовлення в БД немає (скасоване?)"])
        else:
            r = parse_order(text, menus[day])
            guess = [ln.raw_name for ln in r.lines for _ in range(int(ln.qty))]
            add(day, f"m{m['tgMessageId']}", text, guess, "unrecorded",
                [*review, "ні відповіді бота, ні замовлення: загублене замовлення чи чат?"])

    # Тексти з БД, яких серед повідомлень немає: версія до редагування, власне замовлення оператора з підсумку
    for day, orders in orders_by_day.items():
        if day not in menus:
            continue
        for o in orders:
            text = (o.get("rawText") or "").strip()
            if o["id"] in used_orders or not text:
                continue
            review = ["тексту немає серед повідомлень (до редагування / з підсумку оператора)"]
            if o.get("unmatchedText") or any(ln.get("unavailable") for ln in o.get("lines") or []):
                review.append(f"у БД неповне: не розпізнано {o.get('unmatchedText')!r}")
            source = "history-touched" if o.get("touchedAfterCreate") or o.get("trayCountManual") else "history-auto"
            add(day, f"o{o['id']}", text, _order_dishes(o), source, review)

    used_menus = {c["menu"] for c in cases}
    cases.sort(key=lambda c: c["id"])
    return [m for m in menus_out if m["key"] in used_menus] + cases


def main(argv: Optional[list[str]] = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 3:
        print(__doc__)
        return 2
    history = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    export = json.loads(Path(args[1]).read_text(encoding="utf-8"))
    rows = build_draft(history, export)
    Path(args[2]).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    cases = [r for r in rows if r["type"] == "case"]
    by_source = Counter(c["source"] for c in cases)
    print(
        f"днів з меню: {sum(r['type'] == 'menu' for r in rows)}, кейсів: {len(cases)} {dict(by_source)}, "
        f"на перегляд: {sum(bool(c['review']) for c in cases)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
