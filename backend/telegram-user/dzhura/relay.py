"""
Джура · фаза 0 — чисті функції форматування для дубля в «Обране» (Saved Messages)
і для планування змін реакцій.

Навмисно без імпортів telethon/asyncpg: `python3 -m dzhura.test_relay` має бігти
на машині без цих залежностей. Усі Telethon-об'єкти розбираються у capture.py
і сюди приходять як прості значення.

Формат дубля (HTML, parse_mode='html' у outbound_loop):

    <b>Назва чату</b> · <a href="https://t.me/kostya">Костя Іванов</a> (@kostya) · #1234
    текст повідомлення
    ↩︎ у відповідь на: «перші 120 символів батьківського»

Реакція:

    <b>Назва чату</b> · <a href="…">Костя</a>: реакція ❤️ на ваше повідомлення «…»
"""

from __future__ import annotations

import html
import re
from datetime import datetime
from typing import Any, Iterable, Optional, Sequence

QUOTE_LIMIT = 120
RAW_JSON_LIMIT = 8_000

MEDIA_LABELS = {
    "photo": "[фото]",
    "video": "[відео]",
    "video_note": "[відеоповідомлення]",
    "voice": "[голосове]",
    "audio": "[аудіо]",
    "sticker": "[стікер]",
    "gif": "[gif]",
    "document": "[файл]",
    "contact": "[контакт]",
    "geo": "[геолокація]",
    "poll": "[опитування]",
    "other": "[медіа]",
}

_WS_RE = re.compile(r"\s+")


def html_escape(text: Optional[str]) -> str:
    """HTML-екранування тексту користувача (Telethon пропускає текст через html.unescape)."""
    return html.escape(text or "", quote=False)


def truncate(text: Optional[str], limit: int = QUOTE_LIMIT) -> str:
    """Стиснути пробіли/переноси в один пробіл і обрізати з «…»."""
    flat = _WS_RE.sub(" ", (text or "")).strip()
    if len(flat) <= limit:
        return flat
    return flat[: max(1, limit - 1)].rstrip() + "…"


def display_name(
    first: Optional[str],
    last: Optional[str],
    username: Optional[str],
    user_id: Optional[int],
) -> str:
    """Як показує Telegram: ім'я + прізвище, інакше @username, інакше id, інакше «Невідомий»."""
    full = " ".join(p.strip() for p in (first or "", last or "") if p and p.strip()).strip()
    if full:
        return full
    if username:
        return f"@{username.lstrip('@')}"
    if user_id:
        return str(user_id)
    return "Невідомий"


def person_link_html(
    first: Optional[str],
    last: Optional[str],
    username: Optional[str],
    user_id: Optional[int],
) -> str:
    """
    Клікабельне ім'я. З username — https://t.me/<username> (працює завжди);
    без — tg://user?id=<id> (стає mention лише якщо користувач у кеші сесії,
    інакше Telethon мовчки лишає plain text — прийнятно).
    """
    name = html_escape(display_name(first, last, username, user_id))
    uname = (username or "").lstrip("@").strip()
    if uname:
        return f'<a href="https://t.me/{html_escape(uname)}">{name}</a> (@{html_escape(uname)})'
    if user_id:
        return f'<a href="tg://user?id={int(user_id)}">{name}</a>'
    return name


def message_link(chat_kind: str, tg_chat_id: int, msg_id: int) -> Optional[str]:
    """Публічний лінк на повідомлення є лише в супергрупах: https://t.me/c/<channel_id>/<msg_id>."""
    if chat_kind != "supergroup":
        return None
    marked = int(tg_chat_id)
    if marked >= 0:
        return None
    channel_id = -marked - 1_000_000_000_000
    if channel_id <= 0:
        return None
    return f"https://t.me/c/{channel_id}/{int(msg_id)}"


def chat_label(kind: Optional[str], title: Optional[str]) -> str:
    """Заголовок дубля: для особистого чату — «Особисто» (ім'я вже є у відправнику), інакше назва групи."""
    if kind == "private":
        return "Особисто"
    return (title or "").strip() or "Чат"


