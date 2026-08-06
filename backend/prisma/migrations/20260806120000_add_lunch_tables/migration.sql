-- Обіди: день меню, позиції, учасники, замовлення, оплати

CREATE TABLE "LunchDay" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "menuMessageId" BIGINT,
    "menuPhotoPath" TEXT,
    "parsedRawJson" TEXT,
    "payeeCard" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LunchDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LunchDay_date_key" ON "LunchDay"("date");

CREATE TABLE "LunchMenuItem" (
    "id" SERIAL NOT NULL,
    "dayId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "priceUah" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LunchMenuItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LunchMenuItem_dayId_idx" ON "LunchMenuItem"("dayId");
CREATE INDEX "LunchMenuItem_dayId_nameNorm_idx" ON "LunchMenuItem"("dayId", "nameNorm");

CREATE TABLE "LunchParticipant" (
    "id" SERIAL NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LunchParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LunchParticipant_telegramUserId_key" ON "LunchParticipant"("telegramUserId");

CREATE TABLE "LunchOrder" (
    "id" SERIAL NOT NULL,
    "dayId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "sourceMessageId" BIGINT,
    "rawText" TEXT NOT NULL,
    "totalUah" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LunchOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LunchOrder_dayId_participantId_key" ON "LunchOrder"("dayId", "participantId");
CREATE INDEX "LunchOrder_dayId_idx" ON "LunchOrder"("dayId");
CREATE INDEX "LunchOrder_participantId_idx" ON "LunchOrder"("participantId");

CREATE TABLE "LunchOrderLine" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "menuItemId" INTEGER,
    "rawName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceUah" INTEGER NOT NULL,
    "lineTotalUah" INTEGER NOT NULL,

    CONSTRAINT "LunchOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LunchOrderLine_orderId_idx" ON "LunchOrderLine"("orderId");

CREATE TABLE "LunchPayment" (
    "id" SERIAL NOT NULL,
    "dayId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "amountUah" INTEGER NOT NULL,
    "sourceMessageId" BIGINT,
    "rawText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LunchPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LunchPayment_dayId_idx" ON "LunchPayment"("dayId");
CREATE INDEX "LunchPayment_participantId_idx" ON "LunchPayment"("participantId");
CREATE INDEX "LunchPayment_dayId_participantId_idx" ON "LunchPayment"("dayId", "participantId");

ALTER TABLE "LunchMenuItem" ADD CONSTRAINT "LunchMenuItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "LunchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LunchOrder" ADD CONSTRAINT "LunchOrder_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "LunchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LunchOrder" ADD CONSTRAINT "LunchOrder_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "LunchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LunchOrderLine" ADD CONSTRAINT "LunchOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LunchOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LunchOrderLine" ADD CONSTRAINT "LunchOrderLine_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "LunchMenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LunchPayment" ADD CONSTRAINT "LunchPayment_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "LunchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LunchPayment" ADD CONSTRAINT "LunchPayment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "LunchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
