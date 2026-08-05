-- Загальний бюджет акції «Приведи друга» — редагується в адмінці

CREATE TABLE "ReferralProgramSettings" (
    "id" SERIAL NOT NULL,
    "budgetUah" INTEGER NOT NULL DEFAULT 4000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralProgramSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ReferralProgramSettings" ("budgetUah", "updatedAt") VALUES (4000, NOW());
