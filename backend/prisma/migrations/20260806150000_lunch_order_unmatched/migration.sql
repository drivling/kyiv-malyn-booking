-- Зберігаємо нерозпізнані фрагменти замовлення для адмінки / аналізу

ALTER TABLE "LunchOrder" ADD COLUMN "unmatchedText" TEXT;
