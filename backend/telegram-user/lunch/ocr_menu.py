"""OCR меню з фото через Claude (Anthropic API) → список (назва, ціна).

Фото в групу шлють не лише з меню: чеки й скріни оплати, меми, список замовлень. Тому модель спершу
каже, чи це взагалі меню (`is_menu`), і лише тоді — страви. Відповідь — JSON за схемою
(structured outputs), без розбору довільного тексту.

Ключ — `ANTHROPIC_API_KEY` (кредити API, що входять у план Max, або куплені). Модель — `LUNCH_OCR_MODEL`
(лише `claude-*`), за замовчуванням Claude Opus 5.5.
"""

from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Optional, Sequence

DEFAULT_OCR_MODEL = "claude-opus-5-5"
# Справжнє меню їдальні — десятки позицій; кілька «страв з цінами» — це чек, а не меню
MIN_MENU_ITEMS = 5
# Ліміт Anthropic API на одне зображення в base64
MAX_IMAGE_BYTES = 5 * 1024 * 1024
# Відмова класифікатора безпеки → той самий запит на рекомендованій запасній моделі (на сервері)
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Скільки назв з каталогу підказуємо моделі (щоб писала страви так само, як у нас, без дублів у каталозі)
MAX_KNOWN_NAMES = 300

SYSTEM_PROMPT = """Ти розбираєш фото, яке надіслали в групу замовлення обідів у їдальні.

Спершу виріши, чи це меню їдальні: перелік страв із цінами (фото дошки, аркуша чи екрана).
Чек або скрін оплати, переказ, мем, фото їжі, список замовлень людей без цін — це НЕ меню:
тоді is_menu = false і items = [].

Якщо це меню — поверни всі страви з цінами:
- name — назва страви українською, як у меню, без ціни, ваги й номера; якщо страва є серед відомих
  назв, які дасть користувач, пиши саме ту назву, літера в літеру;
- price — ціна в гривнях, ціле число;
- пропусти заголовки (меню, дата, «перші страви», «салати»), позиції без ціни та нерозбірливі;
- не вигадуй страв, яких немає на фото."""

MENU_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_menu": {"type": "boolean"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "price": {"type": "integer"}},
                "required": ["name", "price"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_menu", "items"],
    "additionalProperties": False,
}


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


def menu_items_from_ocr(data: Any, *, min_items: int = MIN_MENU_ITEMS) -> list[tuple[str, int]]:
    """Страви, якщо фото — справді меню; інакше [] (чек, мем, кілька випадкових цін)."""
    if not isinstance(data, dict) or data.get("is_menu") is not True:
        return []
    items = parse_menu_items_payload(data)
    return items if len(items) >= min_items else []


def ocr_model_name(model: Optional[str] = None) -> str:
    """Модель з параметра чи LUNCH_OCR_MODEL; старе значення від OpenAI (gpt-…) ігноруємо."""
    name = (model or os.environ.get("LUNCH_OCR_MODEL") or "").strip()
    return name if name.startswith("claude-") else DEFAULT_OCR_MODEL


def _user_text(known_names: Sequence[str]) -> str:
    names = [n.strip() for n in known_names if n and n.strip()][:MAX_KNOWN_NAMES]
    if not names:
        return "Розпізнай фото."
    return "Розпізнай фото.\n\nВідомі назви страв (пиши саме так, якщо страва є на фото):\n" + "\n".join(names)


async def ocr_menu_from_image_bytes(
    image_bytes: bytes,
    *,
    mime: str = "image/jpeg",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    known_names: Sequence[str] = (),
    client: Any = None,
) -> tuple[list[tuple[str, int]], dict[str, Any]]:
    """
    Розпізнати меню. Повертає (items, raw_json); items == [] — це не меню (або замало позицій).
    Потребує ANTHROPIC_API_KEY. client — підміна AsyncAnthropic у тестах.
    """
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise RuntimeError("фото більше 5 МБ — надішли стиснене")
    if client is None:
        from anthropic import AsyncAnthropic

        key = (api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY не встановлено")
        client = AsyncAnthropic(api_key=key)

    resp = await client.beta.messages.create(
        model=ocr_model_name(model),
        max_tokens=16000,
        betas=[_FALLBACK_BETA],
        fallbacks="default",
        system=SYSTEM_PROMPT,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": MENU_SCHEMA}},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime,
                            "data": base64.standard_b64encode(image_bytes).decode("ascii"),
                        },
                    },
                    {"type": "text", "text": _user_text(known_names)},
                ],
            }
        ],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("модель відмовилась розбирати фото")
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("відповідь моделі обрізано (max_tokens)")
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    raw = _extract_json(text)
    return menu_items_from_ocr(raw), raw


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
