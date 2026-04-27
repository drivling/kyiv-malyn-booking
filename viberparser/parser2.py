import hashlib
import json
import os
import re
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional


STATE_FILE = Path(__file__).with_name("ui_daemon_state.json")
QUEUE_FILE = Path(__file__).with_name("ui_daemon_queue.jsonl")
OUTPUT_FILE = Path(os.getenv("VIBER_UI_OUTPUT_FILE", str(Path(__file__).with_name("ui_messages.jsonl"))))

POLL_INTERVAL_SEC = float(os.getenv("VIBER_UI_POLL_INTERVAL_SEC", "3"))
MAX_BATCH_LINES = int(os.getenv("VIBER_UI_MAX_BATCH_LINES", "30"))
MAX_RETRY_ATTEMPTS = int(os.getenv("VIBER_UI_MAX_RETRY_ATTEMPTS", "8"))
RETRY_BASE_SEC = float(os.getenv("VIBER_UI_RETRY_BASE_SEC", "1.5"))
MAX_BATCH_MESSAGES = int(os.getenv("VIBER_UI_MAX_BATCH_MESSAGES", "20"))

MESSAGE_HEADER_RE = re.compile(r"^\[\s*.+?\s*\]\s*.+?:\s*.+$")
HEADER_PARSE_RE = re.compile(r"^\[\s*(?P<datetime>.+?)\s*\]\s*(?P<author>.+?):\s*(?P<first_body>.*)$")


@dataclass
class QueueItem:
    id: str
    text: str
    created_at: float
    attempts: int = 0
    next_attempt_at: float = 0.0


def run_command(command: List[str]) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=True)
    return result.stdout


def try_copy_with_script(script: str, previous_clipboard: str) -> Optional[str]:
    try:
        run_command(["osascript", "-e", script])
    except subprocess.CalledProcessError:
        return None
    time.sleep(0.25)
    copied_text = run_command(["pbpaste"])
    if copied_text.strip() and copied_text != previous_clipboard:
        return copied_text
    return None


def snapshot_chat_text() -> str:
    # Требуется доступ Accessibility для "System Events".
    previous_clipboard = run_command(["pbpaste"])

    # Быстрый путь: горячие клавиши.
    keyboard_script = """
tell application "Viber" to activate
delay 0.5
tell application "System Events"
    tell process "Viber"
        set frontmost to true
    end tell
    delay 0.2
    key code 0 using command down
    delay 0.2
    key code 8 using command down
end tell
"""

    for _ in range(2):
        copied_text = try_copy_with_script(keyboard_script, previous_clipboard)
        if copied_text:
            return copied_text

    # Fallback: через меню (если фокус в чате не ловится горячими клавишами).
    menu_script = """
tell application "Viber" to activate
delay 0.5
tell application "System Events"
    tell process "Viber"
        set frontmost to true
        click menu item "Select All" of menu "Edit" of menu bar 1
    end tell
    delay 0.2
    key code 8 using command down
end tell
"""

    localized_menu_script = """
tell application "Viber" to activate
delay 0.5
tell application "System Events"
    tell process "Viber"
        set frontmost to true
        try
            click menu item "Выбрать все" of menu "Правка" of menu bar 1
        on error
            click menu item "Вибрати все" of menu "Правка" of menu bar 1
        end try
    end tell
    delay 0.2
    key code 8 using command down
end tell
"""

    # Fallback: клик в центр окна, затем Cmd+A/Cmd+C.
    click_and_copy_script = """
tell application "Viber" to activate
delay 0.5
tell application "System Events"
    tell process "Viber"
        set frontmost to true
        tell window 1
            set {xPos, yPos} to position
            set {wSize, hSize} to size
        end tell
        click at {xPos + (wSize * 0.65), yPos + (hSize * 0.55)}
    end tell
    delay 0.2
    key code 0 using command down
    delay 0.2
    key code 8 using command down
end tell
"""

    for script in (menu_script, localized_menu_script):
        copied_text = try_copy_with_script(script, previous_clipboard)
        if copied_text:
            return copied_text

    copied_text = try_copy_with_script(click_and_copy_script, previous_clipboard)
    if copied_text:
        return copied_text

    raise RuntimeError(
        "Не удалось автоматически скопировать текст из Viber. "
        "Проверь, что окно чата открыто, а у Terminal/Cursor есть Accessibility-права."
    )


def normalize_lines(raw_text: str) -> List[str]:
    lines = []
    for line in raw_text.splitlines():
        cleaned = " ".join(line.strip().split())
        if cleaned:
            lines.append(cleaned)
    return lines


