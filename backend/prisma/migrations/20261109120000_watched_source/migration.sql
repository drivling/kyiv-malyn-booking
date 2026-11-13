-- Стеження за зовнішніми джерелами розкладу (Docs/korosten-transport-2026-11.md, фаза 1): останній побачений
-- відбиток вмісту кожного джерела з WATCHED_SOURCES (src/transport-source-watch.ts). Лише нова таблиця.
CREATE TABLE "WatchedSource" (
    "key" TEXT NOT NULL,
    "fingerprint" TEXT,
    "details" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchedSource_pkey" PRIMARY KEY ("key")
);
