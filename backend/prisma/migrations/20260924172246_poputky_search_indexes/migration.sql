-- Docs/poputky-search-performance-plan.md, Phase 2.1: indexes for the hot listing/matching queries.
-- CreateIndex
CREATE INDEX "Person_telegramUserId_idx" ON "Person"("telegramUserId");

-- CreateIndex
CREATE INDEX "Person_telegramChatId_idx" ON "Person"("telegramChatId");

-- CreateIndex
CREATE INDEX "RideShareRequest_driverListingId_status_idx" ON "RideShareRequest"("driverListingId", "status");

-- CreateIndex
CREATE INDEX "RideShareRequest_passengerListingId_status_idx" ON "RideShareRequest"("passengerListingId", "status");

-- CreateIndex
CREATE INDEX "ViberListing_isActive_date_listingType_idx" ON "ViberListing"("isActive", "date", "listingType");

-- CreateIndex
CREATE INDEX "ViberListing_personId_idx" ON "ViberListing"("personId");

-- CreateIndex
CREATE INDEX "ViberListing_phone_idx" ON "ViberListing"("phone");
