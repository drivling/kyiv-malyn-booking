-- Скільки легковик їде маршрутом, хв (для часу прибуття попуток у «Доведе»; редагується в адмінці «Маршрути»).
ALTER TABLE "TripRoute" ADD COLUMN "carDurationMinutes" INTEGER;

-- Київ ↔ Малин: 1 год 35 хв (слова власника, 2026-11-16) — коридор і варіанти через Ірпінь / Бучу.
UPDATE "TripRoute" SET "carDurationMinutes" = 95
WHERE "slug" IN ('Kyiv-Malyn', 'Malyn-Kyiv', 'Kyiv-Malyn-Irpin', 'Malyn-Kyiv-Irpin', 'Kyiv-Malyn-Bucha', 'Malyn-Kyiv-Bucha');
