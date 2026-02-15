# Тестування та рефакторинг Telegram-бота

## Поточне покриття тестами

Файл тестів: `src/telegram.test.ts`.  
Запуск: `npm run test`, `npm run test:watch`, `npm run test:coverage`.

### Покриті функції (40 тестів)

| Категорія | Функції | Що перевіряється |
|-----------|---------|-------------------|
| **Чисті (без I/O)** | `normalizePhone` | Формати телефону: 380..., 0..., з пробілами/дужками |
| | `formatDate` | Український формат дати (DD.MM.YYYY) |
| | `getRouteName` | Усі варіанти маршрутів (Kyiv-Malyn, Malyn-Kyiv, Irpin, Bucha, Zhytomyr, Korosten) |
| | `normalizeTimeForMatch` | "18:00", "18:00-18:30" → "18:00" |
| | `isExactTimeMatch` | Збіг/невідповідність часу, null |
| | `toDateKey` | Date → YYYY-MM-DD |
| | `isTelegramEnabled` | false коли токен не заданий |
| **Prisma (мок)** | `getPersonByPhone` | findUnique за нормалізованим номером |
| | `findOrCreatePersonByPhone` | upsert з опціями fullName, telegram* |
| | `getPersonByTelegram` | findFirst за userId/chatId |
| | `getNameByPhone` | fullName з Person, fallback на Booking |
| | `getPhoneByTelegramUser` | Person.phoneNormalized або Booking.phone |
| | `getChatIdByPhone` | Person.telegramChatId, fallback на Booking |
| **Bot (бот вимкнено)** | `sendBookingNotificationToAdmin` | Не викликає sendMessage |
| | `sendBookingConfirmationToCustomer` | Не викликає sendMessage |
| | `sendTripReminder` | Не викликає sendMessage |
| | `sendViberListingNotificationToAdmin` | Не викликає sendMessage |
| | `sendViberListingConfirmationToUser` | Не викликає sendMessage |
| **Notify (мок Prisma)** | `notifyMatchingPassengersForNewDriver` | Без збігів не шле повідомлення; з збігами не падає при вимкненому боті |
| | `notifyMatchingDriversForNewPassenger` | Без збігів не шле повідомлення |

### Що поки не покрито тестами

- **Обробники команд бота** (`/start`, `/help`, `/book`, `/mybookings`, `/cancel`, `/adddriverride`, `/addpassengerride`, `/mydriverrides`, `/mypassengerrides`, `contact`, `message`, `callback_query`). Логіка всередині них залежить від глобального `bot` і від станів `driverRideStateMap` / `passengerRideStateMap`.
- **Внутрішні функції**: `createDriverListingFromState`, `createPassengerListingFromState`, `findMatchingPassengersForDriver`, `findMatchingDriversForPassenger`, `updatePersonAndBookingsTelegram`, `registerUserPhone`, `sendNewTelegramRegistrationNotificationToAdmin`, `formatPhoneDisplay`, `formatPhoneTelLink`.
- **Інтеграція**: реальний Prisma, реальний Telegram API.

---

## Рекомендовані кроки для глибокого рефакторингу

### Фаза 1: Підготовка (без зміни поведінки)

1. **Витягнути форматтери в один модуль**  
   Перенести `formatDate`, `getRouteName`, `formatPhoneDisplay`, `formatPhoneTelLink` у файл типу `src/telegram/formatting.ts` (або `src/lib/formatting.ts`) і імпортувати їх у `telegram.ts`. Тести для вже експортованих функцій залишаються, можна додати тести для `formatPhoneDisplay` / `formatPhoneTelLink` після експорту.

2. **Витягнути логіку часу/дати**  
   Залишити `normalizeTimeForMatch`, `isExactTimeMatch`, `toDateKey` в окремому модулі (наприклад `src/telegram/matching.ts`) або в тому ж `formatting.ts`. Це вже експортовано і протестовано — достатньо перенести імпорти.

