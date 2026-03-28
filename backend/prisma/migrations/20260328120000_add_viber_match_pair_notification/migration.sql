-- CreateTable
CREATE TABLE "ViberMatchPairNotification" (
    "id" SERIAL NOT NULL,
    "passengerListingId" INTEGER NOT NULL,
    "driverListingId" INTEGER NOT NULL,
    "passengerNotifiedAt" TIMESTAMP(3),
    "driverNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViberMatchPairNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViberMatchPairNotification_passengerListingId_driverListingId_key" ON "ViberMatchPairNotification"("passengerListingId", "driverListingId");

-- AddForeignKey
ALTER TABLE "ViberMatchPairNotification" ADD CONSTRAINT "ViberMatchPairNotification_passengerListingId_fkey" FOREIGN KEY ("passengerListingId") REFERENCES "ViberListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViberMatchPairNotification" ADD CONSTRAINT "ViberMatchPairNotification_driverListingId_fkey" FOREIGN KEY ("driverListingId") REFERENCES "ViberListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
