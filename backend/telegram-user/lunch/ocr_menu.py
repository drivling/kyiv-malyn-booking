"""Розбір фото й PDF з групи обідів через Claude (Anthropic API): меню, чек оплати чи щось інше.

У групу шлють не лише меню: чеки й скріни оплати, PDF-квитанції, меми, списки замовлень. Тому модель
спершу каже, що це (`kind`): `menu` → страви з цінами, `receipt` → сума переказу, `other` → нічого.
Відповідь — JSON за схемою (structured outputs), без розбору довільного тексту.

Ключ — `ANTHROPIC_API_KEY` (кредити API, що входять у план Max, або куплені). Моделей дві (обидві лише
`claude-*`): `LUNCH_OCR_MODEL` — дешева Claude Haiku 5.5, яка дивиться кожне фото й читає чеки, і
`LUNCH_MENU_MODEL` — Claude Opus 5.5, якою меню перечитується, щойно дешева сказала «це меню». Чому так:
порівняння на реальних фото 13 і 16 листопада 2026 (задача `ocr_compare`, `evidence.compare_day`) — суми
чеків Haiku прочитала як Opus (14 із 14), а в меню зсунула ціни на рядок: 16 хибних цін із 34 за день.

PDF-квитанції банків API не приймає як документ («The PDF specified was not valid» — вони захищені від
редагування), тому першу сторінку PDF малюємо картинкою (`pypdfium2`) і шлемо як фото. Ключ, не привʼязаний до одного воркспейсу (створений на рівні
організації), API приймає лише з ID воркспейсу — тоді `ANTHROPIC_WORKSPACE_ID` (`wrkspc_…`).
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Sequence

DEFAULT_OCR_MODEL = "claude-haiku-5-5"
# Меню читає дорога модель: дешева плутає, яка ціна до якого рядка (див. докстрінг)
DEFAULT_MENU_MODEL = "claude-opus-5-5"
# З чим порівнюємо дешеву модель на вимогу (задача ocr_compare): від дорогої до дешевої
COMPARE_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5")
# Ціна за 1 млн токенів (вхід, вихід), $ — лише для оцінки вартості в порівнянні моделей
MODEL_PRICES_USD = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.1, 0.5),
}
# Справжнє меню їдальні — десятки позицій; кілька «страв з цінами» — це чек, а не меню
MIN_MENU_ITEMS = 5
# Ліміт Anthropic API на одне зображення в base64; PDF-квитанція — сторінка-дві, більший файл нам не потрібен
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PDF_BYTES = 8 * 1024 * 1024
PDF_MIME = "application/pdf"
IMAGE_MIMES = ("image/jpeg", "image/png", "image/webp", "image/gif")
# Відмова класифікатора безпеки → той самий запит на рекомендованій запасній моделі (на сервері).
# Є не в усіх моделей: Haiku 5.5 параметр fallbacks не підтримує, їй його не шлемо.
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_FALLBACK_MODEL_PREFIXES = ("claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5-2")
# Скільки назв з каталогу підказуємо моделі (щоб писала страви так само, як у нас, без дублів у каталозі)
MAX_KNOWN_NAMES = 300

SYSTEM_PROMPT = """Ти розбираєш фото або PDF, яке надіслали в групу замовлення обідів у їдальні.

Спершу виріши, що це (поле kind):
- "menu" — меню їдальні: перелік страв із цінами (фото дошки, аркуша чи екрана);
- "receipt" — підтвердження оплати: квитанція або скрін одного успішного переказу чи платежу з банку
  (monobank, ПриватБанк, будь-який інший);
- "other" — усе інше: мем, фото їжі, список замовлень людей без цін, скрін листування, виписка з багатьма
  операціями, реквізити картки без переказу.

Якщо це меню — поверни в items усі страви з цінами:
- name — назва страви українською, як у меню, без ціни, ваги й номера; якщо страва є серед відомих
  назв, які дасть користувач, пиши саме ту назву, літера в літеру;
- price — ціна в гривнях, ціле число;
- пропусти заголовки (меню, дата, «перші страви», «салати»), позиції без ціни та нерозбірливі;
- не вигадуй страв, яких немає на фото.

Якщо це підтвердження оплати — поверни в amount суму переказу в гривнях, яку отримує одержувач: без
комісії банку (коли є і «сума», і «сума з комісією» чи «разом зі списанням» — бери суму без комісії).
Якщо операція неуспішна (відхилено, помилка, очікує підтвердження), сума не в гривнях або її не видно —
amount = 0.

