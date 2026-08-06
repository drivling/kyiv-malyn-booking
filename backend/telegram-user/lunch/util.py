"""Спільні утиліти: .env, нормалізація назв страв."""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path


def load_dotenv() -> None:
    """Завантажити .env з telegram-user/, backend/ або cwd (не перезаписує існуючі env)."""
    roots = [
        Path(__file__).resolve().parent.parent,  # telegram-user
        Path(__file__).resolve().parent.parent.parent,  # backend
        Path.cwd(),
    ]
    for root in roots:
        env_path = root / ".env"
        if not env_path.is_file():
            continue
        with env_path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        break


def normalize_dish_name(name: str) -> str:
    """Нормалізація для fuzzy-match: lower, є/е, апострофи, зайві пробіли."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", name).lower().strip()
    s = s.replace("ё", "е").replace("є", "е").replace("ї", "і").replace("ґ", "г")
    s = s.replace("ь", "").replace("ъ", "")
    s = s.replace("ʼ", "'").replace("’", "'").replace("`", "'").replace("´", "'")
    s = s.replace("'", "")
    s = re.sub(r"[^\w\s]+", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def split_order_parts(text: str) -> list[str]:
    """Розбити текст замовлення на частини (|, ;, переноси, коми між стравами)."""
    if not text or not text.strip():
        return []
    raw = text.strip()
    # Спочатку по | ; і переносах
    chunks = re.split(r"[|;\n]+", raw)
    parts: list[str] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        # Коми: «пюре, котлети, салат»
        if "," in chunk:
            for sub in chunk.split(","):
                sub = sub.strip()
                if sub:
                    parts.append(sub)
        else:
            parts.append(chunk)
    return parts
