-- Tenancy M1 (Docs/transport-tenancy-2026-11.md, Docs/korosten-transport-2026-11.md фаза 3): колонка міста на
-- всіх таблицях міського транспорту. Лише додавання: наявні рядки — Малин (DEFAULT), первинні ключі не
-- змінюються (це M2), TransportMeta.updatedAt не зачіпається — revision / ETag / feed_version ті самі.
-- Код попереднього деплою колонку не бачить і працює далі, тож відкат коду без відкату міграції безпечний.

ALTER TABLE "TransportStop" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "TransportRoute" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "TransportRouteStop" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "TransportTrip" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "TransportSegment" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "TransportMeta" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "TransportRevision" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "StickerScan" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "StickerReturn" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "StickerPrint" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';
ALTER TABLE "TransportArrivalReport" ADD COLUMN "cityCode" TEXT NOT NULL DEFAULT 'Malyn';

CREATE INDEX "TransportStop_cityCode_idx" ON "TransportStop"("cityCode");
CREATE INDEX "TransportRoute_cityCode_idx" ON "TransportRoute"("cityCode");
CREATE INDEX "TransportRouteStop_cityCode_idx" ON "TransportRouteStop"("cityCode");
CREATE INDEX "TransportTrip_cityCode_idx" ON "TransportTrip"("cityCode");
CREATE INDEX "TransportSegment_cityCode_idx" ON "TransportSegment"("cityCode");
CREATE INDEX "StickerPrint_cityCode_idx" ON "StickerPrint"("cityCode");
CREATE INDEX "TransportRevision_cityCode_createdAt_idx" ON "TransportRevision"("cityCode", "createdAt");
CREATE INDEX "StickerScan_cityCode_createdAt_idx" ON "StickerScan"("cityCode", "createdAt");
CREATE INDEX "StickerReturn_cityCode_createdAt_idx" ON "StickerReturn"("cityCode", "createdAt");
CREATE INDEX "TransportArrivalReport_cityCode_createdAt_idx" ON "TransportArrivalReport"("cityCode", "createdAt");

-- Один рядок мети на місто (зараз рядок один — Малин)
CREATE UNIQUE INDEX "TransportMeta_cityCode_key" ON "TransportMeta"("cityCode");
