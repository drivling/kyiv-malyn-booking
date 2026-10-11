# Реєстрація особистого Telegram-акаунта для одноразового промо (Railway)

Підключення відправки одноразових промо-повідомлень від вашого особистого акаунта на **Railway**. Сесія зберігається у змінній Railway `TELEGRAM_USER_SESSION_BASE64` (gzip + base64, ~1,5 тис. символів), а не в репозиторії.

---

## Що це дає

1. **Одноразове промо** — при додаванні оголошення в **Viber Rides**:

- Якщо автор **вже в боті** — сповіщення йде **від бота**.
- Якщо автора **немає в боті**, але є в базі (Person) і ви ще **ні разу не слали** йому промо — один раз відправляється повідомлення **від вашого особистого акаунта** (оголошення + інструкція підписатися на бота). Далі ставиться мітка, щоб не спамити.

2. **Завантаження оголошень з Telegram групи PoDoroguem** — команда `/addtelegram` в боті дозволяє автоматично отримати повідомлення з групи https://t.me/PoDoroguem (потоки Малин-Київ, Малин-Житомир, Малин-Коростень). Для цього ваш акаунт має бути доданий в цю групу.

---

## Крок 1: Отримати API ID та API Hash (вже є)

**Ваші значення (Malin Routes):**

| Змінна | Значення |
|--------|----------|
| `TELEGRAM_API_ID` | `35076972` |
| `TELEGRAM_API_HASH` | `9b47fc0d11ed33c59e16047d084da56b` |

---

## Крок 2: Авторизувати акаунт локально і передати сесію в Railway

Файл сесії дає **повний доступ до вашого Telegram**, тому в git його більше не тримаємо (з 2026-10-10):
сесія живе лише у змінній Railway `TELEGRAM_USER_SESSION_BASE64`, а backend під час старту пише її у
`telegram-user/session_telegram_user.session` поруч зі скриптами.

**Один раз** на своєму комп’ютері:

```bash
cd backend/telegram-user
pip install -r requirements.txt
export TELEGRAM_API_ID="35076972"
export TELEGRAM_API_HASH="9b47fc0d11ed33c59e16047d084da56b"
python3 auth_session.py --fresh --qr --export     # або без --qr — вхід за кодом
```

- `--fresh` спершу видаляє старий локальний файл сесії (мертвий після `AuthKeyDuplicatedError`).
- `--qr` — вхід через Telegram → Налаштування → Пристрої → Підключити пристрій (без коду).
- `--export` друкує значення для Railway (base64 від gzip файлу, ~1,5 тис. символів; на Mac одразу
  в буфері обміну) і **видаляє локальну копію**, щоб ніхто не відкрив ту саму сесію поруч із сервером.

---

## Крок 3: Змінні середовища на Railway

У **Railway** → проєкт → сервіс **backend** (`kyiv-malyn-booking`) → **Variables**:

| Змінна | Значення |
|--------|----------|
| `TELEGRAM_API_ID` | `35076972` |
| `TELEGRAM_API_HASH` | `9b47fc0d11ed33c59e16047d084da56b` |
| `TELEGRAM_USER_SESSION_BASE64` | значення з `auth_session.py --export` |

Після збереження Railway перезапустить backend. Якщо слухача обідів вимикали (`LUNCH_LISTENER_ENABLED=0`),
приберіть цю змінну або поставте `1`.

