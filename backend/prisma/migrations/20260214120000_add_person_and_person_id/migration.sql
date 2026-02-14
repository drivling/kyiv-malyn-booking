-- CreateTable
CREATE TABLE "Person" (
    "id" SERIAL NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "fullName" TEXT,
    "telegramChatId" TEXT,
    "telegramUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_phoneNormalized_key" ON "Person"("phoneNormalized");

-- CreateIndex (for lookups by Telegram)
CREATE INDEX "Person_telegramUserId_idx" ON "Person"("telegramUserId");
CREATE INDEX "Person_telegramChatId_idx" ON "Person"("telegramChatId");

-- AlterTable Booking: add personId
ALTER TABLE "Booking" ADD COLUMN "personId" INTEGER;

-- AlterTable ViberListing: add personId
ALTER TABLE "ViberListing" ADD COLUMN "personId" INTEGER;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ViberListing" ADD CONSTRAINT "ViberListing_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
