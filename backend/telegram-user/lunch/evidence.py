"""Докази оплати в групі обідів: фото й PDF чеків, посилання на квитанцію — і порівняння моделей.

Як люди платять (логи листопада 2026): пишуть замовлення, а слідом окремим повідомленням шлють скрін
переказу, PDF-квитанцію або посилання https://check.monobank.ua/p/…; дехто пише «віддам готівкою».
Раніше оператор на кожен чек тиснув «Оплатив» в адмінці. Тепер:

  * фото / PDF → один запит до моделі (`ocr_menu.scan_media_bytes`): меню, чек чи інше. Результат лягає
    в журнал `LunchMediaScan`, тож дозбір після паузи слухача й «Розібрати день» модель удруге не питають;
  * чек із сумою → оплата на цю суму (`source = 'receipt'`). Якщо людина вже написала «оплатив 150» (або
    оператор натиснув «Оплатив») на ту саму суму — чек її лише підтверджує, вдруге не зараховуємо;
  * посилання на чек → суму прочитати не можна (сторінка за капчею), тому зараховуємо весь поточний борг
    (`source = 'link'`, у тексті оплати — «суму не перевірено»). Чек прийшов раніше за замовлення —
    зарахуємо, коли замовлення з'явиться (`settle_pending_links`);
  * меню читають дві моделі: дешева (`LUNCH_OCR_MODEL`) впізнає, що це меню, дорога (`LUNCH_MENU_MODEL`)
    читає страви й ціни. У журнал лягає результат дорогої.

У групу про чек нічого не пишемо: «✅ Оплатив» з'являється правкою нашої відповіді на замовлення,
так само як від кнопки в адмінці.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import date, timezone
from typing import Any, Awaitable, Callable, Optional, Sequence

from .ocr_menu import (
    COMPARE_MODELS,
    IMAGE_MIMES,
    MAX_IMAGE_BYTES,
    MAX_PDF_BYTES,
    PDF_MIME,
    MediaScan,
    menu_model_name,
    merge_menu_items,
    scan_from_raw,
    scan_media_bytes,  # noqa: F401 — тести підміняють evidence.scan_media_bytes
)
from .order_reply import refresh_order_reply
from .util import normalize_dish_name

# Скільки нових фото/PDF розбираємо за один дозбір чи «Розібрати день»: запобіжник від витрат,
# якщо в групу накидали альбом фотографій
MAX_SCANS_PER_RUN = 12
COMPARE_MAX_MEDIA = 12

Scanner = Callable[..., Awaitable[MediaScan]]


def media_of(msg: Any) -> Optional[tuple[str, str]]:
    """(джерело, mime) для повідомлення з фото чи PDF; None — це не те, що ми розбираємо.
    Фото, надіслане «файлом» (без стиснення), теж фото."""
    if getattr(msg, "photo", None):
        return "photo", "image/jpeg"
    if not getattr(msg, "document", None):
        return None
    mime = (getattr(getattr(msg, "file", None), "mime_type", None) or "").lower()
    if mime == PDF_MIME:
        return "pdf", PDF_MIME
    if mime in IMAGE_MIMES and mime != "image/gif":
        return "photo", mime
    return None


async def download_bytes(msg: Any, mime: str) -> Optional[bytes]:
    """Вміст фото/PDF у пам'ять; None — завеликий файл або Telegram не віддав."""
    limit = MAX_PDF_BYTES if mime == PDF_MIME else MAX_IMAGE_BYTES
    size = getattr(getattr(msg, "file", None), "size", None)
    if size and int(size) > limit:
        return None
    data = await msg.download_media(file=bytes)
    if not data or len(data) > limit:
        return None
    return bytes(data)


@dataclass
class MediaOutcome:
    """Що зроблено з фото/PDF: для відповіді в групу (меню) і для звіту розбору."""

    scan: MediaScan
    source: str  # photo | pdf
    cached: bool = False  # результат із журналу, модель не питали
    menu_rows: list = field(default_factory=list)
    notices: list = field(default_factory=list)
    receipt: Optional[str] = None  # added | confirms | duplicate | no_amount
    participant_id: Optional[int] = None

    @property
    def note(self) -> str:
        if self.scan.kind == "menu":
            return f"меню: {len(self.scan.items)} позицій" + ("" if self.menu_rows else " (уже враховано)")
        if self.scan.kind == "receipt":
            amount = f"{self.scan.amount_uah} грн" if self.scan.amount_uah else "суму не видно"
            what = {
                "added": "зараховано",
                "confirms": "підтверджує вже зараховану оплату",
                "duplicate": "уже зараховано",
                "no_amount": "не зараховано",
            }.get(self.receipt or "", "")
            return f"чек ({self.source}): {amount}" + (f" — {what}" if what else "")
        return "фото без меню й чека"


