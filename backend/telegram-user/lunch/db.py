"""asyncpg CRUD для таблиць Lunch* (схема Prisma)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import asyncpg

from .util import normalize_dish_name

KYIV = ZoneInfo("Europe/Kyiv")


@dataclass
class MenuItemRow:
    id: int
    day_id: int
    name: str
    name_norm: str
    price_uah: int


@dataclass
class DayRow:
    id: int
    date: date
    status: str
    menu_message_id: Optional[int]
    payee_card: Optional[str]


@dataclass
class OrderLineInput:
    menu_item_id: Optional[int]
    raw_name: str
    qty: int
    unit_price_uah: int
    line_total_uah: int


def today_kyiv() -> date:
    return datetime.now(KYIV).date()


class LunchDB:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    @classmethod
    async def connect(cls, dsn: Optional[str] = None) -> "LunchDB":
        url = (dsn or os.environ.get("DATABASE_URL") or "").strip()
        if not url:
            raise RuntimeError("DATABASE_URL не встановлено")
        pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
        return cls(pool)

    async def close(self) -> None:
        await self.pool.close()

    async def upsert_participant(
        self,
        telegram_user_id: str,
        display_name: str,
        username: Optional[str] = None,
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "LunchParticipant" ("telegramUserId", "displayName", "username", "updatedAt")
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT ("telegramUserId") DO UPDATE SET
                    "displayName" = EXCLUDED."displayName",
                    "username" = COALESCE(EXCLUDED."username", "LunchParticipant"."username"),
                    "updatedAt" = NOW()
                RETURNING id
                """,
                telegram_user_id,
                display_name,
                username,
            )
            return int(row["id"])

    async def find_participant_id_by_display_name(self, display_name: str) -> Optional[int]:
        """Пошук за displayName (case-insensitive) або name: ключем."""
        from .util import normalize_dish_name

        key = normalize_dish_name(display_name)
        synth = f"name:{key}" if key else None
        async with self.pool.acquire() as conn:
            if synth:
                row = await conn.fetchrow(
                    """SELECT id FROM "LunchParticipant" WHERE "telegramUserId" = $1""",
                    synth,
                )
                if row:
                    return int(row["id"])
            row = await conn.fetchrow(
                """
                SELECT id FROM "LunchParticipant"
                WHERE lower("displayName") = lower($1)
                ORDER BY id ASC LIMIT 1
                """,
                display_name.strip(),
            )
            return int(row["id"]) if row else None

    async def get_or_create_day(self, day: Optional[date] = None) -> DayRow:
        d = day or today_kyiv()
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "LunchDay" ("date", "status", "updatedAt")
                VALUES ($1, 'open', NOW())
                ON CONFLICT ("date") DO UPDATE SET "updatedAt" = "LunchDay"."updatedAt"
                RETURNING id, date, status, "menuMessageId", "payeeCard"
                """,
                d,
            )
            return _day_from_row(row)

    async def get_day(self, day: Optional[date] = None) -> Optional[DayRow]:
        d = day or today_kyiv()
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, date, status, "menuMessageId", "payeeCard"
                FROM "LunchDay" WHERE date = $1
                """,
                d,
            )
            return _day_from_row(row) if row else None

    async def set_day_status(self, day_id: int, status: str) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """UPDATE "LunchDay" SET status = $2, "updatedAt" = NOW() WHERE id = $1""",
                day_id,
                status,
            )

    async def replace_menu(
        self,
        day_id: int,
        items: list[tuple[str, int]],
        *,
        menu_message_id: Optional[int] = None,
        menu_photo_path: Optional[str] = None,
        parsed_raw: Optional[Any] = None,
        payee_card: Optional[str] = None,
    ) -> list[MenuItemRow]:
        """Замінити меню дня (видалити старі позиції) і поставити status=ordering."""
        raw_json = json.dumps(parsed_raw, ensure_ascii=False) if parsed_raw is not None else None
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    UPDATE "LunchDay" SET
                        "menuMessageId" = COALESCE($2, "menuMessageId"),
                        "menuPhotoPath" = COALESCE($3, "menuPhotoPath"),
                        "parsedRawJson" = COALESCE($4, "parsedRawJson"),
                        "payeeCard" = COALESCE($5, "payeeCard"),
                        status = 'ordering',
                        "updatedAt" = NOW()
                    WHERE id = $1
                    """,
                    day_id,
                    menu_message_id,
                    menu_photo_path,
                    raw_json,
                    payee_card,
                )
                await conn.execute("""DELETE FROM "LunchMenuItem" WHERE "dayId" = $1""", day_id)
                result: list[MenuItemRow] = []
                for name, price in items:
                    name = (name or "").strip()
                    if not name:
                        continue
                    price_i = int(price)
                    nn = normalize_dish_name(name)
                    row = await conn.fetchrow(
                        """
                        INSERT INTO "LunchMenuItem" ("dayId", name, "nameNorm", "priceUah")
                        VALUES ($1, $2, $3, $4)
                        RETURNING id, "dayId", name, "nameNorm", "priceUah"
                        """,
                        day_id,
                        name,
                        nn,
                        price_i,
                    )
                    result.append(
                        MenuItemRow(
                            id=int(row["id"]),
                            day_id=int(row["dayId"]),
                            name=row["name"],
                            name_norm=row["nameNorm"],
                            price_uah=int(row["priceUah"]),
                        )
                    )
                return result

    async def list_menu_items(self, day_id: int) -> list[MenuItemRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, "dayId", name, "nameNorm", "priceUah"
                FROM "LunchMenuItem" WHERE "dayId" = $1 ORDER BY id
                """,
                day_id,
            )
            return [
                MenuItemRow(
                    id=int(r["id"]),
                    day_id=int(r["dayId"]),
                    name=r["name"],
                    name_norm=r["nameNorm"],
                    price_uah=int(r["priceUah"]),
                )
                for r in rows
            ]

    async def upsert_order(
        self,
        day_id: int,
        participant_id: int,
        raw_text: str,
        total_uah: int,
        lines: list[OrderLineInput],
        source_message_id: Optional[int] = None,
    ) -> int:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO "LunchOrder"
                        ("dayId", "participantId", "sourceMessageId", "rawText", "totalUah", status, "updatedAt")
                    VALUES ($1, $2, $3, $4, $5, 'active', NOW())
                    ON CONFLICT ("dayId", "participantId") DO UPDATE SET
                        "sourceMessageId" = EXCLUDED."sourceMessageId",
                        "rawText" = EXCLUDED."rawText",
                        "totalUah" = EXCLUDED."totalUah",
                        status = 'active',
                        "updatedAt" = NOW()
                    RETURNING id
                    """,
                    day_id,
                    participant_id,
                    source_message_id,
                    raw_text,
                    total_uah,
                )
                order_id = int(row["id"])
                await conn.execute("""DELETE FROM "LunchOrderLine" WHERE "orderId" = $1""", order_id)
                for line in lines:
                    await conn.execute(
                        """
                        INSERT INTO "LunchOrderLine"
                            ("orderId", "menuItemId", "rawName", qty, "unitPriceUah", "lineTotalUah")
                        VALUES ($1, $2, $3, $4, $5, $6)
                        """,
                        order_id,
                        line.menu_item_id,
                        line.raw_name,
                        line.qty,
                        line.unit_price_uah,
                        line.line_total_uah,
                    )
                return order_id

    async def add_payment(
        self,
        day_id: int,
        participant_id: int,
        amount_uah: int,
        raw_text: str,
        source_message_id: Optional[int] = None,
    ) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "LunchPayment"
                    ("dayId", "participantId", "amountUah", "sourceMessageId", "rawText")
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                """,
                day_id,
                participant_id,
                amount_uah,
                source_message_id,
                raw_text,
            )
            return int(row["id"])

    async def participant_balance(self, day_id: int, participant_id: int) -> tuple[int, int, int]:
        """Повертає (ordered_total, paid_total, debt). debt > 0 — ще винні."""
        async with self.pool.acquire() as conn:
            ordered = await conn.fetchval(
                """
                SELECT COALESCE(SUM("totalUah"), 0) FROM "LunchOrder"
                WHERE "dayId" = $1 AND "participantId" = $2 AND status = 'active'
                """,
                day_id,
                participant_id,
            )
            paid = await conn.fetchval(
                """
                SELECT COALESCE(SUM("amountUah"), 0) FROM "LunchPayment"
                WHERE "dayId" = $1 AND "participantId" = $2
                """,
                day_id,
                participant_id,
            )
            o, p = int(ordered or 0), int(paid or 0)
            return o, p, o - p

    async def summary_rows(self, day_id: int) -> list[dict[str, Any]]:
        """Рядки зведення: учасник, rawText, total, paid, debt, lines."""
        async with self.pool.acquire() as conn:
            orders = await conn.fetch(
                """
                SELECT o.id, o."rawText", o."totalUah", p.id AS pid, p."displayName", p.username
                FROM "LunchOrder" o
                JOIN "LunchParticipant" p ON p.id = o."participantId"
                WHERE o."dayId" = $1 AND o.status = 'active'
                ORDER BY p."displayName"
                """,
                day_id,
            )
            payments = await conn.fetch(
                """
                SELECT "participantId", COALESCE(SUM("amountUah"), 0) AS paid
                FROM "LunchPayment" WHERE "dayId" = $1
                GROUP BY "participantId"
                """,
                day_id,
            )
            paid_map = {int(r["participantId"]): int(r["paid"]) for r in payments}
            result = []
            for o in orders:
                pid = int(o["pid"])
                total = int(o["totalUah"])
                paid = paid_map.get(pid, 0)
                lines = await conn.fetch(
                    """
                    SELECT "rawName", qty, "unitPriceUah", "lineTotalUah"
                    FROM "LunchOrderLine" WHERE "orderId" = $1 ORDER BY id
                    """,
                    int(o["id"]),
                )
                result.append(
                    {
                        "participant_id": pid,
                        "display_name": o["displayName"],
                        "username": o["username"],
                        "raw_text": o["rawText"],
                        "total_uah": total,
                        "paid_uah": paid,
                        "debt_uah": total - paid,
                        "lines": [dict(l) for l in lines],
                    }
                )
            return result

    async def debts(self, day_id: int) -> list[dict[str, Any]]:
        rows = await self.summary_rows(day_id)
        return [r for r in rows if r["debt_uah"] > 0]

    async def clear_day_orders_and_payments(self, day_id: int) -> None:
        """Видалити замовлення (з lines) та оплати за день. Меню лишається."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    DELETE FROM "LunchOrderLine"
                    WHERE "orderId" IN (SELECT id FROM "LunchOrder" WHERE "dayId" = $1)
                    """,
                    day_id,
                )
                await conn.execute("""DELETE FROM "LunchOrder" WHERE "dayId" = $1""", day_id)
                await conn.execute("""DELETE FROM "LunchPayment" WHERE "dayId" = $1""", day_id)

    async def fetch_pending_jobs(self, limit: int = 3) -> list[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, type FROM "LunchAdminJob"
                WHERE status = 'pending'
                ORDER BY "createdAt" ASC
                LIMIT $1
                """,
                limit,
            )
            return [{"id": int(r["id"]), "type": r["type"]} for r in rows]

    async def complete_job(self, job_id: int, result: Any) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "LunchAdminJob"
                SET status = 'done', "resultJson" = $2, "finishedAt" = NOW(), "errorText" = NULL
                WHERE id = $1
                """,
                job_id,
                json.dumps(result, ensure_ascii=False),
            )

    async def fail_job(self, job_id: int, error: str) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "LunchAdminJob"
                SET status = 'failed', "errorText" = $2, "finishedAt" = NOW()
                WHERE id = $1
                """,
                job_id,
                (error or "")[:2000],
            )

    async def fetch_pending_outbound(self, limit: int = 5) -> list[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, text FROM "LunchOutboundMessage"
                WHERE status = 'pending'
                ORDER BY "createdAt" ASC
                LIMIT $1
                """,
                limit,
            )
            return [{"id": int(r["id"]), "text": r["text"]} for r in rows]

    async def mark_outbound_sent(self, msg_id: int) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "LunchOutboundMessage"
                SET status = 'sent', "sentAt" = NOW(), "errorText" = NULL
                WHERE id = $1
                """,
                msg_id,
            )

    async def mark_outbound_failed(self, msg_id: int, error: str) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "LunchOutboundMessage"
                SET status = 'failed', "errorText" = $2
                WHERE id = $1
                """,
                msg_id,
                (error or "")[:2000],
            )


def _day_from_row(row: asyncpg.Record) -> DayRow:
    mid = row["menuMessageId"]
    return DayRow(
        id=int(row["id"]),
        date=row["date"],
        status=row["status"],
        menu_message_id=int(mid) if mid is not None else None,
        payee_card=row["payeeCard"],
    )