3. **Витягнути роботу з Person/Booking**  
   Створити шар типу `src/telegram/person-service.ts` (або `src/db/person.ts`): функції `getPersonByPhone`, `getPersonByTelegram`, `findOrCreatePersonByPhone`, `getNameByPhone`, `getPhoneByTelegramUser`, `getChatIdByPhone`, `updatePersonAndBookingsTelegram`. Приймати `prisma` як аргумент або через фабрику. Після переносу — оновити тести, щоб мокати цей модуль замість Prisma напряму (або залишити інтеграційні тести з моком Prisma).

### Фаза 2: Розв’язання залежностей

4. **Інжекція бота та Prisma**  
   Замість глобальних `let bot` і `const prisma` на верхньому рівні модуля:
   - створити функцію `createTelegramBot(token, options?)`, яка повертає екземпляр бота і реєструє обробники;
   - передавати в обробники (або в “сервіси”) залежності: `bot`, `prisma`, `adminChatId`.  
   Це дасть змогу в тестах підставляти мок-бота та мок-prisma без зміни глобального стану.

5. **Винести стани потоків**  
   `driverRideStateMap` і `passengerRideStateMap` винести в окремий модуль (наприклад `src/telegram/flows-state.ts`) з інтерфейсом типу `getState(chatId)`, `setState(chatId, state)`, `deleteState(chatId)`. У тестах можна буде підміняти цей модуль і перевіряти переходи кроків.

### Фаза 3: Тести обробників

6. **Юніт-тести обробників**  
   Для кожної команди/події витягнути “ядро” логіки в функції типу `handleStart(msg, deps)`, `handleHelp(msg, deps)`, `handleBookCallback(query, deps)` тощо.  
   `deps` = `{ bot, prisma, adminChatId, getState, setState, ... }`.  
   Тести викликають ці функції з фейковими `msg`/`query` і моками `deps`, перевіряють виклики `bot.sendMessage` / `editMessageText` і зміни стану.

7. **Інтеграційні тести (опційно)**  
   Один або кілька E2E-тестів: підняти тестовий Prisma (наприклад SQLite), мок Telegram API (або тестовий бот), відправити команди і перевірити відповіді та записи в БД. Можна робити пізніше, після стабілізації рефакторингу.

### Фаза 4: Додаткове покриття

8. **Покрити внутрішні функції**  
   Після винесення в окремі модулі додати тести для:
   - `createDriverListingFromState` / `createPassengerListingFromState` (з моками prisma, bot, notify);
   - `findMatchingPassengersForDriver` / `findMatchingDriversForPassenger` (мок prisma, перевірка фільтрації за маршрутом/датою/часом).

9. **Покрити повідомлення**  
   Для `sendBookingNotificationToAdmin`, `sendViberListingNotificationToAdmin` тощо: у середовищі з увімкненим мок-ботом перевіряти, що текст повідомлення містить очікувані поля (маршрут, дата, телефон тощо).

---

## Як запускати тести

```bash
cd backend
npm run test          # один прогон
npm run test:watch    # режим watch
npm run test:coverage # звіт покриття
```

Середовище тестів: `TELEGRAM_BOT_TOKEN` порожній (у `vitest.config.ts`), щоб бот не стартував і не намагався підключатися до Telegram.

---

## Питання, які варто вирішити перед рефакторингом

1. **Місце зберігання станів потоків**  
   Зараз це in-memory Map з TTL. Чи планується збереження в Redis/БД для перезапусків і масштабування?

2. **Розбиття файлу**  
   Один великий `telegram.ts` vs кілька файлів (`telegram/commands.ts`, `telegram/callbacks.ts`, `telegram/notifications.ts` тощо) — що прийнятніше для команди?

3. **Типізація повідомлень**  
   Чи потрібні окремі типи для `msg`, `query`, payload-ів callback_data, щоб зменшити помилки при зміні контрактів?

Якщо з’являться питання по конкретним крокам або по написанню тестів для окремих обробників — можна розписати їх детальніше (наприклад, приклад тесту для `/start` або для callback `adddriver_route_*`).
