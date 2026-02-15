-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN "supportPhone" TEXT;

-- Для напрямків, пов'язаних з Києвом: встановити телефон підтримки
UPDATE "Schedule"
SET "supportPhone" = '+380(93) 170 18 35'
WHERE "route" IN ('Kyiv-Malyn-Irpin', 'Malyn-Kyiv-Irpin', 'Kyiv-Malyn-Bucha', 'Malyn-Kyiv-Bucha');
