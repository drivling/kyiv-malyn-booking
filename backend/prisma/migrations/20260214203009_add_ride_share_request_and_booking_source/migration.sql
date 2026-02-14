-- DropIndex
DROP INDEX "Person_telegramChatId_idx";

-- DropIndex
DROP INDEX "Person_telegramUserId_idx";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'schedule',
ADD COLUMN     "viberListingId" INTEGER;

-- CreateTable
CREATE TABLE "RideShareRequest" (
    "id" SERIAL NOT NULL,
    "passengerListingId" INTEGER NOT NULL,
    "driverListingId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideShareRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_viberListingId_fkey" FOREIGN KEY ("viberListingId") REFERENCES "ViberListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideShareRequest" ADD CONSTRAINT "RideShareRequest_passengerListingId_fkey" FOREIGN KEY ("passengerListingId") REFERENCES "ViberListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideShareRequest" ADD CONSTRAINT "RideShareRequest_driverListingId_fkey" FOREIGN KEY ("driverListingId") REFERENCES "ViberListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