Для kind не "menu" items = []; для kind не "receipt" amount = 0. Бери лише те, що видно в документі."""

SCAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["menu", "receipt", "other"]},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "price": {"type": "integer"}},
                "required": ["name", "price"],
                "additionalProperties": False,
            },
        },
        "amount": {"type": "number"},
    },
    "required": ["kind", "items", "amount"],
    "additionalProperties": False,
}


@dataclass
class MediaScan:
    """Що модель побачила у фото чи PDF."""

    kind: str  # menu | receipt | other
    items: list[tuple[str, int]] = field(default_factory=list)
    amount_uah: Optional[int] = None  # лише для чека, коли суму видно
    raw: dict[str, Any] = field(default_factory=dict)
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    # як файл пішов у запит: image | pdf-image (перша сторінка PDF картинкою) | pdf (документом)
    sent_as: str = ""

    @property
    def cost_usd(self) -> Optional[float]:
        price = MODEL_PRICES_USD.get(self.model)
        if not price:
            return None
        return round((self.input_tokens * price[0] + self.output_tokens * price[1]) / 1_000_000, 5)


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def parse_menu_items_payload(data: Any) -> list[tuple[str, int]]:
    """Нормалізувати відповідь у список (name, price_uah)."""
    if isinstance(data, str):
        data = _extract_json(data)
    items_raw = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items_raw, list):
        return []
    out: list[tuple[str, int]] = []
    for it in items_raw:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()
        price = it.get("price")
        try:
            price_i = int(round(float(price)))
        except (TypeError, ValueError):
            continue
        if name and price_i > 0:
            out.append((name, price_i))
    return out


def _is_menu(data: dict[str, Any]) -> bool:
    # `is_menu` — формат відповіді до появи чеків (лежить у старих LunchDay.parsedRawJson)
    return data.get("kind") == "menu" or data.get("is_menu") is True


def menu_items_from_ocr(data: Any, *, min_items: int = MIN_MENU_ITEMS) -> list[tuple[str, int]]:
    """Страви, якщо фото — справді меню; інакше [] (чек, мем, кілька випадкових цін)."""
    if not isinstance(data, dict) or not _is_menu(data):
        return []
    items = parse_menu_items_payload(data)
    return items if len(items) >= min_items else []


def receipt_amount(data: Any) -> Optional[int]:
    """Сума з чека в гривнях (ціла), якщо модель назвала це чеком і суму видно."""
    if not isinstance(data, dict) or data.get("kind") != "receipt":
        return None
    try:
        amount = float(data.get("amount") or 0)
    except (TypeError, ValueError):
        return None
    # обід — сотні гривень; мільйон у «чеку» — це номер рахунку чи помилка читання, а не сума
    if not 0 < amount < 100_000:
        return None
    return int(amount + 0.5)


def scan_from_raw(data: Any, *, model: str = "") -> MediaScan:
    """Відповідь моделі (або рядок журналу LunchMediaScan.rawJson) → MediaScan."""
    if isinstance(data, str):
        try:
            data = _extract_json(data)
        except ValueError:
            data = {}
    if not isinstance(data, dict):
        data = {}
    items = menu_items_from_ocr(data)
    if items:
        return MediaScan("menu", items=items, raw=data, model=model)
    amount = receipt_amount(data)
    if data.get("kind") == "receipt":
        return MediaScan("receipt", amount_uah=amount, raw=data, model=model)
    return MediaScan("other", raw=data, model=model)  # меню з 1–4 позицій — теж «інше»


def ocr_model_name(model: Optional[str] = None) -> str:
    """Модель з параметра чи LUNCH_OCR_MODEL; старе значення від OpenAI (gpt-…) ігноруємо."""
    name = (model or os.environ.get("LUNCH_OCR_MODEL") or "").strip()
    return name if name.startswith("claude-") else DEFAULT_OCR_MODEL


def menu_model_name(model: Optional[str] = None) -> str:
    """Модель, якою перечитуємо меню: параметр чи LUNCH_MENU_MODEL."""
    name = (model or os.environ.get("LUNCH_MENU_MODEL") or "").strip()
    return name if name.startswith("claude-") else DEFAULT_MENU_MODEL


def anthropic_client_headers() -> dict[str, str]:
    """Заголовок воркспейсу для ключа, не привʼязаного до воркспейсу (інакше 400 «must include the
    anthropic-workspace-id header»). Ключ із конкретного воркспейсу його не потребує."""
    workspace = (os.environ.get("ANTHROPIC_WORKSPACE_ID") or "").strip()
    return {"anthropic-workspace-id": workspace} if workspace else {}


def make_client(api_key: Optional[str] = None) -> Any:
    from anthropic import AsyncAnthropic

    key = (api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY не встановлено")
    return AsyncAnthropic(api_key=key, default_headers=anthropic_client_headers())


def _user_text(known_names: Sequence[str]) -> str:
    names = [n.strip() for n in known_names if n and n.strip()][:MAX_KNOWN_NAMES]
    if not names:
        return "Розбери документ."
    return "Розбери документ.\n\nВідомі назви страв (пиши саме так, якщо страва є в меню):\n" + "\n".join(names)


def sniff_mime(data: bytes) -> Optional[str]:
    """Що це за файл насправді (за першими байтами): Telegram-документ може мати будь-який заявлений mime."""
    head = data[:1024]
    if b"%PDF" in head:
        return PDF_MIME
    if head.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def pdf_first_page_jpeg(data: bytes, *, scale: float = 2.0) -> Optional[bytes]:
    """Перша сторінка PDF як JPEG (≈144 dpi). None — немає pypdfium2/Pillow або файл не малюється.
    Банківські квитанції захищені від редагування (owner password) — PDFium відкриває їх без пароля."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None
    try:
        pdf = pdfium.PdfDocument(data)
        try:
            if len(pdf) < 1:
                return None
            image = pdf[0].render(scale=scale).to_pil().convert("RGB")
        finally:
            pdf.close()
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=88)
        return buf.getvalue()
    except Exception:  # noqa: BLE001 — будь-яка помилка рендера → спробуємо надіслати документом
        return None