def media_label(kind: Optional[str], file_name: Optional[str] = None) -> str:
    if not kind:
        return ""
    label = MEDIA_LABELS.get(kind, MEDIA_LABELS["other"])
    if kind == "document" and file_name:
        return f"[файл: {truncate(file_name, 60)}]"
    return label


def reaction_key(kind: str, value: Any = None) -> str:
    """
    Стабільний ключ реакції для БД:
      emoji  → сам емодзі ('❤️')
      custom → 'custom:<document_id>'
      paid   → 'paid'
    """
    if kind == "emoji":
        return str(value or "").strip() or "?"
    if kind == "custom":
        return f"custom:{value}"
    if kind == "paid":
        return "paid"
    return "?"


def reaction_label(key: str) -> str:
    """Як показати ключ реакції людині."""
    if not key or key == "?":
        return "реакцію"
    if key.startswith("custom:"):
        return "кастомну реакцію"
    if key == "paid":
        return "⭐ (платну реакцію)"
    return key


def reactions_counts(results: Iterable[Sequence[Any]]) -> dict[str, int]:
    """results: iterable of (key, count, chosen) → {key: count} без нулів."""
    out: dict[str, int] = {}
    for item in results:
        key, count = item[0], int(item[1] or 0)
        if count > 0 and key:
            out[str(key)] = out.get(str(key), 0) + count
    return out


def plan_reaction_changes(
    active: Sequence[Sequence[Any]],
    recent: Sequence[Sequence[Any]],
    results: Sequence[Sequence[Any]],
    private_other_id: Optional[int],
    me_id: Optional[int],
) -> tuple[list[dict[str, Any]], list[int]]:
    """
    Спланувати зміни в "DzhuraReaction" за апдейтом Telegram.

    active  — активні рядки з БД: (row_id, person_tg_id|None, emoji_key)
    recent  — recent_reactions з апдейту: (person_tg_id, emoji_key, my: bool, date|None);
              Telegram віддає лише ~3 останніх, у приватних чатах — не віддає взагалі
    results — лічильники: (emoji_key, count, chosen: bool)
    private_other_id — tg id співрозмовника в приватному чаті (інакше None)
    me_id   — tg id власника

    Повертає (to_add, to_close):
      to_add   — [{person_tg_id|None, emoji, is_mine, date}]
      to_close — [row_id] активних рядків, які треба закрити (removedAt)
    """
    counts = reactions_counts(results)
    chosen = {str(r[0]) for r in results if len(r) > 2 and r[2] and int(r[1] or 0) > 0}
    active_pairs = {(row[1], str(row[2])) for row in active}
    recent_pairs = {(int(r[0]), str(r[1])) for r in recent if r[0] is not None}

    to_add: list[dict[str, Any]] = []
    to_close: list[int] = []
    planned_pairs: set[tuple[Optional[int], str]] = set()

    # 1. Емодзі, яких більше нема серед лічильників, — закрити всі активні рядки.
    for row_id, person, emoji in active:
        if str(emoji) not in counts:
            to_close.append(int(row_id))

    # 2. Явні автори з recent_reactions.
    for r in recent:
        person_tg_id, emoji, my = r[0], str(r[1]), bool(r[2])
        date = r[3] if len(r) > 3 else None
        if person_tg_id is None or emoji not in counts:
            continue
        pair = (int(person_tg_id), emoji)
        if pair in active_pairs or pair in planned_pairs:
            continue
        planned_pairs.add(pair)
        to_add.append(
            {
                "person_tg_id": int(person_tg_id),
                "emoji": emoji,
                "is_mine": bool(my) or (me_id is not None and int(person_tg_id) == int(me_id)),
                "date": date,
            }
        )

    # 3. Лічильник > відомих авторів: приватний чат → вивести автора; група → «хтось».
    for emoji, count in counts.items():
        known = [row for row in active if str(row[2]) == emoji and int(row[0]) not in to_close]
        known_pairs = {(row[1], emoji) for row in known}
        planned_for_emoji = [p for p in planned_pairs if p[1] == emoji]
        have = len(known) + len(planned_for_emoji)
        missing = count - have
        if missing <= 0:
            # 3a. Реакцій стало менше, ніж рядків: закрити зайві (спершу анонімні, потім ті, кого нема в recent).
            surplus = have - count
            if surplus > 0:
                candidates = sorted(
                    known,
                    key=lambda row: (
                        0 if row[1] is None else (1 if (row[1], emoji) not in recent_pairs else 2),
                        int(row[0]),
                    ),
                )
                for row in candidates[:surplus]:
                    to_close.append(int(row[0]))
            continue
        for _ in range(missing):
            person: Optional[int] = None
            is_mine = False
            if emoji in chosen and me_id is not None and (int(me_id), emoji) not in known_pairs and (int(me_id), emoji) not in planned_pairs:
                person, is_mine = int(me_id), True
            elif private_other_id is not None and (int(private_other_id), emoji) not in known_pairs and (int(private_other_id), emoji) not in planned_pairs:
                person = int(private_other_id)
            pair = (person, emoji)
            if person is not None:
                planned_pairs.add(pair)
            to_add.append({"person_tg_id": person, "emoji": emoji, "is_mine": is_mine, "date": None})

    # Дедуп close-списку зі збереженням порядку.
    seen: set[int] = set()
    to_close = [x for x in to_close if not (x in seen or seen.add(x))]
    return to_add, to_close


