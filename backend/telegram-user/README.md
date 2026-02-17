# Реєстрація особистого Telegram-акаунта для одноразового промо (Railway)

Підключення відправки одноразових промо-повідомлень від вашого особистого акаунта на **Railway**. Сесія зберігається у **файлі в репо** — змінні середовища на Railway не обмежуються довжиною.

---

## Що це дає

При додаванні оголошення в **Viber Rides**:

- Якщо автор **вже в боті** — сповіщення йде **від бота**.
- Якщо автора **немає в боті**, але є в базі (Person) і ви ще **ні разу не слали** йому промо — один раз відправляється повідомлення **від вашого особистого акаунта** (оголошення + інструкція підписатися на бота). Далі ставиться мітка, щоб не спамити.

---

## Крок 1: Отримати API ID та API Hash (вже є)

**Ваші значення (Malin Routes):**

| Змінна | Значення |
|--------|----------|
| `TELEGRAM_API_ID` | `35082143` |
| `TELEGRAM_API_HASH` | `8095eb80857cacd09c29c7891d1bf4e5` |

---

## Крок 2: Авторизувати акаунт локально і додати файл сесії в репо

**Один раз** на своєму комп’ютері:

```bash
cd backend/telegram-user
pip install -r requirements.txt
export TELEGRAM_API_ID="35082143"
export TELEGRAM_API_HASH="8095eb80857cacd09c29c7891d1bf4e5"
python3 auth_session.py
```

Ввести номер телефону, код з Telegram, 2FA (якщо є). Після успіху в папці з’являться:

- `session_telegram_user.session`
- (іноді) `session_telegram_user.session-journal`

**Додати в git і закомітити тільки основний файл сесії:**

```bash
cd backend/telegram-user
git add session_telegram_user.session
git commit -m "Add Telegram user session for one-time promo"
git push
```

**Важливо:** файл сесії дає повний доступ до вашого Telegram. **Репозиторій має бути приватним** (або не публікуйте цей файл у публічний репо).

---

## Крок 3: Змінні середовища на Railway

У **Railway** → проєкт → сервіс **backend** → **Variables** додайте **лише дві** змінні:

| Змінна | Значення |
|--------|----------|
| `TELEGRAM_API_ID` | `35082143` |
| `TELEGRAM_API_HASH` | `8095eb80857cacd09c29c7891d1bf4e5` |

**TELEGRAM_USER_SESSION_BASE64 не потрібна** — backend читає сесію з файлу `telegram-user/session_telegram_user.session` у репо.

Переконайтеся, що є також: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` (для бота).

**Якщо на Railway з’являється помилка `spawn python3 ENOENT`:** сервіс backend має збиратися з **Dockerfile** (у ньому є Node + Python). У налаштуваннях сервісу вкажіть **Root Directory** = `backend` (або той каталог, де лежить `Dockerfile`), щоб Railway використав цей Dockerfile замість Railpack.

**Якщо збірка пройшла, а сервіс не стартує:** у сервісу backend перевірте **Start Command**. При збірці через Docker не потрібно `cd backend` — контейнер уже в корені backend. Краще залишити Start Command **порожнім** (тоді використовується CMD з Dockerfile: `npm start`) або вказати `npm start`.

---

## Крок 4: Після деплою

Після `git push` Railway задеплоїть backend. У **Deploy Logs** має з’явитися:

`[KYIV-MALYN-BACKEND] Telegram user session loaded from repo file telegram-user/session_telegram_user.session`

Якщо цього рядка немає — перевірте, що файл `backend/telegram-user/session_telegram_user.session` дійсно є в репо і що задані `TELEGRAM_API_ID` та `TELEGRAM_API_HASH`.

---

## Як перевірити роботу

1. Додайте тестове **Viber-оголошення** з номером людини, яка **не** в боті і для якої ще не слали промо.
2. У логах backend має з’явитися:  
   `✅ Telegram: автору Viber оголошення #N надіслано одноразове промо від вашого акаунта, Person.telegramPromoSentAt оновлено`
3. У таблиці `Person` для цього номера заповниться `telegramPromoSentAt`. Повторне промо на цей номер не відправляється.

---

## Якщо змінили пароль Telegram або вийшли з акаунта

Повторити **Крок 2**: знову запустити `auth_session.py` локально, отримати новий `session_telegram_user.session`, замінити файл у репо і зробити commit + push. Після деплою буде використовуватися нова сесія.

---

## Короткий чеклист

- [ ] Локально виконано `python3 auth_session.py`, з’явився `session_telegram_user.session`
- [ ] Файл `session_telegram_user.session` додано в git і запушено (репо приватний)
- [ ] У Railway додано **TELEGRAM_API_ID** та **TELEGRAM_API_HASH**
- [ ] Після деплою в логах є рядок про завантаження сесії з файлу
- [ ] Тестове Viber-оголошення (номер без бота) дає лог про відправку промо

Готово. Одноразове промо працює автоматично.

---

## Локальна перевірка формату номера для Telegram API

Щоб перевірити, в якому форматі **contacts.resolvePhone** приймає номер (без відправки повідомлення):

```bash
cd backend/telegram-user
export TELEGRAM_API_ID="35082143"
export TELEGRAM_API_HASH="8095eb80857cacd09c29c7891d1bf4e5"
# Сесія має вже існувати (після auth_session.py)
python3 test_resolve_phone.py 0501399910
```

Скрипт підключається під вашим акаунтом, для вказаного номера перебирає кілька форматів (E.164 з +, +380(XX)..., тільки цифри тощо) і виводить, для якого формату API повернуло користувача (OK), а для якого — помилку. Так можна побачити, який саме формат приймає Telegram.