def _image_block(data: bytes, mime: str) -> dict[str, Any]:
    if len(data) > MAX_IMAGE_BYTES:
        raise RuntimeError("фото більше 5 МБ — надішли стиснене")
    b64 = base64.standard_b64encode(data).decode("ascii")
    return {"type": "image", "source": {"type": "base64", "media_type": mime if mime in IMAGE_MIMES else "image/jpeg", "data": b64}}


def _media_block(data: bytes, mime: str) -> tuple[dict[str, Any], str]:
    """Блок запиту для файлу і те, чим він став: image | pdf-image | pdf."""
    mime = (mime or "").lower()
    actual = sniff_mime(data)
    if actual == PDF_MIME or (mime == PDF_MIME and actual is None):
        if len(data) > MAX_PDF_BYTES:
            raise RuntimeError("PDF більший за 8 МБ")
        jpeg = pdf_first_page_jpeg(data)
        if jpeg is not None:
            return _image_block(jpeg, "image/jpeg"), "pdf-image"
        b64 = base64.standard_b64encode(data).decode("ascii")
        return {"type": "document", "source": {"type": "base64", "media_type": PDF_MIME, "data": b64}}, "pdf"
    # картинка, надіслана з mime PDF чи без нього, — за справжнім типом
    return _image_block(data, actual or mime), "image"


def pdf_diagnostics(data: bytes) -> str:
    """Без вмісту файлу: розмір, перші байти, чи зашифрований — щоб з логів було видно, чому API відмовив."""
    return f"pdf {len(data)} байт, початок {data[:8]!r}, encrypt={b'/Encrypt' in data}"


async def scan_media_bytes(
    data: bytes,
    *,
    mime: str = "image/jpeg",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    known_names: Sequence[str] = (),
    client: Any = None,
) -> MediaScan:
    """Розібрати фото або PDF: меню, чек чи інше. Потребує ANTHROPIC_API_KEY; client — підміна AsyncAnthropic у тестах."""
    block, sent_as = _media_block(data, mime)
    if client is None:
        client = make_client(api_key)
    name = ocr_model_name(model)
    request: dict[str, Any] = {
        "model": name,
        "max_tokens": 16000,
        "system": SYSTEM_PROMPT,
        "output_config": {"effort": "medium", "format": {"type": "json_schema", "schema": SCAN_SCHEMA}},
        "messages": [{"role": "user", "content": [block, {"type": "text", "text": _user_text(known_names)}]}],
    }
    try:
        if name.startswith(_FALLBACK_MODEL_PREFIXES):
            resp = await client.beta.messages.create(betas=[_FALLBACK_BETA], fallbacks="default", **request)
        else:
            resp = await client.messages.create(**request)
    except Exception as e:
        if sent_as == "pdf":
            raise RuntimeError(f"{e} [{pdf_diagnostics(data)}]") from e
        raise
    if resp.stop_reason == "refusal":
        raise RuntimeError("модель відмовилась розбирати документ")
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("відповідь моделі обрізано (max_tokens)")
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    scan = scan_from_raw(_extract_json(text), model=name)
    usage = getattr(resp, "usage", None)
    scan.input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    scan.output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    scan.sent_as = sent_as
    return scan


async def ocr_menu_from_image_bytes(image_bytes: bytes, **kwargs) -> tuple[list[tuple[str, int]], dict[str, Any]]:
    """Лише меню: (items, raw_json); items == [] — це не меню (або замало позицій)."""
    scan = await scan_media_bytes(image_bytes, **kwargs)
    return scan.items, scan.raw


async def ocr_menu_from_path(path: str | Path, **kwargs) -> tuple[list[tuple[str, int]], dict[str, Any]]:
    p = Path(path)
    data = p.read_bytes()
    suffix = p.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    if suffix in (".webp",):
        mime = "image/webp"
    return await ocr_menu_from_image_bytes(data, mime=mime, **kwargs)


def merge_menu_items(
    existing: Sequence[tuple[str, int]], recognized: Sequence[tuple[str, int]]
) -> list[tuple[str, int]]:
    """Меню з фото доливаємо в уже наявне меню дня, а не замінюємо його: меню буває на двох фото,
    а меню з адмінки не має стиратись фотографією. Та сама назва (без регістру) — береться нова ціна."""
    from .util import normalize_dish_name

    merged: dict[str, tuple[str, int]] = {}
    for name, price in [*existing, *recognized]:
        key = normalize_dish_name(name)
        if key:
            merged[key] = (merged.get(key, (name, price))[0], price)
    return list(merged.values())
