-- Люди з QR-наклейок (Docs/stop-stickers.md, «Люди з наклейок»): рядок на анонімний id браузера в місті
CREATE TABLE "StickerPerson" (
    "cityCode" TEXT NOT NULL DEFAULT 'Malyn',
    "id" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstStopId" TEXT NOT NULL,
    "firstSide" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lastStopId" TEXT NOT NULL,
    "lastSide" TEXT NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,
    "scans" INTEGER NOT NULL DEFAULT 0,
    "stopIds" TEXT[],
    "scanDays" INTEGER NOT NULL DEFAULT 0,
    "lastScanDay" TEXT,
    "returns" INTEGER NOT NULL DEFAULT 0,
    "lastReturnAt" TIMESTAMP(3),
    "teaserAt" TIMESTAMP(3),

    CONSTRAINT "StickerPerson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StickerPerson_cityCode_firstAt_idx" ON "StickerPerson"("cityCode", "firstAt");
CREATE INDEX "StickerPerson_cityCode_lastAt_idx" ON "StickerPerson"("cityCode", "lastAt");
CREATE UNIQUE INDEX "StickerPerson_cityCode_clientId_key" ON "StickerPerson"("cityCode", "clientId");

-- Бекфіл: усі, кого вже знаємо за анонімним id (скани з clientId — від 10.10.2026, повернення, тизер). Вставка за
-- часом першої появи, тож номер пасажира (порядок id у місті) у старих людей теж іде за часом. Доби — київські:
-- "createdAt" зберігається в UTC без поясу.
WITH scans AS (
    SELECT "id", "cityCode", "clientId", "stopId", "side", "createdAt",
           to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD') AS "day"
    FROM "StickerScan"
    WHERE "clientId" IS NOT NULL
),
scanners AS (
    SELECT "cityCode", "clientId",
           (array_agg("stopId" ORDER BY "createdAt", "id"))[1] AS "firstStopId",
           (array_agg("side" ORDER BY "createdAt", "id"))[1] AS "firstSide",
           min("createdAt") AS "firstAt",
           (array_agg("stopId" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "lastStopId",
           (array_agg("side" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "lastSide",
           max("createdAt") AS "lastAt",
           count(*)::int AS "scans",
           count(DISTINCT "day")::int AS "scanDays",
           max("day") AS "lastScanDay"
    FROM scans
    GROUP BY "cityCode", "clientId"
),
stops AS (
    SELECT "cityCode", "clientId", array_agg("stopId" ORDER BY "firstSeen", "stopId") AS "stopIds"
    FROM (
        SELECT "cityCode", "clientId", "stopId", min("createdAt") AS "firstSeen"
        FROM scans
        GROUP BY "cityCode", "clientId", "stopId"
    ) s
    GROUP BY "cityCode", "clientId"
),
rets AS (
    SELECT "cityCode", "clientId", count(*)::int AS "returns", max("createdAt") AS "lastReturnAt"
    FROM "StickerReturn"
    GROUP BY "cityCode", "clientId"
),
-- повернулись, але жодного скану з id немає (сканували до 10.10.2026): перша наклейка — з повернення
returners AS (
    SELECT DISTINCT ON (r."cityCode", r."clientId")
           r."cityCode", r."clientId", r."stopId", r."side", r."createdAt"
    FROM "StickerReturn" r
    WHERE NOT EXISTS (SELECT 1 FROM scanners s WHERE s."cityCode" = r."cityCode" AND s."clientId" = r."clientId")
    ORDER BY r."cityCode", r."clientId", r."createdAt", r."id"
),
teaser AS (
    SELECT "cityCode", "clientId", min("createdAt") AS "teaserAt"
    FROM "AdEvent"
    WHERE "placement" = 'sticker' AND "event" = 'completed' AND "clientId" IS NOT NULL
    GROUP BY "cityCode", "clientId"
),
people AS (
    SELECT s."cityCode", s."clientId", s."firstStopId", s."firstSide", s."firstAt", s."lastStopId", s."lastSide", s."lastAt",
           s."scans", st."stopIds", s."scanDays", s."lastScanDay"
    FROM scanners s
    JOIN stops st ON st."cityCode" = s."cityCode" AND st."clientId" = s."clientId"
    UNION ALL
    SELECT "cityCode", "clientId", "stopId", "side", "createdAt", "stopId", "side", "createdAt",
           0, ARRAY["stopId"], 0, NULL
    FROM returners
)
INSERT INTO "StickerPerson" (
    "cityCode", "clientId", "firstStopId", "firstSide", "firstAt", "lastStopId", "lastSide", "lastAt",
    "scans", "stopIds", "scanDays", "lastScanDay", "returns", "lastReturnAt", "teaserAt"
)
SELECT p."cityCode", p."clientId", p."firstStopId", p."firstSide", p."firstAt", p."lastStopId", p."lastSide", p."lastAt",
       p."scans", p."stopIds", p."scanDays", p."lastScanDay",
       coalesce(r."returns", 0), r."lastReturnAt", t."teaserAt"
FROM people p
LEFT JOIN rets r ON r."cityCode" = p."cityCode" AND r."clientId" = p."clientId"
LEFT JOIN teaser t ON t."cityCode" = p."cityCode" AND t."clientId" = p."clientId"
ORDER BY p."firstAt", p."clientId";
