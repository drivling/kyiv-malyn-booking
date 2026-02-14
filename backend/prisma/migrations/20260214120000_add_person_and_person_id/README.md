# Міграція: таблиця Person та personId у Booking / ViberListing

Після застосування цієї міграції (`prisma migrate deploy`) **обовʼязково** виконайте заповнення даних:

```bash
npm run migrate-to-person
```

Скрипт перенесе унікальні номери та імена з Booking і ViberListing у таблицю Person і проставить `personId` у обох таблицях. Telegram-поля (telegramChatId, telegramUserId) копіюються з існуючих бронювань у Person для подальшої роботи бота та пошуку по /start.
