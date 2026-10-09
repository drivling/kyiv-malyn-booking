-- Docs/poputky-search-performance-plan.md, Phase 5.1: idempotent ingest (one row per processed raw message).
-- CreateTable
CREATE TABLE "ViberListingSource" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "listingId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViberListingSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViberListingSource_hash_key" ON "ViberListingSource"("hash");

-- CreateIndex
CREATE INDEX "ViberListingSource_listingId_idx" ON "ViberListingSource"("listingId");

-- AddForeignKey
ALTER TABLE "ViberListingSource" ADD CONSTRAINT "ViberListingSource_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ViberListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