Переконайтеся, що є також: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` (для бота).

**Якщо на Railway з’являється помилка `spawn python3 ENOENT`:** сервіс backend має збиратися з **Dockerfile** (у ньому є Node + Python). У налаштуваннях сервісу вкажіть **Root Directory** = `backend` (або той каталог, де лежить `Dockerfile`), щоб Railway використав цей Dockerfile замість Railpack.

**Якщо збірка пройшла, а сервіс не стартує:** у сервісу backend перевірте **Start Command**. При збірці через Docker не потрібно `cd backend` — контейнер уже в корені backend. Краще залишити Start Command **порожнім** (тоді використовується CMD з Dockerfile: `npm start`) або вказати `npm start`.

---

## Крок 4: Після деплою

У **Deploy Logs** мають з’явитися:

- `[KYIV-MALYN-BACKEND] Telegram user session written from TELEGRAM_USER_SESSION_BASE64 (… bytes)`
- `[telegram-session] lease acquired …` — цей екземпляр тримає сесію;
- `[lunch] listening group=…` — слухач обідів підключився.

### Одна сесія — одне місце

Telegram анулює ключ назавжди (`AuthKeyDuplicatedError`), якщо та сама сесія підключена з двох IP
одночасно. Так сталося 2026-10-10: під час деплою новий контейнер Railway підключився, поки старий ще
працював. Тепер backend бере **оренду сесії** в таблиці `TelegramSessionLease`
(`src/telegram-session-lease.ts`): новий контейнер чекає, поки старий звільнить її на SIGTERM (або поки
його серцебиття не застаріє на 45 с), і лише тоді запускає Telethon. Якщо сесію все ж відкликано,
слухач більше не перезапускається, а бот пише вам в адмін-чат — повторіть **Крок 2**.

Локально **не запускайте** скрипти з тією ж сесією, поки вона працює на Railway. Для локальних
скриптів створіть окрему: `python3 auth_session.py local_session` і
`TELEGRAM_USER_SESSION_PATH=local_session python3 …`.

---

## Як перевірити роботу

1. Додайте тестове **Viber-оголошення** з номером людини, яка **не** в боті і для якої ще не слали промо.
2. У логах backend має з’явитися:  
   `✅ Telegram: автору Viber оголошення #N надіслано одноразове промо від вашого акаунта, Person.telegramPromoSentAt оновлено`
3. У таблиці `Person` для цього номера заповниться `telegramPromoSentAt`. Повторне промо на цей номер не відправляється.

---

## Код не приходить / «all available options for this type of number were already used»

Telegram обмежує, скільки разів і якими каналами (додаток → SMS → дзвінок) можна запросити код для одного номера. Коли варіанти вичерпано, `retry` більше нічого не дасть — `phone_code_hash` лишається тим самим.

1. **Не закривайте скрипт**: код із першого повідомлення ще може діяти. Скрипт на старті пише, куди саме пішов код. Для `SentCodeTypeApp` це чат «Telegram» (777000) на пристрої, де акаунт уже увійшов; приходить без звуку.
2. **Вхід по QR** — не залежить від ліміту на коди:
   ```bash
   pip install qrcode          # лише щоб малювати QR у терміналі; без нього скрипт надрукує tg://-посилання
   python3 auth_session.py --qr
   ```
   У телефоні: Налаштування → Пристрої → Підключити пристрій → навести камеру на QR. Якщо увімкнено 2FA — скрипт запитає пароль.
3. Або зачекайте (від кількох годин до доби) і запустіть звичайний `python3 auth_session.py`.

---

## Якщо змінили API_ID або API_HASH

**Спочатку видаліть старі файли сесії** — вони прив’язані до попередніх credentials:

```bash
cd backend/telegram-user
rm -f session_telegram_user.session session_telegram_user.session-journal
```

Потім повторити **Крок 2** і оновити `TELEGRAM_USER_SESSION_BASE64` у Railway.

---

## Якщо змінили пароль Telegram або вийшли з акаунта

Повторити **Крок 2** і оновити `TELEGRAM_USER_SESSION_BASE64` у Railway — backend перезапуститься з новою сесією.

---

## Короткий чеклист

- [ ] Локально виконано `python3 auth_session.py --fresh --qr --export`
- [ ] У Railway є **TELEGRAM_API_ID**, **TELEGRAM_API_HASH** і **TELEGRAM_USER_SESSION_BASE64**
- [ ] Після деплою в логах є рядки про сесію зі змінної, оренду та `[lunch] listening`
- [ ] Тестове Viber-оголошення (номер без бота) дає лог про відправку промо

Готово. Одноразове промо працює автоматично.

---

## Локальна перевірка формату номера для Telegram API

Щоб перевірити, в якому форматі **contacts.resolvePhone** приймає номер (без відправки повідомлення):

```bash
cd backend/telegram-user
export TELEGRAM_API_ID="35076972"
export TELEGRAM_API_HASH="9b47fc0d11ed33c59e16047d084da56b"
# Окрема локальна сесія (python3 auth_session.py local_session) — не та, що на Railway
export TELEGRAM_USER_SESSION_PATH=local_session
python3 test_resolve_phone.py 0501399910
```

Скрипт підключається під вашим акаунтом, для вказаного номера перебирає кілька форматів (E.164 з +, +380(XX)..., тільки цифри тощо) і виводить, для якого формату API повернуло користувача (OK), а для якого — помилку. Так можна побачити, який саме формат приймає Telegram.
