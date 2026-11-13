-- Маршрутки Малин ↔ Київ: з 4 листопада 2026 проїзд 310 грн в обидва боки (було 280; туди й назад 620 замість 560).
-- Джерело: перевізник, ІнфоМалин 03.11.2026. Дефолт для нових рейсів — backend/src/schedule-price.ts.
--
-- Чіпаємо лише маршрутки з ціною рівно 280: електрички на тих самих маршрутах (60 грн) і ціни, виставлені
-- вручну в адмінці, лишаються як є. Умова за маршрутом збігається з defaultSchedulePriceUah().
UPDATE "Schedule"
SET "priceUah" = 310,
    "updatedAt" = NOW()
WHERE "vehicleType" = 'marshrutka'
  AND "priceUah" = 280
  AND ("route" LIKE '%Kyiv-Malyn%' OR "route" LIKE '%Malyn-Kyiv%');
