# Автоматизація обідів — група «Обіди для НЕ бідних»

Telethon-слухач читає фото меню (OCR через OpenAI Vision), приймає замовлення текстом,
рахує суму по меню і звіряє оплати («оплатив 150»). Дані — у спільному Postgres (таблиці Prisma `Lunch*`).

**На Railway listener стартує автоматично разом з backend** (`startLunchListener` у `src/index.ts`),
окремий сервіс не потрібен. Вимкнути: `LUNCH_LISTENER_ENABLED=0`.

## Група

- Назва: Обіди для НЕ бідних
- `LUNCH_GROUP_ID=-5427750954` (за замовчуванням)

## Залежності

```bash
cd backend/telegram-user
pip install -r requirements.txt -r lunch/requirements.txt
```

Потрібна міграція Prisma (таблиці Lunch*):

```bash
cd backend
npx prisma migrate deploy
```

## Змінні середовища

| Змінна | Опис |
|--------|------|
| `DATABASE_URL` | Postgres (той самий, що у backend) |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | my.telegram.org |
| `TELEGRAM_USER_SESSION_PATH` | шлях до сесії (без `.session`), напр. `.../session_telegram_user` |
| `OPENAI_API_KEY` | для OCR меню з фото (опційно; інакше імпорт через адмінку) |
| `LUNCH_GROUP_ID` | `-5427750954` |
| `LUNCH_OPERATOR_IDS` | опційно: Telegram user id операторів через кому (`!close` / `!open`) |
| `LUNCH_OCR_MODEL` | опційно, за замовч. `gpt-4o-mini` |
| `LUNCH_LISTENER_ENABLED` | `1` (default) — автозапуск з Node; `0` — вимкнути |

Можна покласти їх у `backend/.env` або `telegram-user/.env`.

## Запуск

Разом з API (як на Railway):

```bash
cd backend && npm start
# у логах: [lunch-listener] starting python -m lunch.listener
```

Окремо (локально):

```bash
cd backend/telegram-user
export TELEGRAM_USER_SESSION_PATH="$(pwd)/session_telegram_user"
python3 -m lunch.listener
```

Пост меню з адмінки йде в чергу `LunchOutboundMessage` — listener надсилає в групу (одна Telethon-сесія).

## Команди в чаті

| Команда / текст | Дія |
|-----------------|-----|
| фото меню | OCR → меню (лише якщо є `OPENAI_API_KEY`; інакше **мовчки** ігнорує — меми ок) |
| `Пюре \| Котлети…` | замовлення, reply з сумою; якщо **не розпізнано** — мовчить |
| день `closed` + розпізнаний заказ | «Прийом замовлень закрито.» (без matched страв — мовчить) |
| підсумок з цитатами `> Імʼя:` (Святослав) | парсинг усіх замовлень, дозаказ без імені якщо є зайве, **закриття дня** |
| `оплатив 150` / `!pay 150` | оплата, залишок боргу |
| номер картки (16 цифр) | зберегти `payeeCard` на день |
| `!summary` | зведення замовлень |
| `!debts` | хто винен |
| `!menu` | показати меню |
| `!close` / `!open` | закрити / відкрити день (оператор) |

## Тести парсерів (без мережі)

```bash
cd backend/telegram-user
python3 -m lunch.test_parsers
```

## Ручний OCR через ChatGPT (без API-ключів)

Промпт і формат JSON: [CHAT_GPT_PROMPT.md](CHAT_GPT_PROMPT.md).

```bash
pbpaste | python3 -m lunch.import_menu
# або через адмінку /admin → «Столова»
```

## Railway (backend)

Міграції `Lunch*` + `LunchOutboundMessage` — при `npm start` (`prisma migrate deploy`).

Уже потрібні: `DATABASE_URL`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, файл сесії в репо.

Опційно: `LUNCH_GROUP_ID=-5427750954`, `LUNCH_LISTENER_ENABLED=1` (default).

Після деплою в логах шукай: `[lunch-listener] starting` і `[lunch] listening group=...`.

Коротка інструкція: [HOW_TO_USE.md](HOW_TO_USE.md).
