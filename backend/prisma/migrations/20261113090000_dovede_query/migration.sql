-- «Доведе» · журнал розуміння питань: розбір браузера й Claude, модель, затримка, токени (Docs/dovede-roadmap.md, фаза 2)
CREATE TABLE "DovedeQuery" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,
    "localIntent" JSONB,
    "aiIntent" JSONB,
    "agree" BOOLEAN,
    "status" TEXT NOT NULL,
    "aiCalled" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "promptVersion" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "error" TEXT,

    CONSTRAINT "DovedeQuery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DovedeQuery_createdAt_idx" ON "DovedeQuery"("createdAt");
CREATE INDEX "DovedeQuery_aiCalled_createdAt_idx" ON "DovedeQuery"("aiCalled", "createdAt");
