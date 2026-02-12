-- CreateTable
CREATE TABLE "ViberListing" (
    "id" SERIAL NOT NULL,
    "rawMessage" TEXT NOT NULL,
    "senderName" TEXT,
    "listingType" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "departureTime" TEXT,
    "seats" INTEGER,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViberListing_pkey" PRIMARY KEY ("id")
);
