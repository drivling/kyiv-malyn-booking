-- Прапорець «у місті є локальний транспорт» (розклад міських маршруток).
-- Зараз локальний транспорт існує тільки для Малина; інші міста (в т.ч. Коростень,
-- який має власний домен korosten.kiev.ua) показують заглушку «скоро».

ALTER TABLE "TripPoint" ADD COLUMN "hasLocalTransport" BOOLEAN NOT NULL DEFAULT false;

UPDATE "TripPoint" SET "hasLocalTransport" = true WHERE "code" = 'Malyn';
