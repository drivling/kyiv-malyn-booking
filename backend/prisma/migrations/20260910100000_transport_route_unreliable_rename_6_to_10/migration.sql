-- Прапорець «ненадійний маршрут»: такий маршрут не показується на сайті
-- (сторінки маршрутів, планер, табло, SEO/AEO, sitemap, GTFS-фід), але лишається в адмінці.

ALTER TABLE "TransportRoute" ADD COLUMN "unreliable" BOOLEAN NOT NULL DEFAULT false;

-- Міський маршрут №6 у Малині перейменовано на №10. У БД уже був стаб «10» з data.gov.ua
-- (рейси без часу, зупинки за алфавітом) — він стає «10-old» і ховається.
-- Кроки виконуються лише поки в БД є маршрут «6» (повторний запуск — no-op).
-- FK на TransportRoute мають ON UPDATE CASCADE, тому routeStops/trips/segments підхоплюються самі.

UPDATE "TransportTrip"
SET "id" = '10-old-' || substring("id" from 4)
WHERE "routeId" = '10'
  AND "id" LIKE '10-%'
  AND EXISTS (SELECT 1 FROM "TransportRoute" WHERE "id" = '6');

UPDATE "TransportRoute"
SET "id" = '10-old',
    "unreliable" = true,
    "note" = 'Старий №10 з data.gov.ua (без розкладу). Реальний №10 — колишній №6.'
WHERE "id" = '10'
  AND EXISTS (SELECT 1 FROM "TransportRoute" WHERE "id" = '6');

UPDATE "TransportTrip"
SET "id" = '10-' || substring("id" from 3)
WHERE "routeId" = '6'
  AND "id" LIKE '6-%';

UPDATE "TransportRoute"
SET "id" = '10',
    "unreliable" = true
WHERE "id" = '6';
