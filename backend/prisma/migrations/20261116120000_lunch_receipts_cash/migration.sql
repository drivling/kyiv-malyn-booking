-- Обіди: чеки оплати з фото/PDF, посилання на чек, «віддам готівкою».
-- Звідки оплата: text (чат) | admin (кнопка) | receipt (сума з чека) | link (посилання, суму не перевірено).
ALTER TABLE "LunchPayment" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'text';
UPDATE "LunchPayment" SET "source" = 'admin' WHERE "sourceMessageId" IS NULL AND "rawText" LIKE 'admin pay %';

-- Людина пообіцяла готівку.
ALTER TABLE "LunchOrder" ADD COLUMN "cashPromised" BOOLEAN NOT NULL DEFAULT false;

-- Журнал розпізнаних фото й PDF (одне повідомлення — один запит до моделі).
CREATE TABLE "LunchMediaScan" (
    "id" SERIAL NOT NULL,
    "dayId" INTEGER NOT NULL,
    "tgMessageId" BIGINT NOT NULL,
    "senderTgId" TEXT,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountUah" INTEGER,
    "model" TEXT,
    "rawJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LunchMediaScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LunchMediaScan_dayId_tgMessageId_key" ON "LunchMediaScan"("dayId", "tgMessageId");

ALTER TABLE "LunchMediaScan" ADD CONSTRAINT "LunchMediaScan_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "LunchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
