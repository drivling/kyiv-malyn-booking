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


def resolve_synonym_owners(
    rows: list[tuple[int, int, str]], dish_names: Optional[dict[int, str]] = None
) -> dict[str, int]:
    """(synonym_id, dish_id, raw_norm) → {raw_norm: dish_id}.

    Той самий текст може лежати на кількох стравах (історичні автосиноніми). Кого вважати власником:
      * якщо відомі назви страв (dish_names: dish_id → нормалізована назва) — той, чия назва найбільше
        схожа на текст синоніма: «салат грецький» належить «Салат Грецький», а не «Овочевий мікс», на який
        його колись хибно навчив бот (хибний автосиномім зазвичай НОВІШИЙ за правильний);
      * серед однаково схожих (різниця до 0.1) — найновіший запис (більший id): остання правка людини.
    Без назв — просто найновіший."""
    by_text: dict[str, list[tuple[int, int]]] = {}
    for syn_id, dish_id, raw_norm in rows:
        by_text.setdefault(raw_norm, []).append((syn_id, dish_id))
    out: dict[str, int] = {}
    for raw_norm, cands in by_text.items():
        if len(cands) == 1 or not dish_names:
            out[raw_norm] = max(cands)[1]
            continue
        from .parse_order import _similarity  # lazy: parse_order імпортує цей модуль

        scored = [(_similarity(raw_norm, dish_names.get(d, "")), sid, d) for sid, d in cands]
        best = max(sc for sc, _sid, _d in scored)
        out[raw_norm] = max((sid, d) for sc, sid, d in scored if sc >= best - 0.1)[1]
    return out


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
                ORDER BY s.id DESC
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
            # Усі власники тих самих rawNorm (навіть страви, яких сьогодні немає в меню):
            # синонім належить тому, кого додали останнім, а не «першому в меню».
            syn_rows = await conn.fetch(
                """
                SELECT s.id, s."dishId", s."rawNorm", d."nameNorm" AS "dishNameNorm"
                FROM "LunchDishSynonym" s
                JOIN "LunchDish" d ON d.id = s."dishId"
                WHERE s."rawNorm" IN (
                    SELECT "rawNorm" FROM "LunchDishSynonym" WHERE "dishId" = ANY($1::int[])
                )
                ORDER BY s.id
                """,
                dish_ids,
            )
            owners = resolve_synonym_owners(
                [(int(s["id"]), int(s["dishId"]), s["rawNorm"]) for s in syn_rows],
                {int(s["dishId"]): s["dishNameNorm"] for s in syn_rows},
            )
            on_menu = set(dish_ids)
            for raw_norm, owner in owners.items():
                if owner in on_menu:
                    syn_map.setdefault(owner, []).append(raw_norm)
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

    async def find_order_source_by_reply_id(self, reply_message_id: int) -> Optional[int]:
        """Повідомлення людини, до якого належить наша відповідь (для fallback, коли edit неможливий)."""
        async with self.pool.acquire() as conn:
            val = await conn.fetchval(
                """
                SELECT "sourceMessageId" FROM "LunchOrder"
                WHERE "replyMessageId" = $1 AND "sourceMessageId" IS NOT NULL
                ORDER BY id DESC LIMIT 1
                """,
                int(reply_message_id),
            )
            return int(val) if val is not None else None

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
        target: str = "lunch",
    ) -> None:
        """target: 'lunch' — група обідів (markdown), 'saved' — «Обране» власника (HTML, Джура)."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "LunchOutboundMessage"
                    (text, kind, "telegramMessageId", "replyToMessageId", target, status)
                VALUES ($1, $2, $3, $4, $5, 'pending')
                """,
                text,
                kind,
                telegram_message_id,
                reply_to_message_id,
                target,
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

    async def get_day_status(self, day_id: int) -> Optional[str]:
        async with self.pool.acquire() as conn:
            return await conn.fetchval("""SELECT status FROM "LunchDay" WHERE id = $1""", day_id)

    async def set_payee_card(self, day_id: int, card: str) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """UPDATE "LunchDay" SET "payeeCard" = $2, "updatedAt" = NOW() WHERE id = $1""",
                day_id,
                card,
            )

    async def find_participant_id_by_telegram_id(self, telegram_user_id: str) -> Optional[int]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT id FROM "LunchParticipant" WHERE "telegramUserId" = $1""",
                str(telegram_user_id),
            )
            return int(row["id"]) if row else None

    async def has_active_order(self, day_id: int, participant_id: int) -> bool:
        async with self.pool.acquire() as conn:
            return bool(
                await conn.fetchval(
                    """
                    SELECT 1 FROM "LunchOrder"
                    WHERE "dayId" = $1 AND "participantId" = $2 AND status = 'active'
                    """,
                    day_id,
                    participant_id,
                )
            )

    async def has_order(self, day_id: int, participant_id: int) -> bool:
        """Є запис замовлення в будь-якому статусі (скасоване адміном теж — його не воскрешаємо)."""
        async with self.pool.acquire() as conn:
            return bool(
                await conn.fetchval(
                    """SELECT 1 FROM "LunchOrder" WHERE "dayId" = $1 AND "participantId" = $2""",
                    day_id,
                    participant_id,
                )
            )

    async def today_menu_signature(self) -> str:
        """Склад меню на сьогодні рядком ('' — меню немає): змінився → є що дозібрати."""
        async with self.pool.acquire() as conn:
            return str(
                await conn.fetchval(
                    """
                    SELECT COALESCE(string_agg(m."dishId"::text, ',' ORDER BY m."dishId"), '')
                    FROM "LunchMenuItem" m JOIN "LunchDay" d ON d.id = m."dayId"
                    WHERE d.date = $1
                    """,
                    today_kyiv(),
                )
                or ""
            )

    async def list_incomplete_orders(self, day_id: int) -> list[dict[str, Any]]:
        """Активні замовлення, де є нерозпізнаний текст або страва, якої немає в меню (unavailable):
        після появи/зміни меню їх варто розібрати ще раз. Рядки — вже як OrderLineInput."""
        async with self.pool.acquire() as conn:
            orders = await conn.fetch(
                """
                SELECT o.id, o."participantId", o."sourceMessageId", o."replyMessageId", o."rawText",
                       o."unmatchedText", o."trayCount", o."trayCountManual", p."displayName"
                FROM "LunchOrder" o
                JOIN "LunchParticipant" p ON p.id = o."participantId"
                WHERE o."dayId" = $1 AND o.status = 'active'
                  AND (
                    COALESCE(o."unmatchedText", '') <> ''
                    OR EXISTS (
                        SELECT 1 FROM "LunchOrderLine" l WHERE l."orderId" = o.id AND l.unavailable
                    )
                  )
                ORDER BY o.id
                """,
                day_id,
            )
            out: list[dict[str, Any]] = []
            for o in orders:
                rows = await conn.fetch(
                    """
                    SELECT l."menuItemId", l."dishId", l."rawName", l.qty, l."unitPriceUah",
                           l."lineTotalUah", l.unavailable, COALESCE(d."trayRole", 'second') AS "trayRole"
                    FROM "LunchOrderLine" l
                    LEFT JOIN "LunchDish" d ON d.id = l."dishId"
                    WHERE l."orderId" = $1
                    ORDER BY l.id
                    """,
                    int(o["id"]),
                )
                out.append(
                    {
                        "order_id": int(o["id"]),
                        "participant_id": int(o["participantId"]),
                        "display_name": o["displayName"],
                        "source_message_id": int(o["sourceMessageId"]) if o["sourceMessageId"] is not None else None,
                        "reply_message_id": int(o["replyMessageId"]) if o["replyMessageId"] is not None else None,
                        "raw_text": o["rawText"],
                        "unmatched_text": o["unmatchedText"],
                        "tray_count": int(o["trayCount"] or 0),
                        "tray_count_manual": bool(o["trayCountManual"]),
                        "lines": [
                            OrderLineInput(
                                menu_item_id=int(r["menuItemId"]) if r["menuItemId"] is not None else None,
                                dish_id=int(r["dishId"]) if r["dishId"] is not None else None,
                                raw_name=r["rawName"],
                                qty=int(r["qty"] or 1),
                                unit_price_uah=int(r["unitPriceUah"]),
                                line_total_uah=int(r["lineTotalUah"]),
                                tray_role=str(r["trayRole"] or "second"),
                                unavailable=bool(r["unavailable"]),
                            )
                            for r in rows
                        ],
                    }
                )
            return out

    async def payment_source_exists(self, day_id: int, source_message_id: int) -> bool:
        async with self.pool.acquire() as conn:
            return bool(
                await conn.fetchval(
                    """SELECT 1 FROM "LunchPayment" WHERE "dayId" = $1 AND "sourceMessageId" = $2""",
                    day_id,
                    source_message_id,
                )
            )

    async def known_source_message_ids(self, day_id: int) -> set[int]:
        """id повідомлень, з яких за день уже є замовлення/оплата (для catch-up без дублів)."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT "sourceMessageId" AS mid FROM "LunchOrder"
                WHERE "dayId" = $1 AND "sourceMessageId" IS NOT NULL
                UNION
                SELECT "sourceMessageId" AS mid FROM "LunchPayment"
                WHERE "dayId" = $1 AND "sourceMessageId" IS NOT NULL
                """,
                day_id,
            )
        return {int(r["mid"]) for r in rows}

    async def get_participant_name(self, participant_id: Optional[int]) -> Optional[str]:
        if participant_id is None:
            return None
        async with self.pool.acquire() as conn:
            return await conn.fetchval(
                """SELECT "displayName" FROM "LunchParticipant" WHERE id = $1""", participant_id
            )

    async def dzhura_sender_messages(
        self,
        tg_chat_id: int,
        tg_user_id: int,
        start_utc: datetime,
        end_utc: datetime,
    ) -> list[dict[str, Any]]:
        """Повідомлення людини з групи за проміжок — з бази «Джури» (без звернення до Telegram).
        Містить і правки (останній текст), і видалені (deletedAt) — їх пропускаємо на боці виклику."""
        lo = start_utc.astimezone(timezone.utc).replace(tzinfo=None)
        hi = end_utc.astimezone(timezone.utc).replace(tzinfo=None)
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT m."tgMessageId" AS mid, m.text, m."sentAt", m."editedAt", m."deletedAt",
                       m."mediaKind", m."isOutgoing", p."firstName", p."lastName", p.username
                FROM "DzhuraMessage" m
                JOIN "DzhuraChat" c ON c.id = m."chatId"
                JOIN "DzhuraPerson" p ON p.id = m."senderPersonId"
                WHERE c."tgChatId" = $1 AND p."tgUserId" = $2
                  AND m."sentAt" >= $3 AND m."sentAt" <= $4
                ORDER BY m."sentAt" ASC, m."tgMessageId" ASC
                """,
                int(tg_chat_id),
                int(tg_user_id),
                lo,
                hi,
            )
        return [
            {
                "id": int(r["mid"]),
                "text": r["text"] or "",
                "date": r["sentAt"].replace(tzinfo=timezone.utc),
                "edited": r["editedAt"] is not None,
                "deleted": r["deletedAt"] is not None,
                "media": r["mediaKind"],
                "outgoing": bool(r["isOutgoing"]),
                "first_name": r["firstName"],
                "last_name": r["lastName"],
                "username": r["username"],
            }
            for r in rows
        ]

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
                SELECT id, type, "paramsJson" FROM "LunchAdminJob"
                WHERE status = 'pending'
                ORDER BY "createdAt" ASC
                LIMIT $1
                """,
                limit,
            )
            out: list[dict[str, Any]] = []
            for r in rows:
                params: dict[str, Any] = {}
                if r["paramsJson"]:
                    try:
                        loaded = json.loads(r["paramsJson"])
                        if isinstance(loaded, dict):
                            params = loaded
                    except ValueError:
                        params = {}
                out.append({"id": int(r["id"]), "type": r["type"], "params": params})
            return out

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
                SELECT id, text, kind, "telegramMessageId", "replyToMessageId", target, attempts
                FROM "LunchOutboundMessage"
                WHERE status = 'pending'
                  AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
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
                    "target": r["target"] or "lunch",
                    "attempts": int(r["attempts"] or 0),
                }
                for r in rows
            ]

    async def mark_outbound_retry(self, msg_id: int, error: str, delay_sec: int) -> None:
        """Лишити pending, але взяти знову не раніше ніж через delay_sec (ретрай з паузою)."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "LunchOutboundMessage"
                SET attempts = attempts + 1,
                    "nextAttemptAt" = NOW() + ($3::int * INTERVAL '1 second'),
                    "errorText" = $2
                WHERE id = $1
                """,
                msg_id,
                (error or "")[:2000],
                max(1, int(delay_sec)),
            )

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
                SET status = 'failed', "errorText" = $2, attempts = attempts + 1
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
