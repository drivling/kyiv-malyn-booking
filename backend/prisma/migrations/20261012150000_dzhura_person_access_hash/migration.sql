-- Telethon access_hash автора: потрібен, щоб написати за числовим id тим, у кого немає ні username, ні номера.
ALTER TABLE "DzhuraPerson" ADD COLUMN "accessHash" BIGINT;
