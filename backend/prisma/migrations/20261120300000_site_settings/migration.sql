-- Налаштування сайту, які власник міняє в адмінці без деплою (не лише «Доведе»). Перше — телефони «Зубастика»
-- (ключ `zubastyk.phones`): ними користуються сторінка /zubastyk, модалка бронювання, «Доведе», бот і SMS.
CREATE TABLE "SiteSetting" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
