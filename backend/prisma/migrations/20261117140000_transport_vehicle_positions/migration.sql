-- GPS-треки міського транспорту з публічного фіду (Коростень; Docs/korosten-gps-tracks-2026-11.md)
CREATE TABLE "TransportVehiclePosition" (
    "id" BIGSERIAL NOT NULL,
    "cityCode" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "routeNo" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "satellites" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportVehiclePosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportVehiclePosition_cityCode_vehicleId_at_key" ON "TransportVehiclePosition"("cityCode", "vehicleId", "at");
CREATE INDEX "TransportVehiclePosition_cityCode_at_idx" ON "TransportVehiclePosition"("cityCode", "at");
CREATE INDEX "TransportVehiclePosition_cityCode_routeNo_at_idx" ON "TransportVehiclePosition"("cityCode", "routeNo", "at");
