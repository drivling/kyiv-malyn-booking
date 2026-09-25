"""
Джура · доступ до БД (asyncpg на спільному пулі LunchDB).

Таблиці — Prisma-моделі Dzhura* (backend/prisma/schema.prisma), імена квотовані camelCase.
Правила:
  * усі datetime — naive UTC (Prisma DateTime = TIMESTAMP(3) без зони);
  * JSONB — рядок json.dumps(...) + "$n::jsonb"; читається як str.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable, Optional

import asyncpg

from dzhura.relay import naive_utc


def _json(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=str)


def _loads(value: Any) -> Any:
    if value is None or not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return None


class DzhuraDB:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    # ---------- chats ----------

    async def ensure_lunch_chat(self, tg_chat_id: int, title: str) -> None:
        """Група обідів читається завжди; relayToSaved не чіпаємо (адмін вирішує)."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "DzhuraChat"
                    ("tgChatId", kind, title, "isLunchGroup", "captureEnabled", "relayToSaved", "createdAt", "updatedAt")
                VALUES ($1, 'group', $2, TRUE, TRUE, FALSE, NOW(), NOW())
                ON CONFLICT ("tgChatId") DO UPDATE SET
                    "isLunchGroup" = TRUE,
                    "captureEnabled" = TRUE,
                    title = COALESCE(NULLIF(EXCLUDED.title, ''), "DzhuraChat".title),
                    "updatedAt" = NOW()
                """,
                int(tg_chat_id),
                title or str(tg_chat_id),
            )

    async def upsert_chat_from_dialog(
        self,
        *,
        tg_chat_id: int,
        kind: str,
        title: str,
        username: Optional[str],
        members_count: Optional[int],
        last_message_at: Optional[datetime],
    ) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "DzhuraChat"
                    ("tgChatId", kind, title, username, "membersCount", "lastMessageAt",
                     "dialogSyncedAt", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
                ON CONFLICT ("tgChatId") DO UPDATE SET
                    kind = EXCLUDED.kind,
                    title = EXCLUDED.title,
                    username = EXCLUDED.username,
                    "membersCount" = COALESCE(EXCLUDED."membersCount", "DzhuraChat"."membersCount"),
                    "lastMessageAt" = GREATEST(EXCLUDED."lastMessageAt", "DzhuraChat"."lastMessageAt"),
                    "dialogSyncedAt" = NOW(),
                    "updatedAt" = NOW()
                """,
                int(tg_chat_id),
                kind,
                (title or str(tg_chat_id))[:255],
                (username or None),
                members_count,
                naive_utc(last_message_at),
            )

    async def watched_chats(self) -> dict[int, dict[str, Any]]:
        """{tgChatId: {...}} для чатів з captureEnabled."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, "tgChatId", kind, title, "relayToSaved", "lastCapturedTgMessageId"
                FROM "DzhuraChat"
                WHERE "captureEnabled" = TRUE
                """
            )
        return {
            int(r["tgChatId"]): {
                "id": int(r["id"]),
                "tg_chat_id": int(r["tgChatId"]),
                "kind": r["kind"],
                "title": r["title"],
                "relay_to_saved": bool(r["relayToSaved"]),
                "last_captured_tg_message_id": int(r["lastCapturedTgMessageId"])
                if r["lastCapturedTgMessageId"] is not None
                else None,
            }
            for r in rows
        }

    async def get_chat_by_id(self, chat_id: int) -> Optional[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            r = await conn.fetchrow(
                'SELECT id, "tgChatId", kind, title, "relayToSaved" FROM "DzhuraChat" WHERE id = $1',
                int(chat_id),
            )
        if not r:
            return None
        return {
            "id": int(r["id"]),
            "tg_chat_id": int(r["tgChatId"]),
            "kind": r["kind"],
            "title": r["title"],
            "relay_to_saved": bool(r["relayToSaved"]),
        }

    async def touch_chat(self, chat_id: int, sent_at: Optional[datetime], tg_message_id: Optional[int]) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "DzhuraChat"
                SET "lastMessageAt" = GREATEST(COALESCE($2, "lastMessageAt"), "lastMessageAt"),
                    "lastCapturedAt" = NOW(),
                    "lastCapturedTgMessageId" = GREATEST(COALESCE($3, "lastCapturedTgMessageId"), "lastCapturedTgMessageId"),
                    "updatedAt" = NOW()
                WHERE id = $1
                """,
                int(chat_id),
                naive_utc(sent_at),
                int(tg_message_id) if tg_message_id is not None else None,
            )

    # ---------- persons ----------

    async def upsert_person(
        self,
        *,
        tg_user_id: int,
        first_name: Optional[str],
        last_name: Optional[str],
        username: Optional[str],
        phone: Optional[str],
        is_bot: bool,
        is_me: bool,
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "DzhuraPerson"
                    ("tgUserId", "firstName", "lastName", username, phone, "isBot", "isMe",
                     "lastSeenAt", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
                ON CONFLICT ("tgUserId") DO UPDATE SET
                    "firstName" = COALESCE(EXCLUDED."firstName", "DzhuraPerson"."firstName"),
                    "lastName" = COALESCE(EXCLUDED."lastName", "DzhuraPerson"."lastName"),
                    username = COALESCE(EXCLUDED.username, "DzhuraPerson".username),
                    phone = COALESCE(EXCLUDED.phone, "DzhuraPerson".phone),
                    "isBot" = EXCLUDED."isBot",
                    "isMe" = EXCLUDED."isMe" OR "DzhuraPerson"."isMe",
                    "lastSeenAt" = NOW(),
                    "updatedAt" = NOW()
                RETURNING id
                """,
                int(tg_user_id),
                (first_name or None),
                (last_name or None),
                (username or None),
                (phone or None),
                bool(is_bot),
                bool(is_me),
            )
        return int(row["id"])

    async def get_person_by_tg(self, tg_user_id: int) -> Optional[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            r = await conn.fetchrow(
                'SELECT id, "tgUserId", "firstName", "lastName", username, "isMe" FROM "DzhuraPerson" WHERE "tgUserId" = $1',
                int(tg_user_id),
            )
        return _person_row(r) if r else None

    async def get_person_by_id(self, person_id: int) -> Optional[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            r = await conn.fetchrow(
                'SELECT id, "tgUserId", "firstName", "lastName", username, "isMe" FROM "DzhuraPerson" WHERE id = $1',
                int(person_id),
            )
        return _person_row(r) if r else None

    # ---------- messages ----------

    async def upsert_message(
        self,
        *,
        chat_id: int,
        tg_message_id: int,
        sender_person_id: Optional[int],
        is_outgoing: bool,
        text: str,
        media_kind: Optional[str],
        reply_to_tg_message_id: Optional[int],
        topic_id: Optional[int],
        forward_from_name: Optional[str],
        forward_from_tg_id: Optional[int],
        forward_date: Optional[datetime],
        sent_at: datetime,
        edited_at: Optional[datetime],
        source: str,
        raw_json: Optional[str],
    ) -> tuple[int, bool]:
        """Повертає (id, inserted). inserted=False — запис уже був (edit/backfill поверх live)."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "DzhuraMessage"
                    ("chatId", "tgMessageId", "senderPersonId", "isOutgoing", text, "mediaKind",
                     "replyToTgMessageId", "topicId", "forwardFromName", "forwardFromTgId", "forwardDate",
                     "sentAt", "editedAt", source, "rawJson", "capturedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, NOW())
                ON CONFLICT ("chatId", "tgMessageId") DO UPDATE SET
                    text = EXCLUDED.text,
                    "mediaKind" = COALESCE(EXCLUDED."mediaKind", "DzhuraMessage"."mediaKind"),
                    "editedAt" = COALESCE(EXCLUDED."editedAt", "DzhuraMessage"."editedAt"),
                    "senderPersonId" = COALESCE(EXCLUDED."senderPersonId", "DzhuraMessage"."senderPersonId"),
                    "rawJson" = COALESCE(EXCLUDED."rawJson", "DzhuraMessage"."rawJson")
                RETURNING id, (xmax = 0) AS inserted
                """,
                int(chat_id),
                int(tg_message_id),
                int(sender_person_id) if sender_person_id is not None else None,
                bool(is_outgoing),
                text or "",
                media_kind,
                int(reply_to_tg_message_id) if reply_to_tg_message_id is not None else None,
                int(topic_id) if topic_id is not None else None,
                (forward_from_name or None),
                int(forward_from_tg_id) if forward_from_tg_id is not None else None,
                naive_utc(forward_date),
                naive_utc(sent_at),
                naive_utc(edited_at),
                source,
                raw_json,
            )
        return int(row["id"]), bool(row["inserted"])

    async def get_message_by_tg(self, chat_id: int, tg_message_id: int) -> Optional[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            r = await conn.fetchrow(
                """
                SELECT m.id, m.text, m."isOutgoing", m."senderPersonId", m."editedAt", m."deletedAt",
                       p."tgUserId" AS sender_tg_id, p."firstName", p."lastName", p.username
                FROM "DzhuraMessage" m
                LEFT JOIN "DzhuraPerson" p ON p.id = m."senderPersonId"
                WHERE m."chatId" = $1 AND m."tgMessageId" = $2
                """,
                int(chat_id),
                int(tg_message_id),
            )
        if not r:
            return None
        return {
            "id": int(r["id"]),
            "text": r["text"] or "",
            "is_outgoing": bool(r["isOutgoing"]),
            "sender_person_id": int(r["senderPersonId"]) if r["senderPersonId"] is not None else None,
            "sender_tg_id": int(r["sender_tg_id"]) if r["sender_tg_id"] is not None else None,
            "first_name": r["firstName"],
            "last_name": r["lastName"],
            "username": r["username"],
            "edited_at": r["editedAt"],
            "deleted_at": r["deletedAt"],
        }

    async def apply_edit(self, message_id: int, prev_text: str, new_text: str, edited_at: Optional[datetime]) -> None:
        """Зберегти попередню версію в editHistoryJson і оновити текст."""
        entry = _json({"text": prev_text, "editedAt": (naive_utc(edited_at) or datetime.utcnow()).isoformat()})
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "DzhuraMessage"
                SET text = $2,
                    "editedAt" = COALESCE($3, NOW()),
                    "editHistoryJson" = COALESCE("editHistoryJson", '[]'::jsonb) || $4::jsonb
                WHERE id = $1
                """,
                int(message_id),
                new_text or "",
                naive_utc(edited_at),
                entry,
            )

    async def set_reactions_json(self, message_id: int, counts: dict[str, int]) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                'UPDATE "DzhuraMessage" SET "reactionsJson" = $2::jsonb WHERE id = $1',
                int(message_id),
                _json(counts or {}),
            )

    async def mark_deleted(self, chat_id: int, tg_message_ids: Iterable[int]) -> int:
        ids = [int(x) for x in tg_message_ids]
        if not ids:
            return 0
        async with self.pool.acquire() as conn:
            res = await conn.execute(
                """
                UPDATE "DzhuraMessage"
                SET "deletedAt" = COALESCE("deletedAt", NOW())
                WHERE "chatId" = $1 AND "tgMessageId" = ANY($2::bigint[])
                """,
                int(chat_id),
                ids,
            )
        return _affected(res)

    async def mark_deleted_unscoped(self, tg_message_ids: Iterable[int]) -> int:
        """
        UpdateDeleteMessages без chat_id (приватні чати й basic-групи): id повідомлень там
        глобальні для акаунта, тож позначаємо лише коли збіг рівно один.
        """
        marked = 0
        for tg_id in tg_message_ids:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT m.id
                    FROM "DzhuraMessage" m
                    JOIN "DzhuraChat" c ON c.id = m."chatId"
                    WHERE m."tgMessageId" = $1 AND c.kind IN ('group', 'private')
                    LIMIT 2
                    """,
                    int(tg_id),
                )
                if len(rows) == 1:
                    await conn.execute(
                        'UPDATE "DzhuraMessage" SET "deletedAt" = COALESCE("deletedAt", NOW()) WHERE id = $1',
                        int(rows[0]["id"]),
                    )
                    marked += 1
        return marked

    # ---------- reactions ----------

    async def active_reactions(self, message_id: int) -> list[tuple[int, Optional[int], str]]:
        """[(row_id, person_tg_id|None, emoji)] активних (removedAt IS NULL)."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT r.id, r.emoji, p."tgUserId" AS person_tg_id
                FROM "DzhuraReaction" r
                LEFT JOIN "DzhuraPerson" p ON p.id = r."personId"
                WHERE r."messageId" = $1 AND r."removedAt" IS NULL
                ORDER BY r.id
                """,
                int(message_id),
            )
        return [
            (int(r["id"]), int(r["person_tg_id"]) if r["person_tg_id"] is not None else None, r["emoji"])
            for r in rows
        ]

    async def add_reaction(
        self,
        *,
        message_id: int,
        person_id: Optional[int],
        emoji: str,
        is_mine: bool,
        added_at: Optional[datetime],
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "DzhuraReaction" ("messageId", "personId", emoji, "isMine", "addedAt")
                VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
                RETURNING id
                """,
                int(message_id),
                int(person_id) if person_id is not None else None,
                emoji,
                bool(is_mine),
                naive_utc(added_at),
            )
        return int(row["id"])

    async def close_reactions(self, row_ids: Iterable[int]) -> None:
        ids = [int(x) for x in row_ids]
        if not ids:
            return
        async with self.pool.acquire() as conn:
            await conn.execute(
                'UPDATE "DzhuraReaction" SET "removedAt" = NOW() WHERE id = ANY($1::int[]) AND "removedAt" IS NULL',
                ids,
            )

    # ---------- outbound (спільна черга з lunch) ----------

    async def enqueue_saved(self, text_html: str) -> None:
        """Дубль у «Обране» через LunchOutboundMessage (target='saved', HTML)."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "LunchOutboundMessage" (text, kind, target, status)
                VALUES ($1, 'send', 'saved', 'pending')
                """,
                text_html,
            )

    # ---------- state / jobs ----------

    async def heartbeat(self, me_tg_user_id: Optional[int]) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "DzhuraState" (id, "heartbeatAt", "meTgUserId", "updatedAt")
                VALUES (1, NOW(), $1, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    "heartbeatAt" = NOW(),
                    "meTgUserId" = COALESCE(EXCLUDED."meTgUserId", "DzhuraState"."meTgUserId"),
                    "updatedAt" = NOW()
                """,
                int(me_tg_user_id) if me_tg_user_id is not None else None,
            )

    async def set_dialogs_synced(self) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "DzhuraState" (id, "dialogsSyncedAt", "updatedAt")
                VALUES (1, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET "dialogsSyncedAt" = NOW(), "updatedAt" = NOW()
                """
            )

    async def fail_stale_running_jobs(self, reason: str) -> int:
        async with self.pool.acquire() as conn:
            res = await conn.execute(
                """
                UPDATE "DzhuraJob"
                SET status = 'failed', "errorText" = $1, "finishedAt" = NOW()
                WHERE status = 'running'
                """,
                reason[:2000],
            )
        return _affected(res)

    async def fetch_pending_jobs(self, limit: int = 1) -> list[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, type, "paramsJson"
                FROM "DzhuraJob"
                WHERE status = 'pending'
                ORDER BY "createdAt" ASC
                LIMIT $1
                """,
                limit,
            )
        return [{"id": int(r["id"]), "type": r["type"], "params": _loads(r["paramsJson"]) or {}} for r in rows]

    async def start_job(self, job_id: int) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                'UPDATE "DzhuraJob" SET status = \'running\', "startedAt" = NOW() WHERE id = $1',
                int(job_id),
            )

    async def progress_job(self, job_id: int, progress: dict[str, Any]) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                'UPDATE "DzhuraJob" SET "progressJson" = $2::jsonb WHERE id = $1',
                int(job_id),
                _json(progress),
            )

    async def complete_job(self, job_id: int, result: dict[str, Any]) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "DzhuraJob"
                SET status = 'done', "resultJson" = $2::jsonb, "finishedAt" = NOW()
                WHERE id = $1
                """,
                int(job_id),
                _json(result),
            )

    async def fail_job(self, job_id: int, error: str) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "DzhuraJob"
                SET status = 'failed', "errorText" = $2, "finishedAt" = NOW()
                WHERE id = $1
                """,
                int(job_id),
                (error or "")[:2000],
            )


def _person_row(r: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": int(r["id"]),
        "tg_user_id": int(r["tgUserId"]),
        "first_name": r["firstName"],
        "last_name": r["lastName"],
        "username": r["username"],
        "is_me": bool(r["isMe"]),
    }


def _affected(status: str) -> int:
    """asyncpg повертає 'UPDATE 3' → 3."""
    try:
        return int((status or "").split()[-1])
    except (ValueError, IndexError):
        return 0
