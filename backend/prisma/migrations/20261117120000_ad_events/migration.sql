-- Облік реклами «Доведе»: міні-тизер перед табло зупинки й ролик-вступ /dovede (Docs/dovede-roadmap.md, «Облік реклами»)
CREATE TABLE "AdEvent" (
    "id" SERIAL NOT NULL,
    "cityCode" TEXT NOT NULL DEFAULT 'Malyn',
    "placement" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "clientId" TEXT,
    "video" TEXT,
    "stopId" TEXT,
    "access" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdEvent_viewId_event_key" ON "AdEvent"("viewId", "event");
CREATE INDEX "AdEvent_createdAt_idx" ON "AdEvent"("createdAt");
CREATE INDEX "AdEvent_placement_createdAt_idx" ON "AdEvent"("placement", "createdAt");
CREATE INDEX "AdEvent_clientId_idx" ON "AdEvent"("clientId");
