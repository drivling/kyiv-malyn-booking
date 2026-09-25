-- Черга LunchOutboundMessage: ретраї з паузою замість миттєвого failed («Джура» · фаза 1).
-- attempts — кількість спроб, nextAttemptAt — коли брати рядок наступного разу (NULL = одразу).

-- AlterTable
ALTER TABLE "LunchOutboundMessage" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LunchOutboundMessage_status_nextAttemptAt_idx" ON "LunchOutboundMessage"("status", "nextAttemptAt");
