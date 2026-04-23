-- AlterTable
ALTER TABLE "Person" ADD COLUMN "telegramBotBlockedAt" TIMESTAMP(3);

-- Optional index for admin / analytics filters
CREATE INDEX "Person_telegramBotBlockedAt_idx" ON "Person"("telegramBotBlockedAt");
