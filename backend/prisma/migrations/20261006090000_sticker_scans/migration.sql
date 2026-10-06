-- StickerScan: відкриття табло з QR-наклейок на зупинках (/admin/stickers).

-- CreateTable
CREATE TABLE "StickerScan" (
    "id" SERIAL NOT NULL,
    "stopId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StickerScan_stopId_side_idx" ON "StickerScan"("stopId", "side");

-- CreateIndex
CREATE INDEX "StickerScan_createdAt_idx" ON "StickerScan"("createdAt");