async def scan_message(
    db: Any,
    msg: Any,
    day_id: int,
    *,
    uid: str,
    allow_model: bool = True,
    scan: Optional[Scanner] = None,
) -> Optional[tuple[MediaScan, str, bool]]:
    """(результат, джерело, чи з журналу) для фото/PDF. None — не медіа, завеликий файл або модель
    питати не можна (ліміт на прохід), а в журналі повідомлення ще немає."""
    media = media_of(msg)
    if not media:
        return None
    source, mime = media
    row = await db.get_media_scan(day_id, int(msg.id))
    if row and row["source"] != "link":
        return scan_from_raw(row["raw_json"], model=row["model"] or ""), source, True
    if not allow_model:
        return None
    data = await download_bytes(msg, mime)
    if data is None:
        return None
    scanner = scan or scan_media_bytes
    known = await db.catalog_dish_names()
    result = await scanner(data, mime=mime, known_names=known)
    # Дешева модель лише впізнає меню; ціни в ньому вона плутає, тому меню перечитує дорога.
    menu_model = menu_model_name()
    if result.kind == "menu" and result.model != menu_model:
        result = await scanner(data, mime=mime, known_names=known, model=menu_model)
    await db.save_media_scan(
        day_id,
        int(msg.id),
        sender_tg_id=uid or None,
        source=source,
        kind=result.kind,
        amount_uah=result.amount_uah,
        model=result.model,
        raw=result.raw,
    )
    return result, source, False


async def apply_menu(db: Any, day_id: int, message_id: int, scan: MediaScan) -> tuple[list, list]:
    """Долити меню з фото в меню дня (друге фото, меню з адмінки не стираються)."""
    existing = [(m.name, m.price_uah) for m in await db.list_menu_items(day_id)]
    menu_rows = await db.replace_menu(
        day_id,
        merge_menu_items(existing, scan.items),
        menu_message_id=message_id,
        parsed_raw=scan.raw,
    )
    notices = await db.sync_orders_after_menu(day_id)
    return menu_rows, notices


async def apply_receipt(db: Any, day_id: int, pid: int, *, amount_uah: Optional[int], message_id: int, source: str) -> str:
    """Зарахувати суму з чека. added — нова оплата; confirms — така сама сума вже зарахована з чату чи
    адмінки; duplicate — це повідомлення вже зараховано; no_amount — суму не видно."""
    if not amount_uah:
        return "no_amount"
    if await db.payment_source_exists(day_id, message_id):
        return "duplicate"
    if await db.has_payment_of_amount(day_id, pid, amount_uah, ("text", "admin", "link")):
        return "confirms"
    await db.add_payment(
        day_id, pid, amount_uah, f"чек ({source}): {amount_uah} грн", source_message_id=message_id, source="receipt"
    )
    return "added"


async def settle_link(db: Any, day_id: int, pid: int, message_id: int, url: str = "") -> str:
    """Зарахувати посилання-чек: суми в ньому не видно, тож гасимо весь поточний борг людини.
    no_order — замовлення ще немає (зарахуємо, коли з'явиться); already_paid — боргу немає."""
    if await db.payment_source_exists(day_id, message_id):
        return "duplicate"
    ordered, _paid, debt = await db.participant_balance(day_id, pid)
    if ordered <= 0:
        return "no_order"
    if debt <= 0:
        return "already_paid"
    text = "чек за посиланням (суму не перевірено)" + (f": {url}" if url else "")
    await db.add_payment(day_id, pid, debt, text, source_message_id=message_id, source="link")
    return "added"


async def apply_link(db: Any, day_id: int, pid: int, *, uid: str, message_id: int, url: str) -> str:
    await db.save_media_scan(
        day_id, message_id, sender_tg_id=uid or None, source="link", kind="receipt", raw={"url": url}
    )
    return await settle_link(db, day_id, pid, message_id, url)


