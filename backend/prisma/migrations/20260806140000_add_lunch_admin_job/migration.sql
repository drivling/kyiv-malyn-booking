-- Адмін-задачі для lunch listener (повторний розбір дня)

CREATE TABLE "LunchAdminJob" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resultJson" TEXT,
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LunchAdminJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LunchAdminJob_status_createdAt_idx" ON "LunchAdminJob"("status", "createdAt");
