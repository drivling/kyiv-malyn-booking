-- Захист від подвійного нарахування (гонка при відправці двох фото альбомом).
-- Спочатку прибираємо наявні дублі, лишаючи найбільш «просунутий» за статусом рядок.

DELETE FROM "ReferralReward"
WHERE "id" NOT IN (
  SELECT keep_id FROM (
    SELECT DISTINCT ON ("referrerId", "referredPersonId", "rewardType", "rideProofId")
      "id" AS keep_id
    FROM "ReferralReward"
    ORDER BY
      "referrerId", "referredPersonId", "rewardType", "rideProofId",
      CASE "status"
        WHEN 'paid' THEN 0
        WHEN 'approved' THEN 1
        WHEN 'hold' THEN 2
        WHEN 'pending' THEN 3
        ELSE 4
      END,
      "id"
  ) kept
);

CREATE UNIQUE INDEX "ReferralReward_dedupe_key"
  ON "ReferralReward" ("referrerId", "referredPersonId", "rewardType", "rideProofId");
