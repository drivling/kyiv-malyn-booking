"""
Джура · відновлення історії чату (разова операція з адмінки, задачі DzhuraJob):

  * `avatars` {chatId} — маленькі (160 px) фото профілю всіх, хто писав у чат, у результат задачі
    ({ avatars: { <tgUserId>: <jpeg base64> } }) — для локального рендера карток;
  * `post_items` {chatId, batch, seq, silent, items} — опублікувати від імені власника готові пости
    (`text` — HTML, `photo` — JPEG base64 + підпис) у чат, по черзі, з паузою;
  * `import_history` {chatId, text, fileName, media, dryRun} — вбудований імпорт історії Telegram з файлу у
    форматі експорту WhatsApp (потрібні права адміна в групі; dryRun лише перевіряє формат і права).

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
    з іменами авторів і датами, з позначкою «імпортовано». Потрібні права адміна в групі.
    params: chatId, text (експорт у форматі WhatsApp), fileName, media [{name, jpegBase64}], dryRun.
    dryRun — лише перевірити, що Telegram розпізнає формат і пустить імпорт у цей чат; нічого не імпортує.
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
    text = str(params.get("text") or "")
    if not text.strip():
        raise ValueError("порожній text")
    media = [m for m in (params.get("media") or []) if isinstance(m, dict)]
    dry_run = bool(params.get("dryRun"))
    head = "\n".join(text.splitlines()[:100])

    parsed = await cap.client(CheckHistoryImportRequest(import_head=head))
    peer = await resolve_chat_peer(cap.client, int(chat["tg_chat_id"]))
    checked = await cap.client(CheckHistoryImportPeerRequest(peer=peer))
    info: dict[str, Any] = {
        "chat": chat["title"],
        "parsed": {
            "pm": bool(getattr(parsed, "pm", False)),
            "group": bool(getattr(parsed, "group", False)),
            "title": getattr(parsed, "title", None),
        },
        "confirmText": getattr(checked, "confirm_text", None),
        "lines": len(text.splitlines()),
        "media": len(media),
        "dryRun": dry_run,
    }
    if dry_run:
        return info

    try:
        file_name = str(params.get("fileName") or "WhatsApp Chat.txt")
        up = await cap.client.upload_file(text.encode("utf-8"), file_name=file_name)
        imp = await cap.client(InitHistoryImportRequest(peer=peer, file=up, media_count=len(media)))
        await cap.db.progress_job(job["id"], {"importId": int(imp.id), "media": 0, "total": len(media)})
        for n, m in enumerate(media, start=1):
            bio = decode_photo(m)
            name = str(m.get("name") or bio.name)
            f = await cap.client.upload_file(bio.getvalue(), file_name=name)
            await cap.client(
                UploadImportedMediaRequest(
                    peer=peer, import_id=imp.id, file_name=name, media=InputMediaUploadedPhoto(file=f)
                )
            )
            await cap.db.progress_job(job["id"], {"importId": int(imp.id), "media": n, "total": len(media)})
        await cap.client(StartHistoryImportRequest(peer=peer, import_id=imp.id))
    finally:
        await cap.db.strip_import_payload(int(job["id"]), len(text), len(media))
    info["importId"] = int(imp.id)
    return info
