-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN "priceUah" INTEGER;

-- Seed known fare: Малин ↔ Київ (Irpin / Bucha variants)
UPDATE "Schedule"
SET "priceUah" = 280
WHERE "route" IN (
  'Kyiv-Malyn-Irpin',
  'Malyn-Kyiv-Irpin',
  'Kyiv-Malyn-Bucha',
  'Malyn-Kyiv-Bucha',
  'Kyiv-Malyn',
  'Malyn-Kyiv'
);
