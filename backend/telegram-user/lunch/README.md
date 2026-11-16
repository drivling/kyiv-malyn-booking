# Автоматизація обідів — група «Обіди для НЕ бідних»

Telethon-слухач читає фото меню (розпізнає Claude), приймає замовлення текстом, рахує суму по меню
і звіряє оплати: «оплатив 150», фото й PDF чеків, посилання на квитанцію monobank, «віддам готівкою».
Дані — у спільному Postgres (таблиці Prisma `Lunch*`).

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
| `TELEGRAM_USER_SESSION_BASE64` | на Railway: сесія з `auth_session.py --export`; backend пише її у файл під час старту ([../README.md](../README.md)) |
| `ANTHROPIC_API_KEY` | для OCR меню з фото через Claude (опційно; інакше імпорт через адмінку). Кредити API входять у план Max: claude.ai → Settings → Billing → «API credits» → привʼязати організацію Console, там створити ключ |
| `ANTHROPIC_WORKSPACE_ID` | лише якщо ключ створено на рівні організації, а не у воркспейсі (400 «must include the anthropic-workspace-id header»): ID воркспейсу `wrkspc_…` з Console → Settings → Workspaces |
| `LUNCH_GROUP_ID` | `-5427750954` |
| `LUNCH_OPERATOR_IDS` | опційно: Telegram user id операторів через кому (`!close` / `!open`) |
| `LUNCH_OCR_MODEL` | опційно, лише `claude-*`; за замовч. дешева `claude-haiku-5-5`: дивиться кожне фото й PDF і читає суми чеків (старе `gpt-…` ігнорується) |
| `LUNCH_MENU_MODEL` | опційно, лише `claude-*`; за замовч. `claude-opus-5-5`: нею меню перечитується, щойно дешева сказала «це меню». Порівняння на фото 13 і 16.11.2026 (блок «Моделі розпізнавання» в адмінці): чеки Haiku читає як Opus (14 із 14), а в меню зсуває ціни на рядок — 16 хибних із 34 за день |
| `LUNCH_LISTENER_ENABLED` | `1` (default) — автозапуск з Node; `0` — вимкнути |
| `DZHURA_ENABLED` | `1` (default) — у цьому ж процесі працює «Джура» (читання обраних чатів у базу, `/admin/dzhura`); `0` — вимкнути. Див. [../dzhura/README.md](../dzhura/README.md) |

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
Та сама черга з `target='saved'` — дублі «Джури» в «Обране» власника (HTML).

## Команди в чаті

| Команда / текст | Дія |
|-----------------|-----|
| фото меню | Claude → меню, **доливається** в наявне меню дня (два фото, меню з адмінки не стираються). Лише якщо є `ANTHROPIC_API_KEY`; інакше фото **мовчки** ігнорує |
| фото або PDF чека | Claude читає суму переказу (PDF — першу сторінку картинкою: банківські PDF API документом не приймає) → оплата на цю суму, «✅ Оплатив» правкою нашої відповіді на замовлення (у групу нічого нового). Та сама сума вже є з «оплатив 150» чи кнопки — чек її лише підтверджує. Мем, список замовлень — мовчки |
| `https://check.monobank.ua/p/…` | посилання на чек: суму прочитати не можна (сторінка за капчею), тому гаситься весь поточний борг людини; в адмінці оплата позначена «суму не перевірено». Чек раніше за замовлення — зарахується, коли замовлення з'явиться |
| `скинула гроші` / `оплатив` (без суми й чека) | як посилання на чек: гаситься весь поточний борг людини, в адмінці — «написав(ла), що оплатив(ла) — суму не перевірено». Лише минулий час від першої особи: «скину», «скиньте», «хто не скинув?» оплатою не стають |
| `віддам готівкою` / `налом` / `дам наличкой` | окремо або в тексті замовлення: у відповіді «💵 Готівкою», в адмінці й `!debts` — позначка. Оплатою не вважається — оператор тисне «Оплатив», коли отримав |
| `Пюре \| Котлети…` | замовлення, reply з сумою; якщо **нічого** не розпізнано — мовчить (є в логах і в «Писали в групі» адмінки); якщо кілька страв підходять однаково — питає «це А чи Б?» |
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
python3 -m dzhura.test_relay
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
