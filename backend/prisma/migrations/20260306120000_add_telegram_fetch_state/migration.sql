-- CreateTable
CREATE TABLE "TelegramFetchState" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "lastMessageId" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramFetchState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramFetchState_topicId_key" ON "TelegramFetchState"("topicId");
