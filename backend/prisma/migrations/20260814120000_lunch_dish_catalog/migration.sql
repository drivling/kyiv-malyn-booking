-- Каталог страв, синоніми, лотки, правка власної відповіді в групі

CREATE TABLE "LunchSettings" (
    "id" INTEGER NOT NULL,
    "trayPriceUah" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LunchSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LunchSettings" ("id", "trayPriceUah", "updatedAt") VALUES (1, 5, CURRENT_TIMESTAMP);

CREATE TABLE "LunchDish" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "priceUah" INTEGER NOT NULL,
    "trayRole" TEXT NOT NULL DEFAULT 'second',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LunchDish_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LunchDish_nameNorm_key" ON "LunchDish"("nameNorm");

CREATE TABLE "LunchDishSynonym" (
    "id" SERIAL NOT NULL,
    "dishId" INTEGER NOT NULL,
    "rawText" TEXT NOT NULL,
    "rawNorm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LunchDishSynonym_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LunchDishSynonym_dishId_rawNorm_key" ON "LunchDishSynonym"("dishId", "rawNorm");
CREATE INDEX "LunchDishSynonym_rawNorm_idx" ON "LunchDishSynonym"("rawNorm");

ALTER TABLE "LunchDishSynonym" ADD CONSTRAINT "LunchDishSynonym_dishId_fkey"
    FOREIGN KEY ("dishId") REFERENCES "LunchDish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "LunchDish" ("name", "nameNorm", "priceUah", "trayRole", "createdAt", "updatedAt")
SELECT DISTINCT ON ("nameNorm")
    "name",
    "nameNorm",
    "priceUah",
    'second',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "LunchMenuItem"
ORDER BY "nameNorm", "id" DESC;

UPDATE "LunchDish"
SET "trayRole" = 'soup'
WHERE "nameNorm" LIKE '%суп%'
   OR "nameNorm" LIKE '%борщ%'
   OR "nameNorm" LIKE '%солянка%'
   OR "nameNorm" LIKE '%розсольник%'
   OR "nameNorm" LIKE '%юшка%'
   OR "nameNorm" LIKE '%бульйон%';

UPDATE "LunchDish"
SET "trayRole" = 'salad'
WHERE "nameNorm" LIKE '%салат%';

ALTER TABLE "LunchMenuItem" ADD COLUMN "dishId" INTEGER;

UPDATE "LunchMenuItem" AS m
SET "dishId" = d.id
FROM "LunchDish" AS d
WHERE d."nameNorm" = m."nameNorm";

-- Згорнути дублікати (dayId, dishId): лишити мінімальний id
UPDATE "LunchOrderLine" AS l
SET "menuItemId" = kept.keep_id
FROM (
    SELECT "dayId", "dishId", MIN(id) AS keep_id
    FROM "LunchMenuItem"
    WHERE "dishId" IS NOT NULL
    GROUP BY "dayId", "dishId"
    HAVING COUNT(*) > 1
) AS kept
JOIN "LunchMenuItem" AS extra
  ON extra."dayId" = kept."dayId"
 AND extra."dishId" = kept."dishId"
 AND extra.id <> kept.keep_id
WHERE l."menuItemId" = extra.id;

DELETE FROM "LunchMenuItem" AS m
USING (
    SELECT "dayId", "dishId", MIN(id) AS keep_id
    FROM "LunchMenuItem"
    WHERE "dishId" IS NOT NULL
    GROUP BY "dayId", "dishId"
    HAVING COUNT(*) > 1
) AS kept
WHERE m."dayId" = kept."dayId"
  AND m."dishId" = kept."dishId"
  AND m.id <> kept.keep_id;

-- Якщо раптом лишились рядки без dishId — створити страву
INSERT INTO "LunchDish" ("name", "nameNorm", "priceUah", "trayRole", "createdAt", "updatedAt")
SELECT DISTINCT ON (m."nameNorm")
    m.name,
    m."nameNorm",
    m."priceUah",
    'second',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "LunchMenuItem" m
WHERE m."dishId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "LunchDish" d WHERE d."nameNorm" = m."nameNorm");

UPDATE "LunchMenuItem" AS m
SET "dishId" = d.id
FROM "LunchDish" AS d
WHERE m."dishId" IS NULL AND d."nameNorm" = m."nameNorm";

ALTER TABLE "LunchMenuItem" ALTER COLUMN "dishId" SET NOT NULL;

CREATE UNIQUE INDEX "LunchMenuItem_dayId_dishId_key" ON "LunchMenuItem"("dayId", "dishId");
CREATE INDEX "LunchMenuItem_dishId_idx" ON "LunchMenuItem"("dishId");

ALTER TABLE "LunchMenuItem" ADD CONSTRAINT "LunchMenuItem_dishId_fkey"
    FOREIGN KEY ("dishId") REFERENCES "LunchDish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LunchOrder" ADD COLUMN "replyMessageId" BIGINT;
ALTER TABLE "LunchOrder" ADD COLUMN "trayCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LunchOrder" ADD COLUMN "trayTotalUah" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LunchOrder" ADD COLUMN "trayCountManual" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LunchOrderLine" ADD COLUMN "dishId" INTEGER;
ALTER TABLE "LunchOrderLine" ADD COLUMN "unavailable" BOOLEAN NOT NULL DEFAULT false;

UPDATE "LunchOrderLine" AS l
SET "dishId" = m."dishId"
FROM "LunchMenuItem" AS m
WHERE l."menuItemId" = m.id AND l."dishId" IS NULL;

CREATE INDEX "LunchOrderLine_dishId_idx" ON "LunchOrderLine"("dishId");

ALTER TABLE "LunchOrderLine" ADD CONSTRAINT "LunchOrderLine_dishId_fkey"
    FOREIGN KEY ("dishId") REFERENCES "LunchDish"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LunchOutboundMessage" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'send';
ALTER TABLE "LunchOutboundMessage" ADD COLUMN "telegramMessageId" BIGINT;
ALTER TABLE "LunchOutboundMessage" ADD COLUMN "replyToMessageId" BIGINT;