async def settle_pending_links(db: Any, day_id: int, pid: int, uid: str) -> int:
    """Після появи замовлення: людина могла надіслати посилання на чек раніше."""
    added = 0
    for message_id in await db.pending_link_receipts(day_id, uid):
        row = await db.get_media_scan(day_id, message_id)
        url = (scan_raw_url(row["raw_json"]) if row else "") or ""
        if await settle_link(db, day_id, pid, message_id, url) == "added":
            added += 1
    return added


def scan_raw_url(raw_json: Optional[str]) -> str:
    import json

    try:
        data = json.loads(raw_json or "{}")
    except ValueError:
        return ""
    return str(data.get("url") or "") if isinstance(data, dict) else ""


async def handle_media_message(
    db: Any,
    msg: Any,
    day_id: int,
    *,
    uid: str,
    name: str,
    username: Optional[str],
    allow_model: bool = True,
    allow_menu: bool = True,
    notify: bool = True,
    scan: Optional[Scanner] = None,
) -> Optional[MediaOutcome]:
    """Фото/PDF з групи: розпізнати (або взяти з журналу) і зробити потрібне — долити меню чи зарахувати чек.
    allow_menu=False — меню не чіпаємо («Розібрати день»). Меню з журналу вдруге не застосовуємо: воно вже в базі.
    notify — після зарахування чека поправити нашу відповідь на замовлення («✅ Оплатив»)."""
    scanned = await scan_message(db, msg, day_id, uid=uid, allow_model=allow_model, scan=scan)
    if scanned is None:
        return None
    result, source, cached = scanned
    outcome = MediaOutcome(result, source, cached=cached)
    if result.kind == "menu":
        if allow_menu and not cached:
            outcome.menu_rows, outcome.notices = await apply_menu(db, day_id, int(msg.id), result)
        return outcome
    if result.kind == "receipt":
        if not uid:
            outcome.receipt = "no_amount"
            return outcome
        pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
        outcome.participant_id = pid
        outcome.receipt = await apply_receipt(
            db, day_id, pid, amount_uah=result.amount_uah, message_id=int(msg.id), source=source
        )
        if outcome.receipt == "added" and notify:
            await refresh_order_reply(db, day_id, pid)
    return outcome


# ---------------- порівняння моделей на реальних фото дня ----------------


def menu_diff(base: Sequence[tuple[str, int]], other: Sequence[tuple[str, int]]) -> dict[str, list]:
    """Чим меню другої моделі відрізняється від еталонного: назви (за нормалізованим ключем) і ціни."""
    a = {normalize_dish_name(n): (n, p) for n, p in base if normalize_dish_name(n)}
    b = {normalize_dish_name(n): (n, p) for n, p in other if normalize_dish_name(n)}
    return {
        "missing": [a[k][0] for k in a if k not in b],
        "extra": [b[k][0] for k in b if k not in a],
        "prices": [{"name": a[k][0], "base": a[k][1], "other": b[k][1]} for k in a if k in b and a[k][1] != b[k][1]],
    }


def _same_result(base: Optional[MediaScan], other: Optional[MediaScan]) -> bool:
    if base is None or other is None or base.kind != other.kind:
        return False
    if base.kind == "receipt":
        return base.amount_uah == other.amount_uah
    if base.kind == "menu":
        d = menu_diff(base.items, other.items)
        return not (d["missing"] or d["extra"] or d["prices"])
    return True


