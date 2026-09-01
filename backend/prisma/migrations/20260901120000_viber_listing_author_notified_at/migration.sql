-- Одне сповіщення автору на оголошення (бот / особистий акаунт / платне SMS):
-- повторні пости, мерж і апдейти більше не спамлять людину.
ALTER TABLE "ViberListing" ADD COLUMN "authorNotifiedAt" TIMESTAMP(3);
