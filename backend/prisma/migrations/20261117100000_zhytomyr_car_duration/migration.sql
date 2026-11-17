-- Авто Малин ↔ Житомир: ≈ 1,5 год (Google Routes 2026-11-17: Житомир → Малин 88 хв) — сталий час прибуття попуток
-- у «Доведе», коли сервіс заторів не відповів. Лише там, де власник ще не задав свого значення.
UPDATE "TripRoute" SET "carDurationMinutes" = 90
WHERE "carDurationMinutes" IS NULL
  AND ("slug" = 'Malyn-Zhytomyr' OR "slug" = 'Zhytomyr-Malyn' OR "slug" LIKE 'Malyn-Zhytomyr-%' OR "slug" LIKE 'Zhytomyr-Malyn-%');
