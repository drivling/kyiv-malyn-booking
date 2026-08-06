"""OCR меню з фото через OpenAI Vision → список {name, price}."""

from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Optional


SYSTEM_PROMPT = """Ти розпізнаєш меню їдальні з фото (українською або російською).
Поверни ТІЛЬКИ валідний JSON без markdown:
{"items":[{"name":"...","price":123}]}
Правила:
- name — назва страви як на меню (коротко, без ціни)
- price — ціна в гривнях, ціле число
- пропусти заголовки («Меню», дату, «перше/друге»)
- якщо ціни немає — пропусти позицію
- не вигадуй страви, яких немає на фото
"""


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def parse_menu_items_payload(data: Any) -> list[tuple[str, int]]:
    """Нормалізувати відповідь Vision у список (name, price_uah)."""
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


async def ocr_menu_from_image_bytes(
    image_bytes: bytes,
    *,
    mime: str = "image/jpeg",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> tuple[list[tuple[str, int]], dict[str, Any]]:
    """
    Розпізнати меню. Повертає (items, raw_json).
    Потребує OPENAI_API_KEY.
    """
    from openai import AsyncOpenAI

    key = (api_key or os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY не встановлено")
    model_name = (model or os.environ.get("LUNCH_OCR_MODEL") or "gpt-4o-mini").strip()

    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    client = AsyncOpenAI(api_key=key)
    resp = await client.chat.completions.create(
        model=model_name,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Розпізнай меню з цінами з цього фото."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    )
    content = (resp.choices[0].message.content or "").strip()
    raw = _extract_json(content)
    items = parse_menu_items_payload(raw)
    return items, raw


async def ocr_menu_from_path(path: str | Path, **kwargs) -> tuple[list[tuple[str, int]], dict[str, Any]]:
    p = Path(path)
    data = p.read_bytes()
    suffix = p.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    if suffix in (".webp",):
        mime = "image/webp"
    return await ocr_menu_from_image_bytes(data, mime=mime, **kwargs)
