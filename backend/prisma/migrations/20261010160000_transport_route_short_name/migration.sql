-- Номер маршруту для показу (як route_short_name у GTFS): «11/1», «5А» тощо. Ключ маршруту (id) не змінюється —
-- адреси /transport/route/<id>, рейси, сегменти й кольори схеми лишаються прив'язані до id. Порожньо — показуємо id.

ALTER TABLE "TransportRoute" ADD COLUMN "shortName" TEXT NOT NULL DEFAULT '';

-- Маршрут №11 на листку розкладу 2026-10-10 — «11/1» (Docs/route-11-1-2026-10.md). Повторний запуск — no-op.
UPDATE "TransportRoute" SET "shortName" = '11/1' WHERE "id" = '11' AND "shortName" = '';
