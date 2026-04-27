import argparse
import json
import os
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from urllib import error, request

DEFAULT_DB_PATH = "/Users/merenkov/Library/Application Support/ViberPC/380739551952/viber.db"
DEFAULT_STATE_PATH = Path(__file__).with_name("db_parser_state.json")
DEFAULT_BACKEND_URL = os.getenv("VIBER_BACKEND_URL", "http://localhost:3000")
DEFAULT_AUTH_TOKEN = os.getenv("VIBER_ADMIN_TOKEN", "admin-authenticated")

SQLITE_HEADER = b"SQLite format 3\x00"
MONTHS_UA = [
    "січня",
    "лютого",
    "березня",
    "квітня",
    "травня",
    "червня",
    "липня",
    "серпня",
    "вересня",
    "жовтня",
    "листопада",
    "грудня",
]


def _read_header(path: Path) -> bytes:
    with path.open("rb") as fh:
        return fh.read(16)


def parse_args():
    parser = argparse.ArgumentParser(description="Read messages from an open-format Viber SQLite DB.")
    parser.add_argument(
        "db_path",
        nargs="?",
        default=os.getenv("VIBER_DB_PATH", DEFAULT_DB_PATH),
        help="Path to viber.db. Can also be set via VIBER_DB_PATH.",
    )
    parser.add_argument(
        "--inspect",
        action="store_true",
        help="Print tables/columns and exit without starting message watcher.",
    )
    parser.add_argument("--chat-id", type=int, help="ChatID to watch. If omitted, script asks interactively.")
    parser.add_argument("--poll-interval", type=float, default=float(os.getenv("VIBER_DB_POLL_INTERVAL_SEC", "2")))
    parser.add_argument("--send", action="store_true", help="Send parsed DB messages to backend /viber-listings.")
    parser.add_argument(
        "--send-history",
        action="store_true",
        help="With --send, send historical messages from last saved state or from EventID 0.",
    )
    parser.add_argument(
        "--backend-url",
        default=DEFAULT_BACKEND_URL,
        help="Backend base URL, e.g. https://example.com or http://localhost:3000.",
    )
    parser.add_argument(
        "--auth-token",
        default=DEFAULT_AUTH_TOKEN,
        help="Authorization header value for admin endpoints.",
    )
    parser.add_argument(
        "--state-file",
        default=str(DEFAULT_STATE_PATH),
        help="Local JSON state file with last sent EventID per chat.",
    )
    return parser.parse_args()


def get_connection(db_path: Path):

    if not db_path.exists():
        raise RuntimeError(
            f"Файл БД не найден: {db_path}\n"
            "Передай путь аргументом: python3 viberparser/parser.py /path/to/viber.db"
        )

    if not db_path.is_file():
        raise RuntimeError(f"Путь не является файлом: {db_path}")

    # Быстрая проверка заголовка SQLite, чтобы не падать позже на SELECT.
    header = _read_header(db_path)

    if header != SQLITE_HEADER:
        if db_path.name == "viber.db":
            raise RuntimeError(
                "Файл viber.db найден, но в этой установке Viber он не в формате SQLite "
                "(скорее всего зашифрован).\n"
                f"Путь: {db_path}\n"
                "Этот скрипт работает только с незашифрованной SQLite-базой."
            )
        raise RuntimeError(
            "Указанный файл не похож на SQLite-базу.\n"
            f"Путь: {db_path}\n"
            "Скорее всего выбран не тот файл. Укажи путь до корректного viber.db."
        )

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.execute("SELECT name FROM sqlite_master LIMIT 1")
        return conn
    except sqlite3.DatabaseError as e:
        raise RuntimeError(
            "Файл существует, но SQLite не может его прочитать как базу.\n"
            f"Путь: {db_path}\n"
            "Проверь, что это именно viber.db из профиля ViberPC и что файл не поврежден."
        ) from e


def get_tables(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    return [row[0] for row in cursor.fetchall()]


def get_columns(conn, table_name):
    cursor = conn.cursor()
    safe_table_name = table_name.replace('"', '""')
    cursor.execute(f'PRAGMA table_info("{safe_table_name}")')
    return [row[1] for row in cursor.fetchall()]


def print_schema(conn):
    print("📚 Таблицы в базе:")
    for table in get_tables(conn):
        columns = ", ".join(get_columns(conn, table))
        print(f"- {table}: {columns}")


def get_groups(conn):
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            c.ChatID,
            COALESCE(c.Name, '(без названия)') AS Name,
            COUNT(m.EventID) AS MessagesCount
        FROM ChatInfo c
        LEFT JOIN Events e ON e.ChatID = c.ChatID
        LEFT JOIN Messages m ON m.EventID = e.EventID
            AND m.Body IS NOT NULL
            AND TRIM(m.Body) != ''
        GROUP BY c.ChatID, c.Name
        HAVING c.Name IS NOT NULL OR MessagesCount > 0
        ORDER BY MessagesCount DESC, c.ChatID ASC
    """)

    return cursor.fetchall()

def get_messages(conn, conversation_id, last_id=0):
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            e.EventID,
            m.Body,
            e.TimeStamp,
            COALESCE(NULLIF(ct.ClientName, ''), NULLIF(ct.Name, ''), ct.Number, 'unknown') AS Author,
            e.Direction
        FROM Events e
        JOIN Messages m ON m.EventID = e.EventID
        LEFT JOIN Contact ct ON ct.ContactID = e.ContactID
        WHERE e.ChatID = ?
            AND e.EventID > ?
            AND m.Body IS NOT NULL
            AND TRIM(m.Body) != ''
        ORDER BY e.EventID ASC
    """, (conversation_id, last_id))

    return cursor.fetchall()


