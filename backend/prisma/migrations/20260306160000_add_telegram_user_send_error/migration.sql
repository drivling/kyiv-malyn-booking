-- CreateTable
CREATE TABLE "TelegramUserSendError" (
    "id" SERIAL NOT NULL,
    "contact" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "errorCode" INTEGER NOT NULL,
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUserSendError_pkey" PRIMARY KEY ("id")
);
