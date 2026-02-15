-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN "supportPhone" TEXT;

-- Для напрямків, пов'язаних з Києвом: встановити телефон підтримки (+380(XX)YYYYYYY без пропусків)
UPDATE "Schedule"
SET "supportPhone" = '+380(93)1701835'
WHERE "route" IN ('Kyiv-Malyn-Irpin', 'Malyn-Kyiv-Irpin', 'Kyiv-Malyn-Bucha', 'Malyn-Kyiv-Bucha');
