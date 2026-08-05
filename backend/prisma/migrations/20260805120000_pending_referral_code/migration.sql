-- Реферальний код із ?start=ref_CODE зберігається до реєстрації номера.
-- Раніше жив у памʼяті процесу — деплой губив атрибуцію.

CREATE TABLE "PendingReferralCode" (
    "id" SERIAL NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerPersonId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingReferralCode_telegramChatId_key" ON "PendingReferralCode"("telegramChatId");

CREATE INDEX "PendingReferralCode_expiresAt_idx" ON "PendingReferralCode"("expiresAt");
