"""Спільні утиліти: .env, нормалізація назв страв."""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path

# укр/рос розмовні відповідники після normalize (без ь/ї)
_TOKEN_SYNONYMS = {
    "овощи": "овочі",
    "овощ": "овоч",
    "бифштекс": "біфштекс",
    "бифтекс": "біфштекс",
    "печень": "печінкові",
    "печен": "печінкові",
    "печінкові": "печінкові",
    "оладьи": "оладки",
    "оладді": "оладки",
    "яйцом": "яйцем",
    "яйце": "яйцем",
    "гриле": "грилі",
    "гриль": "грилі",
    "огурец": "огірок",
    "огурцом": "огірком",
    "огурца": "огірка",
    "помидор": "помідор",
    "курица": "курка",
    "курицы": "курки",
    "грецкий": "грецький",
    "греческий": "грецький",
    "суп": "суп",
    "грибной": "грибний",
    "вареники": "вареники",
    "картошкой": "картоплею",
    "картошка": "картопля",
}


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
    """Нормалізація для fuzzy-match: lower, є/е, синоніми укр/рос, зайві пробіли."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", name).lower().strip()
    s = s.replace("ё", "е").replace("є", "е").replace("ї", "і").replace("ґ", "г")
    s = s.replace("ь", "").replace("ъ", "")
    s = s.replace("ʼ", "'").replace("’", "'").replace("`", "'").replace("´", "'")
    s = s.replace("'", "")
    s = re.sub(r"[«»\"„“]", " ", s)
    s = re.sub(r"[^\w\s]+", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    tokens = []
    for t in s.split():
        tokens.append(_TOKEN_SYNONYMS.get(t, t))
    return " ".join(tokens)


def guess_tray_role(name: str) -> str:
    """soup | second | salad за назвою (для нової страви в каталозі)."""
    n = normalize_dish_name(name)
    if any(k in n for k in ("суп", "борщ", "солянка", "розсольник", "юшка", "бульйон")):
        return "soup"
    if "салат" in n:
        return "salad"
    return "second"


def compute_tray_count(lines: list) -> int:
    """
    Лоток на людину:
    - soup: qty лотків
    - second: один спільний, якщо є хоч одне друге
    - salad: 0
    - одна страва в заказі → мінімум 1
    """
    if not lines:
        return 0
    soup_qty = 0
    has_second = False
    for line in lines:
        if isinstance(line, dict):
            role = (line.get("tray_role") or line.get("trayRole") or "second") or "second"
            qty = int(line.get("qty") or 1)
        else:
            role = getattr(line, "tray_role", None) or "second"
            qty = int(getattr(line, "qty", 1) or 1)
        if qty <= 0:
            continue
        if role == "soup":
            soup_qty += qty
        elif role == "second":
            has_second = True
    trays = soup_qty + (1 if has_second else 0)
    if len(lines) == 1:
        trays = max(trays, 1)
    return trays


def split_order_parts(text: str) -> list[str]:
    """Розбити текст замовлення на частини (|, ;, переноси, коми, 2+ пробіли)."""
    if not text or not text.strip():
        return []
    raw = text.strip()
    chunks = re.split(r"[|;\n]+", raw)
    parts: list[str] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        if "," in chunk:
            for sub in chunk.split(","):
                sub = sub.strip()
                if sub:
                    # «бифштекс с яйцом  печень оладьи»
                    for piece in re.split(r"\s{2,}", sub):
                        piece = piece.strip()
                        if piece:
                            parts.append(piece)
        else:
            for piece in re.split(r"\s{2,}", chunk):
                piece = piece.strip()
                if piece:
                    parts.append(piece)
    return parts