async def compare_day(
    client: Any,
    entity: Any,
    db: Any,
    *,
    day: date,
    models: Sequence[str] = COMPARE_MODELS,
    scan: Optional[Scanner] = None,
    log: Callable[[str], None] = print,
) -> dict[str, Any]:
    """Прогнати всі фото й PDF з групи за день через кілька моделей і показати, де вони розходяться.
    Нічого не змінює: ні меню, ні оплат, ні журналу. Еталон — перша модель у списку (найдорожча)."""
    from .reparse_day import KYIV, kyiv_day_bounds

    models = [m for m in models if m.startswith("claude-")] or list(COMPARE_MODELS)
    start, end = kyiv_day_bounds(day)
    start_utc, end_utc = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    picked: list[tuple[Any, str, str]] = []
    async for msg in client.iter_messages(entity, limit=500):
        if not msg.date:
            continue
        md = msg.date if msg.date.tzinfo else msg.date.replace(tzinfo=timezone.utc)
        if md > end_utc:
            continue
        if md < start_utc:
            break
        media = media_of(msg)
        if media:
            picked.append((msg, *media))
    picked.reverse()
    skipped = max(0, len(picked) - COMPARE_MAX_MEDIA)
    picked = picked[:COMPARE_MAX_MEDIA]
    known = await db.catalog_dish_names()

    async def one(model: str, data: bytes, mime: str) -> dict[str, Any]:
        t0 = time.monotonic()
        try:
            res = await (scan or scan_media_bytes)(data, mime=mime, model=model, known_names=known)
            return {"scan": res, "seconds": round(time.monotonic() - t0, 1), "error": None}
        except Exception as e:  # noqa: BLE001 — одна модель не повинна зірвати порівняння інших
            return {"scan": None, "seconds": round(time.monotonic() - t0, 1), "error": f"{type(e).__name__}: {e}"[:300]}

    totals = {m: {"media": 0, "menu": 0, "receipt": 0, "other": 0, "errors": 0, "agree": 0, "costUsd": 0.0, "seconds": 0.0} for m in models}
    rows: list[dict[str, Any]] = []
    for msg, source, mime in picked:
        data = await download_bytes(msg, mime)
        if data is None:
            skipped += 1
            continue
        results = await asyncio.gather(*(one(m, data, mime) for m in models))
        base: Optional[MediaScan] = results[0]["scan"]
        md = msg.date if msg.date.tzinfo else msg.date.replace(tzinfo=timezone.utc)
        row: dict[str, Any] = {"messageId": int(msg.id), "source": source, "time": md.astimezone(KYIV).strftime("%H:%M"), "results": []}
        parts: list[str] = []
        for model, r in zip(models, results):
            s: Optional[MediaScan] = r["scan"]
            t = totals[model]
            t["media"] += 1
            t["seconds"] += r["seconds"]
            entry: dict[str, Any] = {"model": model, "seconds": r["seconds"], "error": r["error"]}
            if s is None:
                t["errors"] += 1
                parts.append(f"{model}=помилка")
            else:
                t[s.kind] += 1
                t["costUsd"] += s.cost_usd or 0.0
                agree = _same_result(base, s)
                t["agree"] += 1 if agree else 0
                entry.update(
                    kind=s.kind,
                    items=len(s.items),
                    amountUah=s.amount_uah,
                    costUsd=s.cost_usd,
                    inputTokens=s.input_tokens,
                    outputTokens=s.output_tokens,
                    agree=agree,
                )
                if model != models[0] and base is not None and base.kind == "menu" and s.kind == "menu":
                    entry["menuDiff"] = menu_diff(base.items, s.items)
                parts.append(
                    f"{model}={s.kind}"
                    + (f"({len(s.items)})" if s.kind == "menu" else f"({s.amount_uah})" if s.kind == "receipt" else "")
                )
            row["results"].append(entry)
        rows.append(row)
        log(f"[lunch] ocr-compare {day.isoformat()} msg={msg.id} {source}: " + " ".join(parts))
        for entry in row["results"]:
            d = entry.get("menuDiff")
            if d and (d["missing"] or d["extra"] or d["prices"]):
                prices = [f"{p['name']} {p['base']}→{p['other']}" for p in d["prices"]]
                log(
                    f"[lunch] ocr-compare {day.isoformat()} msg={msg.id} {entry['model']} проти {models[0]}: "
                    f"немає {d['missing']}; зайві {d['extra']}; ціни {prices}"
                )
    for t in totals.values():
        t["costUsd"] = round(t["costUsd"], 4)
        t["seconds"] = round(t["seconds"], 1)
    summary = [{"model": m, **totals[m]} for m in models]
    log(f"[lunch] ocr-compare {day.isoformat()} підсумок: " + "; ".join(
        f"{s['model']}: збіглось {s['agree']}/{s['media']}, ${s['costUsd']}, {s['seconds']} с" for s in summary
    ))
    return {"date": day.isoformat(), "models": list(models), "baseline": models[0], "media": rows, "summary": summary, "skipped": skipped}
