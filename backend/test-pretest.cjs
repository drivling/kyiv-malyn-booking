/* Знімає токен перед завантаженням тестів, щоб import telegram.ts не вмикав polling. */
delete process.env.TELEGRAM_BOT_TOKEN;
