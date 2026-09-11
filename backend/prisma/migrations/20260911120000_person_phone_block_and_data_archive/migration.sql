-- Заборона номера за скаргою користувача + архів персональних даних.
--
-- phoneBlockedAt — nullable timestamp (як telegramBotBlockedAt): дає і сам факт заборони,
-- і момент, коли її поставили, без окремої булевої колонки.
-- blockedAttempt* — слід того, що заблокована людина все одно намагалася зайти (зазвичай
-- через бота); адмін бачить це фільтром у вкладці «Дані».
-- dataArchivedAt — коли дані винесли в PersonDataArchive і вичистили з робочих таблиць.

ALTER TABLE "Person" ADD COLUMN "phoneBlockedAt" TIMESTAMP(3);
ALTER TABLE "Person" ADD COLUMN "phoneBlockReason" TEXT;
ALTER TABLE "Person" ADD COLUMN "blockedAttemptAt" TIMESTAMP(3);
ALTER TABLE "Person" ADD COLUMN "blockedAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Person" ADD COLUMN "dataArchivedAt" TIMESTAMP(3);

CREATE INDEX "Person_phoneBlockedAt_idx" ON "Person"("phoneBlockedAt");

-- Архів: один рядок = один знімок усіх даних людини на момент звернення.
-- Person при цьому лишається (носій заборони), тому FK — SET NULL, а не CASCADE:
-- архів має пережити навіть повне видалення персони.
CREATE TABLE "PersonDataArchive" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER,
    "phoneNormalized" TEXT NOT NULL,
    "fullName" TEXT,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "deletedCounts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonDataArchive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonDataArchive_phoneNormalized_idx" ON "PersonDataArchive"("phoneNormalized");
CREATE INDEX "PersonDataArchive_createdAt_idx" ON "PersonDataArchive"("createdAt");

ALTER TABLE "PersonDataArchive" ADD CONSTRAINT "PersonDataArchive_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
