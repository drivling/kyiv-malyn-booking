-- Відправки від особистого Telegram-акаунта про поїздки: вимикачі в адмінці («Сповіщення») і журнал відправок.
-- Типові значення = поведінка до цієї зміни (усе ввімкнено; ліміт за id — зі змінної середовища або 20).
ALTER TABLE "NotificationSettings"
  ADD COLUMN "tgUserMatchEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tgUserAuthorConfirmationEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tgUserByIdEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tgUserByIdDailyCap" INTEGER;

CREATE TABLE "TelegramUserSendLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT NOT NULL,
    "method" TEXT,
    "ok" BOOLEAN NOT NULL,

    CONSTRAINT "TelegramUserSendLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelegramUserSendLog_createdAt_idx" ON "TelegramUserSendLog"("createdAt");
