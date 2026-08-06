-- Черга вихідних повідомлень у групу обідів (адмінка → listener)

CREATE TABLE "LunchOutboundMessage" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "LunchOutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LunchOutboundMessage_status_createdAt_idx" ON "LunchOutboundMessage"("status", "createdAt");
