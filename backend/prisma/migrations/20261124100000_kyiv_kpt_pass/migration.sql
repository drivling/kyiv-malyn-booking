-- «Доведе», крок 8г: візити машин «Київпастрансу» біля контрольних точок (онлайн-рух)
CREATE TABLE "KyivKptPass" (
    "id" BIGSERIAL NOT NULL,
    "routeId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "point" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KyivKptPass_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KyivKptPass_vehicleId_firstAt_key" ON "KyivKptPass"("vehicleId", "firstAt");
CREATE INDEX "KyivKptPass_routeId_firstAt_idx" ON "KyivKptPass"("routeId", "firstAt");
CREATE INDEX "KyivKptPass_firstAt_idx" ON "KyivKptPass"("firstAt");
