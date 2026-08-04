-- Referral program: Person fields, ReferralInvite, ReferralReward, RideCompletionProof

ALTER TABLE "Person" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "Person" ADD COLUMN "referredByPersonId" INTEGER;

CREATE UNIQUE INDEX "Person_referralCode_key" ON "Person"("referralCode");
CREATE INDEX "Person_referredByPersonId_idx" ON "Person"("referredByPersonId");

ALTER TABLE "Person" ADD CONSTRAINT "Person_referredByPersonId_fkey"
  FOREIGN KEY ("referredByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReferralInvite" (
    "id" SERIAL NOT NULL,
    "referrerId" INTEGER NOT NULL,
    "inviteContact" TEXT NOT NULL,
    "inviteType" TEXT NOT NULL,
    "invitePhoneNorm" TEXT,
    "inviteUsername" TEXT,
    "referredPersonId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "registeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralReward" (
    "id" SERIAL NOT NULL,
    "referrerId" INTEGER NOT NULL,
    "referredPersonId" INTEGER NOT NULL,
    "rewardType" TEXT NOT NULL,
    "amountUah" INTEGER NOT NULL,
    "viberListingId" INTEGER,
    "rideProofId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "flagReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RideCompletionProof" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "viberListingId" INTEGER,
    "route" TEXT NOT NULL,
    "rideDate" TIMESTAMP(3) NOT NULL,
    "departureTime" TEXT,
    "photoStartFileId" TEXT,
    "photoEndFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_photos',
    "rejectionReason" TEXT,
    "flagReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideCompletionProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferralInvite_referrerId_idx" ON "ReferralInvite"("referrerId");
CREATE INDEX "ReferralInvite_invitePhoneNorm_idx" ON "ReferralInvite"("invitePhoneNorm");
CREATE INDEX "ReferralInvite_inviteUsername_idx" ON "ReferralInvite"("inviteUsername");
CREATE INDEX "ReferralInvite_referredPersonId_idx" ON "ReferralInvite"("referredPersonId");

CREATE INDEX "ReferralReward_referrerId_idx" ON "ReferralReward"("referrerId");
CREATE INDEX "ReferralReward_referredPersonId_idx" ON "ReferralReward"("referredPersonId");
CREATE INDEX "ReferralReward_status_idx" ON "ReferralReward"("status");

CREATE INDEX "RideCompletionProof_personId_idx" ON "RideCompletionProof"("personId");
CREATE INDEX "RideCompletionProof_status_idx" ON "RideCompletionProof"("status");

ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_referrerId_fkey"
  FOREIGN KEY ("referrerId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_referredPersonId_fkey"
  FOREIGN KEY ("referredPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referrerId_fkey"
  FOREIGN KEY ("referrerId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referredPersonId_fkey"
  FOREIGN KEY ("referredPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_viberListingId_fkey"
  FOREIGN KEY ("viberListingId") REFERENCES "ViberListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_rideProofId_fkey"
  FOREIGN KEY ("rideProofId") REFERENCES "RideCompletionProof"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RideCompletionProof" ADD CONSTRAINT "RideCompletionProof_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RideCompletionProof" ADD CONSTRAINT "RideCompletionProof_viberListingId_fkey"
  FOREIGN KEY ("viberListingId") REFERENCES "ViberListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
