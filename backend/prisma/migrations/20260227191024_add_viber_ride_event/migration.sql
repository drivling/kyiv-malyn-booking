-- CreateTable
CREATE TABLE "ViberRideEvent" (
    "id" SERIAL NOT NULL,
    "viberRideId" INTEGER NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "personId" INTEGER,
    "route" TEXT,
    "departureDate" TIMESTAMP(3),
    "departureTime" TEXT,
    "availableSeats" INTEGER,
    "priceUah" INTEGER,
    "isParsed" BOOLEAN NOT NULL,
    "isActive" BOOLEAN,
    "parsingErrors" TEXT,
    "weekday" INTEGER,
    "hour" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViberRideEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViberRideEvent_viberRideId_key" ON "ViberRideEvent"("viberRideId");

-- AddForeignKey
ALTER TABLE "ViberRideEvent" ADD CONSTRAINT "ViberRideEvent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
