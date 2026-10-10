-- StickerScan.clientId: анонімний id браузера (унікальні люди з наклейок).
-- StickerReturn: людина з наклейки знову відкрила сайт (раз за сесію).

-- AlterTable
ALTER TABLE "StickerScan" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE INDEX "StickerScan_clientId_idx" ON "StickerScan"("clientId");

-- CreateTable
CREATE TABLE "StickerReturn" (
    "id" SERIAL NOT NULL,
    "stopId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StickerReturn_stopId_side_idx" ON "StickerReturn"("stopId", "side");

-- CreateIndex
CREATE INDEX "StickerReturn_clientId_idx" ON "StickerReturn"("clientId");

-- CreateIndex
CREATE INDEX "StickerReturn_createdAt_idx" ON "StickerReturn"("createdAt");
