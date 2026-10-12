-- Варіанти шляху маршруту й опорні часи рейсів (Docs/route-variants-2026-10.md).
-- TransportRoute.variants — [{ id, directionId, name, stops: [{ stopId, mapOnly? }] }]: інший ланцюжок зупинок
-- для окремих рейсів (перший рейс №9 через вокзал, №7 «по Миру»). TransportTrip.variantId посилається на нього;
-- TransportTrip.timepoints — точні часи на зупинках з листка розкладу. Порожні колонки — як було досі.
ALTER TABLE "TransportRoute" ADD COLUMN "variants" JSONB;
ALTER TABLE "TransportTrip" ADD COLUMN "variantId" TEXT;
ALTER TABLE "TransportTrip" ADD COLUMN "timepoints" JSONB;