def build_messages(lines: List[str]) -> List[str]:
    messages: List[str] = []
    current: List[str] = []

    for line in lines:
        is_header = bool(MESSAGE_HEADER_RE.match(line))

        if is_header and current:
            messages.append("\n".join(current))
            current = [line]
            continue

        if is_header:
            current = [line]
            continue

        if current:
            current.append(line)

    if current:
        messages.append("\n".join(current))

    # Если заголовков нет (нестандартное копирование), сохраняем весь блок как одно сообщение.
    if not messages and lines:
        messages = ["\n".join(lines)]

    return messages


def message_id(message: str) -> str:
    return hashlib.sha256(message.encode("utf-8")).hexdigest()


def parse_structured_message(message: str) -> dict:
    lines = message.splitlines()
    if not lines:
        return {"header": "", "author": "", "datetime": "", "body": ""}

    header_line = lines[0]
    body_lines: List[str] = []
    author = ""
    message_datetime = ""

    match = HEADER_PARSE_RE.match(header_line)
    if match:
        author = match.group("author").strip().replace("\u2068", "").replace("\u2069", "")
        message_datetime = match.group("datetime").strip()
        first_body = match.group("first_body").strip()
        if first_body:
            body_lines.append(first_body)
        if len(lines) > 1:
            body_lines.extend(lines[1:])
    else:
        body_lines = lines

    body = "\n".join(line.strip() for line in body_lines if line.strip())
    return {
        "header": header_line,
        "author": author,
        "datetime": message_datetime,
        "body": body,
    }


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"seen_ids": []}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def load_queue() -> List[QueueItem]:
    if not QUEUE_FILE.exists():
        return []
    items: List[QueueItem] = []
    for line in QUEUE_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip():
            items.append(QueueItem(**json.loads(line)))
    return items


def save_queue(items: List[QueueItem]) -> None:
    payload = "\n".join(json.dumps(asdict(item), ensure_ascii=False) for item in items)
    QUEUE_FILE.write_text(payload + ("\n" if payload else ""), encoding="utf-8")


def enqueue_new_lines(lines: List[str], state: dict, queue: List[QueueItem]) -> int:
    seen_ids = set(state.get("seen_ids", []))
    queued = {item.id for item in queue}
    added = 0

    messages = build_messages(lines[-MAX_BATCH_LINES:])
    for message in messages[-MAX_BATCH_MESSAGES:]:
        msg_id = message_id(message)
        if msg_id in seen_ids or msg_id in queued:
            continue
        queue.append(QueueItem(id=msg_id, text=message, created_at=time.time()))
        seen_ids.add(msg_id)
        added += 1

    # Ограничиваем state, чтобы не разрастался бесконечно.
    state["seen_ids"] = list(seen_ids)[-3000:]
    return added


def write_to_output_file(item: QueueItem) -> None:
    structured = parse_structured_message(item.text)
    record = {
        "id": item.id,
        "text": item.text,
        "header": structured["header"],
        "author": structured["author"],
        "datetime": structured["datetime"],
        "body": structured["body"],
        "created_at": item.created_at,
        "source": "viber-ui-automation",
    }
    with OUTPUT_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def flush_queue(queue: List[QueueItem]) -> List[QueueItem]:
    now = time.time()
    remaining: List[QueueItem] = []

    for item in queue:
        if item.next_attempt_at > now:
            remaining.append(item)
            continue

        try:
            write_to_output_file(item)
            print(f"✅ Saved: {item.text[:80]}")
        except OSError as exc:
            item.attempts += 1
            if item.attempts >= MAX_RETRY_ATTEMPTS:
                print(f"❌ Drop after retries: {item.text[:80]} | {exc}")
                continue
            delay = RETRY_BASE_SEC * (2 ** (item.attempts - 1))
            item.next_attempt_at = now + delay
            remaining.append(item)
            print(f"⚠️ Retry #{item.attempts} in {delay:.1f}s: {exc}")

    return remaining


def main() -> None:
    print("🚀 UI daemon started. Open needed chat in Viber.")
    print("⌨️ Grant Accessibility permission for Terminal/Python if asked.")

    state = load_state()
    queue = load_queue()

    while True:
        try:
            raw = snapshot_chat_text()
            lines = normalize_lines(raw)
            added = enqueue_new_lines(lines, state, queue)
            if added:
                print(f"➕ Enqueued {added} new lines")

            queue = flush_queue(queue)
            save_state(state)
            save_queue(queue)
        except Exception as exc:
            print(f"⚠️ Loop error: {exc}")

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()