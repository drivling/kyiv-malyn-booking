-- Tenancy M2 (Docs/transport-tenancy-2026-11.md, Docs/korosten-transport-2026-11.md фаза 4): ключі транспортних
-- таблиць стають складеними з містом, щоб у двох містах могли бути маршрут «1» і зупинка st_0001.
-- Рядки не змінюються (усі наявні — cityCode 'Malyn'), TransportMeta.updatedAt не зачіпається — revision / ETag /
-- feed_version ті самі. DEFAULT 'Malyn' на cityCode лишається: код попередніх деплоїв працює й на цій схемі.
-- SQL зміни ключів згенеровано `prisma migrate diff`; руками додано лише setval послідовності мети.
-- Один файл = одна транзакція (Postgres виконує багатооператорний запит цілком або ніяк).

-- DropForeignKey
ALTER TABLE "TransportRouteStop" DROP CONSTRAINT "TransportRouteStop_routeId_fkey";

-- DropForeignKey
ALTER TABLE "TransportRouteStop" DROP CONSTRAINT "TransportRouteStop_stopId_fkey";

-- DropForeignKey
ALTER TABLE "TransportSegment" DROP CONSTRAINT "TransportSegment_routeId_fkey";

-- DropForeignKey
ALTER TABLE "TransportTrip" DROP CONSTRAINT "TransportTrip_routeId_fkey";

-- DropIndex
DROP INDEX "TransportRoute_cityCode_idx";

-- DropIndex
DROP INDEX "TransportRouteStop_cityCode_idx";

-- DropIndex
DROP INDEX "TransportRouteStop_routeId_stopId_key";

-- DropIndex
DROP INDEX "TransportRouteStop_stopId_idx";

-- DropIndex
DROP INDEX "TransportSegment_cityCode_idx";

-- DropIndex
DROP INDEX "TransportSegment_routeId_fromStopId_toStopId_key";

-- DropIndex
DROP INDEX "TransportStop_cityCode_idx";

-- DropIndex
DROP INDEX "TransportTrip_cityCode_idx";

-- DropIndex
DROP INDEX "TransportTrip_routeId_idx";

-- AlterTable: id мети — з послідовності (рядок Малина лишається id = 1, наступне місто отримає 2)
CREATE SEQUENCE transportmeta_id_seq;
ALTER TABLE "TransportMeta" ALTER COLUMN "id" SET DEFAULT nextval('transportmeta_id_seq');
ALTER SEQUENCE transportmeta_id_seq OWNED BY "TransportMeta"."id";
SELECT setval('transportmeta_id_seq', (SELECT COALESCE(MAX("id"), 1) FROM "TransportMeta"));

-- AlterTable
ALTER TABLE "TransportRevision" DROP CONSTRAINT "TransportRevision_pkey",
ADD CONSTRAINT "TransportRevision_pkey" PRIMARY KEY ("cityCode", "revision");

-- AlterTable
ALTER TABLE "TransportRoute" DROP CONSTRAINT "TransportRoute_pkey",
ADD CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("cityCode", "id");

-- AlterTable
ALTER TABLE "TransportStop" DROP CONSTRAINT "TransportStop_pkey",
ADD CONSTRAINT "TransportStop_pkey" PRIMARY KEY ("cityCode", "id");

-- AlterTable
ALTER TABLE "TransportTrip" DROP CONSTRAINT "TransportTrip_pkey",
ADD CONSTRAINT "TransportTrip_pkey" PRIMARY KEY ("cityCode", "id");

-- CreateIndex
CREATE INDEX "TransportRouteStop_cityCode_stopId_idx" ON "TransportRouteStop"("cityCode", "stopId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRouteStop_cityCode_routeId_stopId_key" ON "TransportRouteStop"("cityCode", "routeId", "stopId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportSegment_cityCode_routeId_fromStopId_toStopId_key" ON "TransportSegment"("cityCode", "routeId", "fromStopId", "toStopId");

-- CreateIndex
CREATE INDEX "TransportTrip_cityCode_routeId_idx" ON "TransportTrip"("cityCode", "routeId");

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_cityCode_routeId_fkey" FOREIGN KEY ("cityCode", "routeId") REFERENCES "TransportRoute"("cityCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_cityCode_stopId_fkey" FOREIGN KEY ("cityCode", "stopId") REFERENCES "TransportStop"("cityCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_cityCode_routeId_fkey" FOREIGN KEY ("cityCode", "routeId") REFERENCES "TransportRoute"("cityCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSegment" ADD CONSTRAINT "TransportSegment_cityCode_routeId_fkey" FOREIGN KEY ("cityCode", "routeId") REFERENCES "TransportRoute"("cityCode", "id") ON DELETE CASCADE ON UPDATE CASCADE;
