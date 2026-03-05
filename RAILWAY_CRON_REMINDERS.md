# 🔔 Нагадування Telegram на Railway (cron)

Як запустити автоматичні нагадування про поїздки, коли бекенд задеплоєний на [Railway](https://railway.com).

Railway **не має вбудованого cron**, тому використовуємо зовнішній сервіс, який щодня викликає ваш backend.

---

## Що вже є в проєкті

1. **За день до поїздки** — нагадування «завтра у вас поїздка» (щодня ввечері).
2. **В день поїздки вранці** — нагадування «сьогодні у вас поїздка» (щодня вранці).
3. **Очищення старих Viber оголошень** — деактивація оголошень, у яких дата по вже минула (наприклад, кожні 1–2 години).
4. **Завантаження з групи PoDoroguem** — автоматичний імпорт нових повідомлень з Telegram-групи (Малин-Київ, Малин-Житомир, Малин-Коростень) без ручного натискання в боті (кожні 2 години).

Усі викликаються через HTTP POST на ваш backend з адмін-заголовком.

---

## Крок 1: URL вашого backend на Railway

1. Відкрийте проект: [Railway Dashboard](https://railway.com/project/b43d0897-c2ac-4ec5-883a-1a238e87a997) (або ваш проект).
2. Виберіть сервіс **backend**.
3. **Settings** → **Networking** → **Public Networking**.
4. Скопіюйте **URL** (наприклад: `https://kyiv-malyn-booking-production.up.railway.app`).  
   Якщо домен ще не згенерований — натисніть **Generate Domain**.

Збережіть цей URL — він потрібен для cron.

---

## Крок 2: Авторизація (обов’язково)

Endpoint нагадувань захищений адмін-токеном. У заголовок кожного запиту потрібно додати:

```
Authorization: admin-authenticated
```

(Це фіксований токен, який бекенд повертає після успішного логіну в адмінку.)

Без цього заголовка відповідь буде `401 Unauthorized`.

---

## Крок 3: Налаштування cron (безкоштовно)

Підійде будь-який сервіс, що робить HTTP-запити за розкладом, наприклад:

- [cron-job.org](https://cron-job.org) (безкоштовно)
- [easycron.com](https://www.easycron.com)
- [Uptime Robot](https://uptimerobot.com) (моніторинг + HTTP hit за розкладом)

### Приклад: cron-job.org

1. Зареєструйтесь на [cron-job.org](https://cron-job.org).
2. **Create Cronjob**.
3. **Нагадування «завтра» (за день до поїздки):**
   - **Title:** `Telegram: нагадування за день до поїздки`
   - **URL:** `https://ВАШ-BACKEND-URL.railway.app/telegram/send-reminders`
   - **Method:** `POST`
   - **Request Headers:**  
     `Authorization` = `admin-authenticated`
   - **Schedule:** щодня о **20:00** (або інший час у вашому часовому поясі).
   - Зберегти.

4. **Нагадування «сьогодні» (в день поїздки):**
   - **Title:** `Telegram: нагадування в день поїздки`
   - **URL:** `https://ВАШ-BACKEND-URL.railway.app/telegram/send-reminders-today`
   - **Method:** `POST`
   - **Request Headers:**  
     `Authorization` = `admin-authenticated`
   - **Schedule:** щодня о **08:00** (або інший ранковий час).
   - Зберегти.

5. **Очистити старі Viber оголошення (архів):**
   - **Title:** `Viber: очистити старі оголошення`
   - **URL:** `https://ВАШ-BACKEND-URL.railway.app/viber-listings/cleanup-old`
   - **Method:** `POST`
   - **Request Headers:**  
     `Authorization` = `admin-authenticated`
   - **Schedule:** кожні **1 годину** або **2 години** (наприклад `0 * * * *` або `0 */2 * * *`).
   - Зберегти.

6. **Завантажити нові повідомлення з групи PoDoroguem (Telegram):**
   - **Title:** `Telegram: fetch group messages (PoDoroguem)`
   - **URL:** `https://ВАШ-BACKEND-URL.railway.app/telegram/fetch-group-messages`
   - **Method:** `POST`
   - **Request Headers:**  
     `Authorization` = `admin-authenticated`
   - **Schedule:** кожні **2 години** (наприклад `0 */2 * * *`).
   - Зберегти.
   - *Потрібно: особистий акаунт в групі PoDoroguem, TELEGRAM_USER_SESSION_PATH, TELEGRAM_API_ID, TELEGRAM_API_HASH.*

Підставте замість `ВАШ-BACKEND-URL` реальний домен backend з кроку 1.

---

## Перевірка вручну (curl)

Перед налаштуванням cron перевірте, що backend доступний і приймає запити:

**Нагадування за день до поїздки:**
```bash
curl -X POST "https://ВАШ-BACKEND-URL.railway.app/telegram/send-reminders" \
  -H "Authorization: admin-authenticated"
```

**Нагадування в день поїздки:**
```bash
curl -X POST "https://ВАШ-BACKEND-URL.railway.app/telegram/send-reminders-today" \
  -H "Authorization: admin-authenticated"
```

**Очистити старі Viber оголошення:**
```bash
curl -X POST "https://ВАШ-BACKEND-URL.railway.app/viber-listings/cleanup-old" \
  -H "Authorization: admin-authenticated"
```
У відповіді буде JSON, наприклад: `{"success":true,"deactivated":2,"message":"Деактивовано 2 оголошень"}`.

**Завантажити нові повідомлення з групи PoDoroguem:**
```bash
curl -X POST "https://ВАШ-BACKEND-URL.railway.app/telegram/fetch-group-messages" \
  -H "Authorization: admin-authenticated"
```
У відповіді буде JSON, наприклад: `{"success":true,"message":"Імпортовано 3 нових з 5 повідомлень","created":3,"total":5}` або `{"success":true,"message":"Немає нових повідомлень","created":0,"total":0}`.

У відповіді на нагадування очікується JSON, наприклад:
```json
{
  "success": true,
  "message": "Нагадування відправлено: 3, помилок: 0",
  "total": 3,
  "sent": 3,
  "failed": 0
}
```

Якщо Telegram не налаштовано на backend, буде `400` з текстом про те, що бот не налаштовано.

---

## Що роблять endpoint’и

| Endpoint | Коли викликати (рекомендовано) | Що робить |
|----------|--------------------------------|------------|
| `POST /telegram/send-reminders` | Щодня о 20:00 | Шукає бронювання на **завтра**, відправляє в Telegram нагадування «завтра у вас поїздка». |
| `POST /telegram/send-reminders-today` | Щодня о 08:00 | Шукає бронювання на **сьогодні**, відправляє нагадування «сьогодні у вас поїздка». |
| `POST /viber-listings/cleanup-old` | Кожні 1–2 год | Деактивує Viber оголошення, у яких **дата по** (дата + кінець часу) вже минула більш ніж на 3 год. Архів оновлюється автоматично. |
| `POST /telegram/fetch-group-messages` | Кожні 2 год | Завантажує **нові** повідомлення з групи PoDoroguem (Малин-Київ, Малин-Житомир, Малин-Коростень), імпортує в Viber listings, прив'язує telegramUserId до Person. |

Нагадування отримують тільки бронювання, у яких заповнений `telegramChatId` (користувач підписаний на бота).

---

## Пов’язане: одноразове промо від особистого акаунта

Якщо потрібно, щоб користувачам без бота один раз відправлялося промо **від вашого особистого Telegram** — інструкція з реєстрації акаунта та налаштування на Railway: **`backend/telegram-user/README.md`**.

---

## Чеклист

- [ ] Backend задеплоєний на Railway, згенерований публічний URL.
- [ ] У backend змінні оточення: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` (див. `RAILWAY_SETUP.md`).
- [ ] Перевірено вручну: `curl` на обидва endpoint’и з заголовком `Authorization: admin-authenticated`.
- [ ] На cron-job.org (або аналозі) створено cronjob'и: нагадування за день, нагадування сьогодні, очищення старих Viber оголошень (опціонально, кожні 1–2 год), завантаження з групи PoDoroguem (опціонально, кожні 2 год).
- [ ] Час виклику в налаштуваннях cron відповідає вашому часовому поясу.

Після цього нагадування про поїздки будуть відправлятися автоматично.
