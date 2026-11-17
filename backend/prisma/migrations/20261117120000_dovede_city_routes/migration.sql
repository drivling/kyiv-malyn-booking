-- «Доведе» · транспорт містом (Docs/dovede-roadmap.md, етап 3а): маршрути між двома точками міста, довідники ліній
-- і зупинок, журнал попиту. Наповнюється від запитів людей; рядки не видаляються — лише архівуються (archivedAt).
CREATE TABLE "DovedeCityRoute" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cityCode" TEXT NOT NULL,
  "fromKey" TEXT NOT NULL,
  "toKey" TEXT NOT NULL,
  "fromLabel" TEXT NOT NULL,
  "toLabel" TEXT NOT NULL,
  "dayType" TEXT NOT NULL,
  "hour" INTEGER NOT NULL,
  "steps" JSONB NOT NULL,
  "minutes" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "hits" INTEGER NOT NULL DEFAULT 0,
  "lastAskedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "DovedeCityRoute_key" ON "DovedeCityRoute"("cityCode", "fromKey", "toKey", "dayType", "hour", "source");
CREATE INDEX "DovedeCityRoute_source_fetchedAt_idx" ON "DovedeCityRoute"("source", "fetchedAt");

CREATE TABLE "DovedeCityLine" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cityCode" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "agency" TEXT NOT NULL DEFAULT '',
  "color" TEXT,
  "source" TEXT NOT NULL,
  "seenCount" INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "DovedeCityLine_key" ON "DovedeCityLine"("cityCode", "mode", "name", "agency");

CREATE TABLE "DovedeCityStop" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cityCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "source" TEXT NOT NULL,
  "seenCount" INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "DovedeCityStop_key" ON "DovedeCityStop"("cityCode", "name");

CREATE TABLE "DovedeCityDemand" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cityCode" TEXT NOT NULL,
  "fromKey" TEXT NOT NULL,
  "toKey" TEXT NOT NULL,
  "fromLabel" TEXT NOT NULL,
  "toLabel" TEXT NOT NULL,
  "asked" INTEGER NOT NULL DEFAULT 1,
  "answered" BOOLEAN NOT NULL DEFAULT false,
  "lastAskedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "DovedeCityDemand_key" ON "DovedeCityDemand"("cityCode", "fromKey", "toKey");
