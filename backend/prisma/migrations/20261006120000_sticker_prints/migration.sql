-- StickerPrint: друк наклейок зупинок в адмінці (/admin/stickers) — для статистики відкриттів.

-- CreateTable
CREATE TABLE "StickerPrint" (
    "id" SERIAL NOT NULL,
    "stopId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerPrint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StickerPrint_stopId_side_idx" ON "StickerPrint"("stopId", "side");

