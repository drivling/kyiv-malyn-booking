-- DropIndex
DROP INDEX "Person_telegramBotBlockedAt_idx";

-- CreateTable
CREATE TABLE "TransportStop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRoute" (
    "id" TEXT NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT '',
    "toName" TEXT NOT NULL DEFAULT '',
    "scheme" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "schedule" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRouteStop" (
    "id" SERIAL NOT NULL,
    "routeId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "orderThere" INTEGER NOT NULL DEFAULT -1,
    "orderBack" INTEGER NOT NULL DEFAULT -1,
    "mapOnly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TransportRouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportTrip" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL DEFAULT 'everyday',
    "headsign" TEXT NOT NULL DEFAULT '',
    "directionId" TEXT NOT NULL DEFAULT '1',
    "departureTime" TEXT,
    "blockId" TEXT,
    "wheelchairAccessible" TEXT NOT NULL DEFAULT '',
    "bikesAllowed" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TransportTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportSegment" (
    "id" SERIAL NOT NULL,
    "routeId" TEXT NOT NULL,
    "fromStopId" TEXT NOT NULL,
    "toStopId" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,

    CONSTRAINT "TransportSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportMeta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransportRouteStop_stopId_idx" ON "TransportRouteStop"("stopId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportRouteStop_routeId_stopId_key" ON "TransportRouteStop"("routeId", "stopId");

-- CreateIndex
CREATE INDEX "TransportTrip_routeId_idx" ON "TransportTrip"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportSegment_routeId_fromStopId_toStopId_key" ON "TransportSegment"("routeId", "fromStopId", "toStopId");

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRouteStop" ADD CONSTRAINT "TransportRouteStop_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "TransportStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportTrip" ADD CONSTRAINT "TransportTrip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportSegment" ADD CONSTRAINT "TransportSegment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ViberMatchPairNotification_passengerListingId_driverListingId_k" RENAME TO "ViberMatchPairNotification_passengerListingId_driverListing_key";
