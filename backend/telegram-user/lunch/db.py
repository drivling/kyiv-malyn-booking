"""asyncpg CRUD для таблиць Lunch* (схема Prisma)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import asyncpg

from .util import compute_tray_count, guess_tray_role, normalize_dish_name

KYIV = ZoneInfo("Europe/Kyiv")


@dataclass
class MenuItemRow:
    id: int
    day_id: int
    name: str
    name_norm: str
    price_uah: int
    dish_id: Optional[int] = None
    tray_role: str = "second"
    synonym_norms: tuple[str, ...] = ()


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
    dish_id: Optional[int] = None
    as_written: str = ""
    tray_role: str = "second"
    unavailable: bool = False


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

    async def get_tray_price(self) -> int:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""SELECT "trayPriceUah" FROM "LunchSettings" WHERE id = 1""")
            if row:
                return int(row["trayPriceUah"])
            await conn.execute(
                """
                INSERT INTO "LunchSettings" (id, "trayPriceUah", "updatedAt")
                VALUES (1, 5, NOW())
                ON CONFLICT (id) DO NOTHING
                """
            )
            return 5

    async def _find_or_create_dish(self, conn: asyncpg.Connection, name: str, price: int) -> dict[str, Any]:
        nn = normalize_dish_name(name)
        row = await conn.fetchrow(
            """SELECT id, name, "nameNorm", "priceUah", "trayRole" FROM "LunchDish" WHERE "nameNorm" = $1""",
            nn,
        )
        if not row:
            syn = await conn.fetchrow(
                """
                SELECT d.id, d.name, d."nameNorm", d."priceUah", d."trayRole"
                FROM "LunchDishSynonym" s
                JOIN "LunchDish" d ON d.id = s."dishId"
                WHERE s."rawNorm" = $1
                LIMIT 1
                """,
                nn,
            )
            row = syn
        if row:
            updated = await conn.fetchrow(
                """
                UPDATE "LunchDish" SET "priceUah" = $2, "updatedAt" = NOW()
                WHERE id = $1
                RETURNING id, name, "nameNorm", "priceUah", "trayRole"
                """,
                int(row["id"]),
                int(price),
            )
            return dict(updated)
        created = await conn.fetchrow(
            """
            INSERT INTO "LunchDish" (name, "nameNorm", "priceUah", "trayRole", "updatedAt")
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, name, "nameNorm", "priceUah", "trayRole"
            """,
            name,
            nn,
            int(price),
            guess_tray_role(name),
        )
        return dict(created)

    async def save_synonym(self, dish_id: int, raw_text: str) -> None:
        raw = (raw_text or "").strip()
        raw_norm = normalize_dish_name(raw)
        if not raw or not raw_norm:
            return
        async with self.pool.acquire() as conn:
            dish = await conn.fetchrow("""SELECT "nameNorm" FROM "LunchDish" WHERE id = $1""", dish_id)
            if not dish or dish["nameNorm"] == raw_norm:
                return
            await conn.execute(
                """
                INSERT INTO "LunchDishSynonym" ("dishId", "rawText", "rawNorm")
                VALUES ($1, $2, $3)
                ON CONFLICT ("dishId", "rawNorm") DO NOTHING
                """,
                dish_id,
                raw,
                raw_norm,
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
        """Увімкнути страви дня з каталогу (без wipe каталогу). Оновлює ціни."""
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
                dish_ids: list[int] = []
                result: list[MenuItemRow] = []
                for name, price in items:
                    name = (name or "").strip()
                    if not name:
                        continue
                    dish = await self._find_or_create_dish(conn, name, int(price))
                    dish_id = int(dish["id"])
                    dish_ids.append(dish_id)
                    row = await conn.fetchrow(
                        """
                        INSERT INTO "LunchMenuItem"
                            ("dayId", "dishId", name, "nameNorm", "priceUah")
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT ("dayId", "dishId") DO UPDATE SET
                            "priceUah" = EXCLUDED."priceUah",
                            name = EXCLUDED.name,
                            "nameNorm" = EXCLUDED."nameNorm"
                        RETURNING id, "dayId", "dishId", name, "nameNorm", "priceUah"
                        """,
                        day_id,
                        dish_id,
                        dish["name"],
                        dish["nameNorm"],
                        int(dish["priceUah"]),
                    )
                    result.append(
                        MenuItemRow(
                            id=int(row["id"]),
                            day_id=int(row["dayId"]),
                            name=row["name"],
                            name_norm=row["nameNorm"],
                            price_uah=int(row["priceUah"]),
                            dish_id=dish_id,
                            tray_role=str(dish["trayRole"] or "second"),
                        )
                    )
                if dish_ids:
                    await conn.execute(
                        """DELETE FROM "LunchMenuItem" WHERE "dayId" = $1 AND "dishId" <> ALL($2::int[])""",
                        day_id,
                        dish_ids,
                    )
                else:
                    await conn.execute("""DELETE FROM "LunchMenuItem" WHERE "dayId" = $1""", day_id)
        return await self.list_menu_items(day_id)

    async def _rows_to_menu(self, conn: asyncpg.Connection, rows: list) -> list[MenuItemRow]:
        dish_ids = [int(r["dishId"]) for r in rows if r["dishId"] is not None]
        syn_map: dict[int, list[str]] = {}
        if dish_ids:
            syn_rows = await conn.fetch(
                """SELECT "dishId", "rawNorm" FROM "LunchDishSynonym" WHERE "dishId" = ANY($1::int[])""",
                dish_ids,
            )
            for s in syn_rows:
                syn_map.setdefault(int(s["dishId"]), []).append(s["rawNorm"])
        out: list[MenuItemRow] = []
        for r in rows:
            dish_id = int(r["dishId"]) if r["dishId"] is not None else None
            out.append(
                MenuItemRow(
                    id=int(r["id"]),
                    day_id=int(r["dayId"]),
                    name=r["name"],
                    name_norm=r["nameNorm"],
                    price_uah=int(r["priceUah"]),
                    dish_id=dish_id,
                    tray_role=str(r["trayRole"] or "second"),
                    synonym_norms=tuple(syn_map.get(dish_id or -1, [])),
                )
            )
        return out

    async def list_menu_items(self, day_id: int) -> list[MenuItemRow]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT m.id, m."dayId", m."dishId", m.name, m."nameNorm", m."priceUah",
                       COALESCE(d."trayRole", 'second') AS "trayRole"
                FROM "LunchMenuItem" m
                LEFT JOIN "LunchDish" d ON d.id = m."dishId"
                WHERE m."dayId" = $1
                ORDER BY m.id
                """,
                day_id,
            )
            return await self._rows_to_menu(conn, rows)

    async def get_fallback_menu(self, day_id: int) -> list[MenuItemRow]:
        """Меню попереднього дня, в якого вже були позиції."""
        async with self.pool.acquire() as conn:
            prev = await conn.fetchrow(
                """
                SELECT d.id FROM "LunchDay" d
                WHERE d.date < (SELECT date FROM "LunchDay" WHERE id = $1)
                  AND EXISTS (SELECT 1 FROM "LunchMenuItem" m WHERE m."dayId" = d.id)
                ORDER BY d.date DESC
                LIMIT 1
                """,
                day_id,
            )
        if not prev:
            return []
        return await self.list_menu_items(int(prev["id"]))

    async def apply_trays_to_lines(
        self, lines: list[OrderLineInput], tray_count_override: Optional[int] = None
    ) -> tuple[int, int, int]:
        """Повертає (tray_count, tray_total, food+tray total)."""
        tray_price = await self.get_tray_price()
        food = sum(l.line_total_uah for l in lines if not l.unavailable)
        trays = (
            int(tray_count_override)
            if tray_count_override is not None
            else compute_tray_count(lines)
        )
        tray_total = trays * tray_price
        return trays, tray_total, food + tray_total

    async def upsert_order(
        self,
        day_id: int,
        participant_id: int,
        raw_text: str,
        total_uah: int,
        lines: list[OrderLineInput],
        source_message_id: Optional[int] = None,
        unmatched_text: Optional[str] = None,
        reply_message_id: Optional[int] = None,
        tray_count: Optional[int] = None,
        tray_total_uah: Optional[int] = None,
        tray_count_manual: bool = False,
    ) -> int:
        if tray_count is None or tray_total_uah is None:
            trays, tray_sum, grand = await self.apply_trays_to_lines(lines)
            tray_count = trays
            tray_total_uah = tray_sum
            total_uah = grand
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO "LunchOrder"
                        ("dayId", "participantId", "sourceMessageId", "replyMessageId", "rawText",
                         "unmatchedText", "totalUah", "trayCount", "trayTotalUah", "trayCountManual",
                         status, "updatedAt")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())
                    ON CONFLICT ("dayId", "participantId") DO UPDATE SET
                        "sourceMessageId" = COALESCE(EXCLUDED."sourceMessageId", "LunchOrder"."sourceMessageId"),
                        "replyMessageId" = COALESCE(EXCLUDED."replyMessageId", "LunchOrder"."replyMessageId"),
                        "rawText" = EXCLUDED."rawText",
                        "unmatchedText" = EXCLUDED."unmatchedText",
                        "totalUah" = EXCLUDED."totalUah",
                        "trayCount" = EXCLUDED."trayCount",
                        "trayTotalUah" = EXCLUDED."trayTotalUah",
                        "trayCountManual" = EXCLUDED."trayCountManual",
                        status = 'active',
                        "updatedAt" = NOW()
                    RETURNING id
                    """,
                    day_id,
                    participant_id,
                    source_message_id,
                    reply_message_id,
                    raw_text,
                    unmatched_text,
                    total_uah,
                    tray_count,
                    tray_total_uah,
                    tray_count_manual,
                )
                order_id = int(row["id"])
                await conn.execute("""DELETE FROM "LunchOrderLine" WHERE "orderId" = $1""", order_id)
                for line in lines:
                    await conn.execute(
                        """
                        INSERT INTO "LunchOrderLine"
                            ("orderId", "menuItemId", "dishId", "rawName", qty,
                             "unitPriceUah", "lineTotalUah", unavailable)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        """,
                        order_id,
                        line.menu_item_id,
                        line.dish_id,
                        line.raw_name,
                        line.qty,
                        line.unit_price_uah,
                        line.line_total_uah,
                        line.unavailable,
                    )
                return order_id

    async def set_order_reply_message_id(self, order_id: int, reply_message_id: int) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """UPDATE "LunchOrder" SET "replyMessageId" = $2, "updatedAt" = NOW() WHERE id = $1""",
                order_id,
                reply_message_id,
            )

    async def set_order_reply_message_id_by_source(
        self, source_message_id: int, reply_message_id: int
    ) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "LunchOrder"
                SET "replyMessageId" = $2, "updatedAt" = NOW()
                WHERE "sourceMessageId" = $1
                """,
                source_message_id,
                reply_message_id,
            )

    async def set_reply_ids_by_source(self, day_id: int, source_to_reply: dict[int, int]) -> int:
        if not source_to_reply:
            return 0
        updated = 0
        async with self.pool.acquire() as conn:
            for source_id, reply_id in source_to_reply.items():
                result = await conn.execute(
                    """
                    UPDATE "LunchOrder"
                    SET "replyMessageId" = $3, "updatedAt" = NOW()
                    WHERE "dayId" = $1 AND "sourceMessageId" = $2
                    """,
                    day_id,
                    source_id,
                    reply_id,
                )
                if result and result.endswith("1"):
                    updated += 1
        return updated

    async def sync_orders_after_menu(self, day_id: int) -> list[dict[str, Any]]:
        """Перерахувати ціни/лотки; позначити страви, яких немає сьогодні. Повертає notices."""
        today = await self.list_menu_items(day_id)
        today_by_dish = {int(i.dish_id): i for i in today if i.dish_id}
        tray_price = await self.get_tray_price()
        notices: list[dict[str, Any]] = []
        async with self.pool.acquire() as conn:
            orders = await conn.fetch(
                """
                SELECT o.id, o."sourceMessageId", o."trayCountManual", o."trayCount",
                       p."displayName"
                FROM "LunchOrder" o
                JOIN "LunchParticipant" p ON p.id = o."participantId"
                WHERE o."dayId" = $1 AND o.status = 'active'
                """,
                day_id,
            )
            for o in orders:
                order_id = int(o["id"])
                lines = await conn.fetch(
                    """
                    SELECT l.id, l."dishId", l.qty, l."lineTotalUah", l."rawName",
                           d.name AS dish_name, d."trayRole"
                    FROM "LunchOrderLine" l
                    LEFT JOIN "LunchDish" d ON d.id = l."dishId"
                    WHERE l."orderId" = $1
                    ORDER BY l.id
                    """,
                    order_id,
                )
                missing: list[str] = []
                food = 0
                role_lines = []
                for line in lines:
                    dish_id = int(line["dishId"]) if line["dishId"] is not None else None
                    today_item = today_by_dish.get(dish_id) if dish_id else None
                    qty = int(line["qty"] or 1)
                    if today_item:
                        unit = today_item.price_uah
                        lt = unit * qty
                        food += lt
                        role_lines.append(
                            OrderLineInput(
                                menu_item_id=today_item.id,
                                dish_id=today_item.dish_id,
                                raw_name=today_item.name,
                                qty=qty,
                                unit_price_uah=unit,
                                line_total_uah=lt,
                                tray_role=today_item.tray_role,
                            )
                        )
                        await conn.execute(
                            """
                            UPDATE "LunchOrderLine"
                            SET "menuItemId" = $2, "unitPriceUah" = $3, "lineTotalUah" = $4,
                                unavailable = false, "rawName" = $5
                            WHERE id = $1
                            """,
                            int(line["id"]),
                            today_item.id,
                            unit,
                            lt,
                            today_item.name,
                        )
                    else:
                        name = line["dish_name"] or line["rawName"]
                        missing.append(name)
                        food += int(line["lineTotalUah"] or 0)
                        role_lines.append(
                            OrderLineInput(
                                menu_item_id=None,
                                dish_id=dish_id,
                                raw_name=name,
                                qty=qty,
                                unit_price_uah=0,
                                line_total_uah=int(line["lineTotalUah"] or 0),
                                tray_role=str(line["trayRole"] or "second"),
                                unavailable=True,
                            )
                        )
                        await conn.execute(
                            """UPDATE "LunchOrderLine" SET unavailable = true, "menuItemId" = NULL WHERE id = $1""",
                            int(line["id"]),
                        )
                if o["trayCountManual"]:
                    trays = int(o["trayCount"] or 0)
                else:
                    trays = compute_tray_count(role_lines)
                tray_total = trays * tray_price
                await conn.execute(
                    """
                    UPDATE "LunchOrder"
                    SET "trayCount" = $2, "trayTotalUah" = $3, "totalUah" = $4, "updatedAt" = NOW()
                    WHERE id = $1
                    """,
                    order_id,
                    trays,
                    tray_total,
                    food + tray_total,
                )
                if missing:
                    mid = o["sourceMessageId"]
                    notices.append(
                        {
                            "order_id": order_id,
                            "display_name": o["displayName"],
                            "source_message_id": int(mid) if mid is not None else None,
                            "missing_dishes": missing,
                        }
                    )
        return notices

    async def enqueue_outbound(
        self,
        text: str,
        *,
        kind: str = "send",
        telegram_message_id: Optional[int] = None,
        reply_to_message_id: Optional[int] = None,
    ) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "LunchOutboundMessage"
                    (text, kind, "telegramMessageId", "replyToMessageId", status)
                VALUES ($1, $2, $3, $4, 'pending')
                """,
                text,
                kind,
                telegram_message_id,
                reply_to_message_id,
            )

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
                SELECT o.id, o."rawText", o."unmatchedText", o."totalUah",
                       o."trayCount", o."trayTotalUah",
                       p.id AS pid, p."displayName", p.username
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
                    SELECT l."menuItemId", l."dishId", l."rawName", l.qty, l."unitPriceUah",
                           l."lineTotalUah", l.unavailable,
                           COALESCE(d.name, m.name) AS "menuItemName"
                    FROM "LunchOrderLine" l
                    LEFT JOIN "LunchMenuItem" m ON m.id = l."menuItemId"
                    LEFT JOIN "LunchDish" d ON d.id = l."dishId"
                    WHERE l."orderId" = $1
                    ORDER BY l.id
                    """,
                    int(o["id"]),
                )
                result.append(
                    {
                        "participant_id": pid,
                        "display_name": o["displayName"],
                        "username": o["username"],
                        "raw_text": o["rawText"],
                        "unmatched_text": o["unmatchedText"],
                        "total_uah": total,
                        "tray_count": int(o["trayCount"] or 0),
                        "tray_total_uah": int(o["trayTotalUah"] or 0),
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
                SELECT id, text, kind, "telegramMessageId", "replyToMessageId"
                FROM "LunchOutboundMessage"
                WHERE status = 'pending'
                ORDER BY "createdAt" ASC
                LIMIT $1
                """,
                limit,
            )
            return [
                {
                    "id": int(r["id"]),
                    "text": r["text"],
                    "kind": r["kind"] or "send",
                    "telegram_message_id": int(r["telegramMessageId"]) if r["telegramMessageId"] is not None else None,
                    "reply_to_message_id": int(r["replyToMessageId"]) if r["replyToMessageId"] is not None else None,
                }
                for r in rows
            ]

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
