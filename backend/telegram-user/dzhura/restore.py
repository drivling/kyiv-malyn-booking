"""
Джура · відновлення історії чату (разова операція з адмінки, задачі DzhuraJob):

  * `avatars` {chatId} — маленькі (160 px) фото профілю всіх, хто писав у чат, у результат задачі
    ({ avatars: { <tgUserId>: <jpeg base64> } }) — для локального рендера карток;
  * `post_items` {chatId, batch, seq, silent, items} — опублікувати від імені власника готові пости
    (`text` — HTML, `photo` — JPEG base64 + підпис) у чат, по черзі, з паузою;
  * `import_history` {chatId, text, fileName, media, dryRun | stage init/media/start} — вбудований імпорт історії
    Telegram з файлу у форматі експорту WhatsApp (адмін у супергрупі; dryRun лише перевіряє формат і права);
  * `scan_ids` {chatId} — які повідомлення чату Telegram досі віддає (щоб не імпортувати їх удруге).

Другий свідомий виняток із правила «у чати не пишемо» (перший — автовідповідь): пише лише те, що власник
сам поставив задачею, і лише в групу / супергрупу, яку назвав (ніколи в групу обідів). Нічого не читає
«за власника» окремо — Telegram сам вважає чат прочитаним, коли власник у нього пише.

Порядок важливий: якщо частина партії (batch) з меншим seq не вдалася, наступні не публікуються.
Після завершення важкий вміст (`items`) прибирається з paramsJson, лишаються лічильники.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
from typing import Any

from telethon.errors import FloodWaitError
from telethon.tl.types import InputPeerUser

from dzhura.capture import Capture, log

POST_PAUSE_SEC = float(os.environ.get("DZHURA_POST_PAUSE_SEC", "3") or 3)
AVATAR_PAUSE_SEC = 0.4
MAX_FLOOD_WAIT_SEC = 1800


def summarize_params(job_type: str, params: Any) -> Any:
    """Що писати в лог про задачу: без base64 картинок, HTML постів і тексту імпорту."""
    if job_type == "import_history" and isinstance(params, dict):
        media = params.get("media") if isinstance(params.get("media"), list) else []
        return {
            "chatId": params.get("chatId"),
            "stage": params.get("stage"),
            "importId": params.get("importId"),
            "dryRun": params.get("dryRun"),
            "textChars": len(str(params.get("text") or "")),
            "media": len(media),
        }
    if job_type != "post_items" or not isinstance(params, dict):
        return params
    items = params.get("items") if isinstance(params.get("items"), list) else []
    return {
        "chatId": params.get("chatId"),
        "batch": params.get("batch"),
        "seq": params.get("seq"),
        "silent": params.get("silent"),
        "items": len(items),
        "photos": sum(1 for i in items if isinstance(i, dict) and i.get("kind") == "photo"),
    }


def decode_photo(item: dict[str, Any]) -> io.BytesIO:
    data = base64.b64decode(str(item.get("jpegBase64") or ""), validate=True)
    if not (data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG")):
        raise ValueError("photo: не JPEG/PNG")
    bio = io.BytesIO(data)
    bio.name = "history.png" if data.startswith(b"\x89PNG") else "history.jpg"
    return bio


async def resolve_chat_peer(client, tg_chat_id: int):
    """Вхідна сутність групи: з кешу сесії, інакше — пошуком у діалогах (кеш зникає після деплою)."""
    try:
        return await client.get_input_entity(int(tg_chat_id))
    except (ValueError, TypeError):
        pass
    async for d in client.iter_dialogs(ignore_migrated=True):
        if int(d.id) == int(tg_chat_id):
            return d.input_entity
    raise ValueError(f"чат {tg_chat_id} не знайдено серед діалогів")


async def _send_item(client, peer, item: dict[str, Any], silent: bool):
    kind = item.get("kind")
    if kind == "text":
        return await client.send_message(
            peer, str(item.get("html") or ""), parse_mode="html", link_preview=False, silent=silent
        )
    if kind == "photo":
        caption = str(item.get("caption") or "") or None
        return await client.send_file(
            peer, decode_photo(item), caption=caption, parse_mode="html", silent=silent, force_document=False
        )
    raise ValueError(f"невідомий вид поста: {kind}")


async def post_items(cap: Capture, job: dict[str, Any]) -> dict[str, Any]:
    params = job.get("params") or {}
    chat = await cap.db.get_chat_by_id(int(params["chatId"]))
    if chat is None:
        raise ValueError(f"chat {params.get('chatId')} not found")
    if int(chat["tg_chat_id"]) == int(cap.lunch_group_id) or chat["kind"] not in ("group", "supergroup"):
        raise ValueError("публікуємо лише в звичайні групи (не в групу обідів і не в особисті)")
    batch = str(params.get("batch") or "")
    seq = int(params.get("seq") or 0)
    if batch and await cap.db.post_batch_broken(batch, seq, int(job["id"])):
        raise RuntimeError(f"частина партії {batch} перед №{seq} не вдалася — зупиняюсь, щоб не зламати порядок")
    items = [i for i in (params.get("items") or []) if isinstance(i, dict)]
    silent = bool(params.get("silent", True))
    peer = await resolve_chat_peer(cap.client, int(chat["tg_chat_id"]))

    sent: list[int] = []
    try:
        for item in items:
            while True:
                try:
                    msg = await _send_item(cap.client, peer, item, silent)
                    break
                except FloodWaitError as e:
                    if e.seconds > MAX_FLOOD_WAIT_SEC:
                        raise
                    log(f"post_items {chat['title']}: flood wait {e.seconds}s", err=True)
                    await cap.db.progress_job(
                        job["id"], {"sent": len(sent), "total": len(items), "floodWait": e.seconds}
                    )
                    await asyncio.sleep(int(e.seconds) + 1)
            sent.append(int(msg.id))
            await cap.db.progress_job(job["id"], {"sent": len(sent), "total": len(items), "lastMessageId": sent[-1]})
            await asyncio.sleep(POST_PAUSE_SEC)
    finally:
        await cap.db.strip_post_items(int(job["id"]), len(items), len(sent))
    return {"chat": chat["title"], "batch": batch, "seq": seq, "sent": len(sent), "messageIds": sent}


async def fetch_avatars(cap: Capture, job: dict[str, Any]) -> dict[str, Any]:
    params = job.get("params") or {}
    chat = await cap.db.get_chat_by_id(int(params["chatId"]))
    if chat is None:
        raise ValueError(f"chat {params.get('chatId')} not found")
    people = await cap.db.chat_senders(int(chat["id"]))
    avatars: dict[str, str] = {}
    no_photo = failed = 0
    for n, p in enumerate(people, start=1):
        uid = int(p["tg_user_id"])
        peer = InputPeerUser(uid, int(p["access_hash"])) if p.get("access_hash") is not None else uid
        for attempt in range(2):
            try:
                data = await cap.client.download_profile_photo(peer, file=bytes, download_big=False)
                if data:
                    avatars[str(uid)] = base64.b64encode(data).decode("ascii")
                else:
                    no_photo += 1
                break
            except FloodWaitError as e:
                if attempt or e.seconds > MAX_FLOOD_WAIT_SEC:
                    failed += 1
                    break
                await asyncio.sleep(int(e.seconds) + 1)
            except Exception as e:  # noqa: BLE001
                log(f"avatars {uid}: {type(e).__name__}: {e}", err=True)
                failed += 1
                break
        if n % 10 == 0:
            await cap.db.progress_job(job["id"], {"done": n, "total": len(people), "withPhoto": len(avatars)})
        await asyncio.sleep(AVATAR_PAUSE_SEC)
    return {
        "chat": chat["title"],
        "people": len(people),
        "withPhoto": len(avatars),
        "noPhoto": no_photo,
        "failed": failed,
        "avatars": avatars,
    }


async def import_history(cap: Capture, job: dict[str, Any]) -> dict[str, Any]:
    """
    Вбудований імпорт історії Telegram (як «Імпорт чату з WhatsApp»): повідомлення з'являються справжніми,
    з іменами авторів і датами, з позначкою «імпортовано». Потрібні права адміна в групі (лише супергрупа).

    Одним кроком (без stage): text + media ≤ 20 [+ dryRun — лише перевірити формат і права].
    Частинами, коли картинок багато (одна задача — до 20 картинок і 2 МБ):
      stage=init  {text, mediaCount}   → importId (рядок: int64 не влазить у JSON-число без втрат);
      stage=media {importId, media}    — скільки завгодно задач, по черзі;
      stage=start {importId}           — Telegram показує повідомлення; без нього імпорт пропадає.
    """
    from telethon.tl.functions.messages import (
        CheckHistoryImportPeerRequest,
        CheckHistoryImportRequest,
        InitHistoryImportRequest,
        StartHistoryImportRequest,
        UploadImportedMediaRequest,
    )
    from telethon.tl.types import InputMediaUploadedPhoto

    params = job.get("params") or {}
    chat = await cap.db.get_chat_by_id(int(params["chatId"]))
    if chat is None:
        raise ValueError(f"chat {params.get('chatId')} not found")
    if int(chat["tg_chat_id"]) == int(cap.lunch_group_id) or chat["kind"] not in ("group", "supergroup"):
        raise ValueError("імпортуємо лише у звичайні групи (не в групу обідів і не в особисті)")
    stage = str(params.get("stage") or "")
    text = str(params.get("text") or "")
    media = [m for m in (params.get("media") or []) if isinstance(m, dict)]
    peer = await resolve_chat_peer(cap.client, int(chat["tg_chat_id"]))

    async def upload_media(import_id: int, done_before: int = 0) -> int:
        n = 0
        for m in media:
            bio = decode_photo(m)
            name = str(m.get("name") or bio.name)
            f = await cap.client.upload_file(bio.getvalue(), file_name=name)
            while True:
                try:
                    await cap.client(
                        UploadImportedMediaRequest(
                            peer=peer, import_id=import_id, file_name=name, media=InputMediaUploadedPhoto(file=f)
                        )
                    )
                    break
                except FloodWaitError as e:
                    if e.seconds > MAX_FLOOD_WAIT_SEC:
                        raise
                    await asyncio.sleep(int(e.seconds) + 1)
            n += 1
            await cap.db.progress_job(
                job["id"], {"importId": str(import_id), "media": done_before + n, "total": len(media)}
            )
        return n

    if stage == "media":
        import_id = int(str(params["importId"]))
        try:
            n = await upload_media(import_id)
        finally:
            await cap.db.strip_import_payload(int(job["id"]), 0, len(media))
        return {"chat": chat["title"], "stage": "media", "importId": str(import_id), "media": n}

    if stage == "start":
        import_id = int(str(params["importId"]))
        await cap.client(StartHistoryImportRequest(peer=peer, import_id=import_id))
        return {"chat": chat["title"], "stage": "start", "importId": str(import_id), "started": True}

    if not text.strip():
        raise ValueError("порожній text")
    dry_run = bool(params.get("dryRun"))
    media_count = int(params.get("mediaCount") or 0) if stage == "init" else len(media)
    head = "\n".join(text.splitlines()[:100])
    parsed = await cap.client(CheckHistoryImportRequest(import_head=head))
    checked = await cap.client(CheckHistoryImportPeerRequest(peer=peer))
    info: dict[str, Any] = {
        "chat": chat["title"],
        "stage": stage or "all",
        "parsed": {
            "pm": bool(getattr(parsed, "pm", False)),
            "group": bool(getattr(parsed, "group", False)),
            "title": getattr(parsed, "title", None),
        },
        "confirmText": getattr(checked, "confirm_text", None),
        "lines": len(text.splitlines()),
        "media": media_count,
        "dryRun": dry_run,
    }
    if dry_run:
        return info

    try:
        file_name = str(params.get("fileName") or "WhatsApp Chat.txt")
        up = await cap.client.upload_file(text.encode("utf-8"), file_name=file_name)
        imp = await cap.client(InitHistoryImportRequest(peer=peer, file=up, media_count=media_count))
        info["importId"] = str(imp.id)
        await cap.db.progress_job(job["id"], {"importId": str(imp.id), "media": 0, "total": media_count})
        if stage == "init":
            return info
        await upload_media(int(imp.id))
        await cap.client(StartHistoryImportRequest(peer=peer, import_id=imp.id))
    finally:
        await cap.db.strip_import_payload(int(job["id"]), len(text), len(media))
    return info


async def scan_ids(cap: Capture, job: dict[str, Any]) -> dict[str, Any]:
    """Які повідомлення чату Telegram досі віддає (пережили очищення): [[id, дата UTC], …]. Лише читання."""
    params = job.get("params") or {}
    chat = await cap.db.get_chat_by_id(int(params["chatId"]))
    if chat is None:
        raise ValueError(f"chat {params.get('chatId')} not found")
    found: list[list[Any]] = []
    last_id = 0
    while True:
        try:
            kwargs: dict[str, Any] = {"reverse": True, "wait_time": 1}
            if last_id:
                kwargs["min_id"] = last_id
            async for m in cap.client.iter_messages(int(chat["tg_chat_id"]), **kwargs):
                last_id = int(m.id)
                if getattr(m, "action", None) is not None:
                    continue
                found.append([int(m.id), m.date.isoformat() if m.date else None])
                if len(found) % 200 == 0:
                    await cap.db.progress_job(job["id"], {"found": len(found)})
            break
        except FloodWaitError as e:
            if e.seconds > MAX_FLOOD_WAIT_SEC:
                raise
            await asyncio.sleep(int(e.seconds) + 1)
    return {"chat": chat["title"], "count": len(found), "ids": found}
