-- TelegramFetchState: підтримка кількох груп-джерел (PoDoroguem + poputka_zhytomyr_kyiv).
-- Раніше ключ був topicId @unique; тепер (chat, topicId), де chat за замовчуванням "PoDoroguem".

ALTER TABLE "TelegramFetchState" ADD COLUMN "chat" TEXT NOT NULL DEFAULT 'PoDoroguem';

DROP INDEX IF EXISTS "TelegramFetchState_topicId_key";

CREATE UNIQUE INDEX "TelegramFetchState_chat_topicId_key" ON "TelegramFetchState"("chat", "topicId");
