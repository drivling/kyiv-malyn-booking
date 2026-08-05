-- Нагорода більше не потрапляє у чергу виплат до схвалення фото модератором.
-- Новий стартовий статус — hold; 'pending' лишається читабельним як легасі.

ALTER TABLE "ReferralReward" ALTER COLUMN "status" SET DEFAULT 'hold';

-- Уже схвалені фото: нагороди справді можна платити
UPDATE "ReferralReward" r
SET "status" = 'approved'
WHERE r."status" = 'pending'
  AND EXISTS (
    SELECT 1 FROM "RideCompletionProof" p
    WHERE p."id" = r."rideProofId" AND p."status" = 'approved'
  );

-- Решта pending (фото не переглядали або нагорода без заявки) — на утримання
UPDATE "ReferralReward"
SET "status" = 'hold'
WHERE "status" = 'pending';