def format_message_relay(
    chat_title: str,
    sender_html: str,
    msg_id: int,
    text: Optional[str],
    *,
    media_kind: Optional[str] = None,
    file_name: Optional[str] = None,
    reply_preview: Optional[str] = None,
    link: Optional[str] = None,
    forward_from: Optional[str] = None,
) -> str:
    """Дубль нового повідомлення для «Обраного»."""
    ref = f"#{int(msg_id)}"
    if link:
        ref = f'<a href="{html_escape(link)}">{ref}</a>'
    head = f"<b>{html_escape(chat_title)}</b> · {sender_html} · {ref}"

    body = html_escape((text or "").strip())
    label = media_label(media_kind, file_name)
    if label:
        body = f"{label} {body}".strip()
    if forward_from:
        body = f"↪︎ переслано від {html_escape(forward_from)}\n{body}".rstrip()

    lines = [head]
    if body:
        lines.append(body)
    if reply_preview:
        lines.append(f"↩︎ у відповідь на: «{html_escape(truncate(reply_preview))}»")
    return "\n".join(lines)


def format_reaction_relay(
    chat_title: str,
    reactor_html: str,
    emoji_key: str,
    quoted_text: Optional[str],
    *,
    author_html: Optional[str] = None,
    own: bool = False,
    link: Optional[str] = None,
) -> str:
    """Дубль чужої реакції для «Обраного». reactor_html = 'Хтось', коли автор невідомий."""
    label = reaction_label(emoji_key)
    if own:
        target = "на ваше повідомлення"
    elif author_html:
        target = f"на повідомлення {author_html}"
    else:
        target = "на повідомлення"
    quote = f" «{html_escape(truncate(quoted_text))}»" if quoted_text else ""
    ref = f' <a href="{html_escape(link)}">↗</a>' if link else ""
    return f"<b>{html_escape(chat_title)}</b> · {reactor_html}: реакція {label} {target}{quote}{ref}"


def naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Prisma DateTime = TIMESTAMP(3) без зони: asyncpg приймає лише naive UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    from datetime import timezone

    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def clip_raw_json(raw: Optional[str], limit: int = RAW_JSON_LIMIT) -> Optional[str]:
    """rawJson зберігаємо як є, якщо влазить; інакше — лише позначку, що урізано (валідний JSON)."""
    if raw is None:
        return None
    if len(raw) <= limit:
        return raw
    return '{"_truncated": true, "_length": %d}' % len(raw)
