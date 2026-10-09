-- TransportArrivalReport: факт прибуття міського автобуса від пасажирів (довге натискання на час рейсу).

-- CreateTable
CREATE TABLE "TransportArrivalReport" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "actualTime" TEXT,
    "delayMin" INTEGER,
    "waitedMin" INTEGER,
    "source" TEXT NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportArrivalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransportArrivalReport_routeId_stopId_scheduledTime_idx" ON "TransportArrivalReport"("routeId", "stopId", "scheduledTime");

-- CreateIndex
CREATE INDEX "TransportArrivalReport_serviceDate_idx" ON "TransportArrivalReport"("serviceDate");

-- CreateIndex
CREATE INDEX "TransportArrivalReport_createdAt_idx" ON "TransportArrivalReport"("createdAt");
