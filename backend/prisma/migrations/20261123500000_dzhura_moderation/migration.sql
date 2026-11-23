-- «Джура» · модерація групи (режим чернеток): налаштування на чат і журнал рішень моделі.
-- Типово модерацію вимкнено (moderationMode = 'off') — поведінка до цієї зміни.
-- AlterTable
ALTER TABLE "DzhuraChat" ADD COLUMN     "moderationMode" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN     "moderationNote" TEXT,
ADD COLUMN     "moderationProtected" JSONB;

-- CreateTable
CREATE TABLE "DzhuraModeration" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "targetTgMessageId" BIGINT,
    "targetTgUserId" BIGINT,
    "hint" TEXT,
    "warning" TEXT,
    "reason" TEXT NOT NULL,
    "model" TEXT,
    "windowToTgMessageId" BIGINT,

    CONSTRAINT "DzhuraModeration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DzhuraModeration_chatId_createdAt_idx" ON "DzhuraModeration"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DzhuraModeration_chatId_targetTgMessageId_key" ON "DzhuraModeration"("chatId", "targetTgMessageId");

-- AddForeignKey
ALTER TABLE "DzhuraModeration" ADD CONSTRAINT "DzhuraModeration_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "DzhuraChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