def get_latest_message_id(conn, conversation_id):
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COALESCE(MAX(e.EventID), 0)
        FROM Events e
        JOIN Messages m ON m.EventID = e.EventID
        WHERE e.ChatID = ?
            AND m.Body IS NOT NULL
            AND TRIM(m.Body) != ''
    """, (conversation_id,))
    return cursor.fetchone()[0] or 0


def format_message_time(timestamp):
    if timestamp is None:
        return "unknown time"

    # Viber в этой схеме хранит timestamp в миллисекундах.
    if timestamp > 10_000_000_000:
        timestamp = timestamp / 1000

    return datetime.fromtimestamp(timestamp)


def format_viber_raw_message(text, timestamp, author):
    dt = format_message_time(timestamp)
    if isinstance(dt, str):
        dt = datetime.now()

    safe_author = (author or "unknown").strip()
    header = f"[ {dt.day} {MONTHS_UA[dt.month - 1]} {dt.year} р. {dt:%H:%M} ]"
    return f"{header} ⁨{safe_author}⁩: {text.strip()}"


def load_state(path):
    state_path = Path(path).expanduser()
    if not state_path.exists():
        return {}
    return json.loads(state_path.read_text(encoding="utf-8"))


def save_state(path, state):
    state_path = Path(path).expanduser()
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def state_key(db_path, chat_id):
    return f"{Path(db_path).resolve()}::{chat_id}"


def send_raw_message(backend_url, auth_token, raw_message):
    url = backend_url.rstrip("/") + "/viber-listings"
    payload = json.dumps({"rawMessage": raw_message}, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": auth_token,
        },
    )

    try:
        with request.urlopen(req, timeout=20) as response:
            body = response.read().decode("utf-8", errors="replace")
            return True, body
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if exc.code == 400:
            return False, f"backend не распарсил сообщение: {body}"
        raise RuntimeError(f"backend вернул HTTP {exc.code}: {body}") from exc


def main():
    args = parse_args()
    db_path = Path(args.db_path).expanduser()

    try:
        conn = get_connection(db_path)
    except RuntimeError as e:
        print(f"Ошибка инициализации БД: {e}")
        return

    print(f"✅ SQLite-база открыта: {db_path}")

    if args.inspect:
        print_schema(conn)
        return
    
    print("📌 Доступные группы:")
    try:
        groups = get_groups(conn)
    except sqlite3.DatabaseError as e:
        print(f"Не удалось прочитать группы текущим SQL-запросом: {e}")
        print_schema(conn)
        return
    
    for g in groups:
        print(f"{g[0]}: {g[1]} ({g[2]} сообщений)")
    
    group_id = args.chat_id if args.chat_id is not None else int(input("\nВведи ID группы: "))

    state = load_state(args.state_file)
    key = state_key(db_path, group_id)

    if args.send:
        if args.send_history:
            last_id = int(state.get(key, 0))
            print(f"📤 Send mode: отправляю историю начиная после EventID {last_id}")
        else:
            last_id = int(state.get(key, get_latest_message_id(conn, group_id)))
            state[key] = last_id
            save_state(args.state_file, state)
            print(f"📤 Send mode: отправляю только новые сообщения после EventID {last_id}")
        print(f"🌐 Backend: {args.backend_url.rstrip('/')}/viber-listings")
    else:
        last_id = 0
    
    print("\n🚀 Слежение за новыми сообщениями...\n")
    
    while True:
        try:
            messages = get_messages(conn, group_id, last_id)
            
            for msg_id, text, timestamp, author, direction in messages:
                dt = format_message_time(timestamp)
                direction_label = "out" if direction == 1 else "in"
                print(f"[{dt}] {author} ({direction_label}): {text}")

                if args.send:
                    raw_message = format_viber_raw_message(text, timestamp, author)
                    created, response_text = send_raw_message(args.backend_url, args.auth_token, raw_message)
                    if created:
                        print(f"✅ Отправлено на backend: EventID {msg_id}")
                    else:
                        print(f"⏭️ Пропущено backend parser: EventID {msg_id} | {response_text}")
                
                last_id = msg_id
                if args.send:
                    state[key] = last_id
                    save_state(args.state_file, state)
            
            time.sleep(args.poll_interval)
        
        except Exception as e:
            print("Ошибка:", e)
            time.sleep(5)

if __name__ == "__main__":
    main()