-- Оренда Telethon-сесії (singleton id=1): лише один процес бекенду тримає сесію акаунта власника.
-- Під час деплою новий контейнер чекає, поки старий звільнить запис або його серцебиття застаріє.
CREATE TABLE "TelegramSessionLease" (
    "id" INTEGER NOT NULL,
    "holder" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramSessionLease_pkey" PRIMARY KEY ("id")
);
