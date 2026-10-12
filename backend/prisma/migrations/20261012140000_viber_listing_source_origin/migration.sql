-- Провенанс оголошення з Telegram-груп: група, топік, id повідомлення (source лишається міткою каналу).
ALTER TABLE "ViberListing" ADD COLUMN "sourceChat" TEXT,
ADD COLUMN "sourceTopicId" INTEGER,
ADD COLUMN "sourceMessageId" INTEGER;
