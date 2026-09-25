-- «Джура» · фаза 0: читання обраних чатів Telegram у базу (Docs/dzhura-roadmap.md).
-- Нові таблиці Dzhura* пише Python-слухач (telegram-user/dzhura/), читає адмінка /admin/dzhura.
-- LunchOutboundMessage.target: 'lunch' — група обідів (як було), 'saved' — «Обране» власника.

-- AlterTable
ALTER TABLE "LunchOutboundMessage" ADD COLUMN "target" TEXT NOT NULL DEFAULT 'lunch';

-- CreateTable
CREATE TABLE "DzhuraChat" (
    "id" SERIAL NOT NULL,
    "tgChatId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "membersCount" INTEGER,
    "isLunchGroup" BOOLEAN NOT NULL DEFAULT false,
    "captureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "relayToSaved" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3),
    "lastCapturedAt" TIMESTAMP(3),
    "lastCapturedTgMessageId" BIGINT,
    "dialogSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DzhuraChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DzhuraPerson" (
    "id" SERIAL NOT NULL,
    "tgUserId" BIGINT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "phone" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "isMe" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DzhuraPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DzhuraMessage" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "tgMessageId" BIGINT NOT NULL,
    "senderPersonId" INTEGER,
    "isOutgoing" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "mediaKind" TEXT,
    "replyToTgMessageId" BIGINT,
    "topicId" INTEGER,
    "forwardFromName" TEXT,
    "forwardFromTgId" BIGINT,
    "forwardDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "editHistoryJson" JSONB,
    "reactionsJson" JSONB,
    "deletedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'live',
    "rawJson" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DzhuraMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DzhuraReaction" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "personId" INTEGER,
    "emoji" TEXT NOT NULL,
    "isMine" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "DzhuraReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DzhuraJob" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "paramsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progressJson" JSONB,
    "resultJson" JSONB,
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DzhuraJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DzhuraState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "heartbeatAt" TIMESTAMP(3),
    "dialogsSyncedAt" TIMESTAMP(3),
    "meTgUserId" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DzhuraState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DzhuraChat_tgChatId_key" ON "DzhuraChat"("tgChatId");

-- CreateIndex
CREATE INDEX "DzhuraChat_kind_captureEnabled_idx" ON "DzhuraChat"("kind", "captureEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "DzhuraPerson_tgUserId_key" ON "DzhuraPerson"("tgUserId");

-- CreateIndex
CREATE INDEX "DzhuraMessage_chatId_sentAt_idx" ON "DzhuraMessage"("chatId", "sentAt");

-- CreateIndex
CREATE INDEX "DzhuraMessage_senderPersonId_idx" ON "DzhuraMessage"("senderPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "DzhuraMessage_chatId_tgMessageId_key" ON "DzhuraMessage"("chatId", "tgMessageId");

-- CreateIndex
CREATE INDEX "DzhuraReaction_messageId_removedAt_idx" ON "DzhuraReaction"("messageId", "removedAt");

-- CreateIndex
CREATE INDEX "DzhuraJob_status_createdAt_idx" ON "DzhuraJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DzhuraMessage" ADD CONSTRAINT "DzhuraMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "DzhuraChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DzhuraMessage" ADD CONSTRAINT "DzhuraMessage_senderPersonId_fkey" FOREIGN KEY ("senderPersonId") REFERENCES "DzhuraPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DzhuraReaction" ADD CONSTRAINT "DzhuraReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DzhuraMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DzhuraReaction" ADD CONSTRAINT "DzhuraReaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "DzhuraPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
