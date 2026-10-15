-- Записи без мережі (Docs/transport-offline-writes-2026-10.md, фаза 2): звіт «Факт прибуття» може прийти з
-- черги в браузері повторно (запис дійшов, відповідь — ні). clientEventId — id запису в outbox; разом із
-- clientId — ключ ідемпотентності POST /transport/arrival-reports. Старі рядки й клієнти без черги — NULL.
ALTER TABLE "TransportArrivalReport" ADD COLUMN "clientEventId" TEXT;

CREATE UNIQUE INDEX "TransportArrivalReport_clientId_clientEventId_key" ON "TransportArrivalReport"("clientId", "clientEventId");
