-- «Доведе» · навчання міста кампаніями на сервері (Docs/dovede-admin-roadmap.md, крок 6): власник у адмінці каже
-- «навчи Житомир», сервер сам обходить місця в межах погодженої кількості запитів до Google. Кампанія, її місця
-- (вузли обходу в ширину) і питання (журнал: що спитали й що відповів сервер). Нічого не видаляється: кампанію
-- ховає "archivedAt", питання лишаються з останнім станом.
CREATE TABLE "DovedeCityCampaign" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cityCode" TEXT NOT NULL,
  "preset" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "plan" JSONB NOT NULL,
  "budget" INTEGER NOT NULL,
  "dailyBudget" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "waitUntil" TIMESTAMP(3),
  "waitReason" TEXT,
  "stopReason" TEXT,
  "asked" INTEGER NOT NULL DEFAULT 0,
  "ok" INTEGER NOT NULL DEFAULT 0,
  "fromDb" INTEGER NOT NULL DEFAULT 0,
  "noRoute" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "places" INTEGER NOT NULL DEFAULT 0,
  "googleCalls" INTEGER NOT NULL DEFAULT 0,
  "spentDay" TEXT,
  "spentToday" INTEGER NOT NULL DEFAULT 0,
  "errorsInRow" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "report" JSONB,
  "leaseHolder" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3)
);
CREATE INDEX "DovedeCityCampaign_status_idx" ON "DovedeCityCampaign"("status");

CREATE TABLE "DovedeCityCampaignPlace" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "campaignId" INTEGER NOT NULL,
  "cityCode" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "dir" TEXT NOT NULL,
  "place" TEXT NOT NULL,
  "placeKey" TEXT NOT NULL,
  "depth" INTEGER NOT NULL,
  "via" TEXT NOT NULL
);
CREATE UNIQUE INDEX "DovedeCityCampaignPlace_key" ON "DovedeCityCampaignPlace"("campaignId", "origin", "dir", "placeKey");

CREATE TABLE "DovedeCityCampaignAsk" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "campaignId" INTEGER NOT NULL,
  "placeId" INTEGER NOT NULL,
  "dayType" TEXT NOT NULL,
  "hour" INTEGER NOT NULL,
  "phase" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "source" TEXT,
  "minutes" INTEGER,
  "steps" JSONB,
  "googleCalled" BOOLEAN NOT NULL DEFAULT false,
  "added" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "error" TEXT
);
CREATE UNIQUE INDEX "DovedeCityCampaignAsk_key" ON "DovedeCityCampaignAsk"("placeId", "dayType", "hour");
CREATE INDEX "DovedeCityCampaignAsk_queue_idx" ON "DovedeCityCampaignAsk"("campaignId", "status", "phase", "id");
