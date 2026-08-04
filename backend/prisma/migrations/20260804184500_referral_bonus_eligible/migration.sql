-- Variant B: track whether 10 UAH registration bonus is allowed (truly new client)

ALTER TABLE "Person" ADD COLUMN "referralRegistrationBonusEligible" BOOLEAN;

ALTER TABLE "ReferralInvite" ADD COLUMN "registrationBonusEligible" BOOLEAN NOT NULL DEFAULT true;
