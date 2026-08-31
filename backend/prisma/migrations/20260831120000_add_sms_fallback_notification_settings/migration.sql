-- Платний SMS-фолбек (TurboSMS) + налаштування логіки сповіщень в БД + журнал відправок

-- Налаштування логіки сповіщень (singleton id=1)
CREATE TABLE "NotificationSettings" (
    "id" INTEGER NOT NULL,
    "smsFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsMatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsAuthorConfirmationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsBookingReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsMatchTypeThreshold" TEXT NOT NULL DEFAULT 'exact',
    "smsDailyCap" INTEGER NOT NULL DEFAULT 50,
    "smsMonthlyCap" INTEGER NOT NULL DEFAULT 1000,
    "turboSmsToken" TEXT,
    "turboSmsSender" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "NotificationSettings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);

-- Журнал платних відправок (ліміти, дедуп, облік вартості)
CREATE TABLE "SmsSendLog" (
    "id" SERIAL NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "useCase" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'turbosms',
    "channel" TEXT NOT NULL DEFAULT 'sms',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerMessageId" TEXT,
    "errorText" TEXT,
    "segments" INTEGER,
    "contextType" TEXT,
    "contextId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SmsSendLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsSendLog_createdAt_idx" ON "SmsSendLog"("createdAt");
CREATE INDEX "SmsSendLog_useCase_createdAt_idx" ON "SmsSendLog"("useCase", "createdAt");
CREATE INDEX "SmsSendLog_contextType_contextId_idx" ON "SmsSendLog"("contextType", "contextId");

-- Відмова від платних SMS-сповіщень
ALTER TABLE "Person" ADD COLUMN "smsOptOut" BOOLEAN NOT NULL DEFAULT false;
