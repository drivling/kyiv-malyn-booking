# Аудит: пошук попуток на головній — сховище та швидкодія

**Status:** Фази 0–2 — PR #38 (`perf/poputky-search-phase-0-1`); Фази 3–4 — гілка `perf/poputky-search-phase-3-4` поверх неї; регіон Railway перенесено 24.09.2026 (бекенд і фронт → europe-west4-drams3a); далі Фаза 6 і NOT NULL з 3.4  
**Created:** 2026-09-24  

Аудит зроблено 24.09.2026 (Railway metrics + код). Правило проекту: один пункт чеклісту → один
англійський коміт; після змін у `backend/src` — `npm run build` і коміт `dist/` разом.


## Commits checklist

Фаза 0
- [x] **0.2** gzip (`compression`) у `create-app.ts`
- [x] **0.3** `X-Response-Time` + лог `[http] METHOD /path status ms` (`src/middleware/request-timing.ts`)
- [x] **0.4** Цей план у `Docs/`
- [x] **0.1** Railway: `kyiv-malyn-booking` + `frontend` → `europe-west4-drams3a` (зроблено 24.09.2026 через GraphQL `serviceInstanceUpdate` + redeploy; `DATABASE_URL` уже йде через `postgres.railway.internal`)

Фаза 1
- [x] **1.1** Головна: оголошення через `GET /viber-listings/search?fromCode&toCode&date`
- [x] **1.2** `date` у `GET /schedules`
- [x] **1.3** Кеш каталогів (`src/api/catalogCache.ts`): trip-points / trip-routes / od-pairs
- [x] **1.4** Один шлях availability (без дубля), `BusBookingModal` без третього запиту
- [x] **1.5** AbortController + request-id у `loadResults`
- [x] **1.6** Видалити мертві `BookingPage`, `PoputkyPage`

Фаза 2
- [x] **2.1** Міграція індексів (`ViberListing`, `RideShareRequest`, `Person`)
- [x] **2.1b** `getChatIdByPhone`/`getNameByPhone` без unbounded-сканів `Booking`
- [x] **2.2** `catalog-cache.ts` + заміна `tripPoint.findMany()` у гарячих шляхах
- [x] **2.3** Публічний DTO без `phone`/`rawMessage`
- [x] **2.4** `GET /poputky/search` (listings + schedules + availability одним запитом)
- [x] **2.5** Фронт на `/poputky/search`

Фаза 3
- [x] **3.1** `ViberListing.endsAt` + cleanup одним `updateMany`
- [~] **3.2** Partial index `WHERE "isActive"` — пропущено: покривається індексом 2.1 `(isActive, date, listingType)`, а raw-індекс поза схемою Prisma ламає `migrate dev` (дрейф)
- [x] **3.3** Архів = `ViberRideEvent` (уже існував): `POST /viber-listings/archive-old?days=90` (імпорт в аналітику + видалення неактивних старших за N днів) + протермінування `RideShareRequest` у `cleanup-old`
- [x] **3.4** Backfill `fromPointId/toPointId` з route-рядка (міграція) + `GET /admin/od-identity-stats`; NOT NULL і прибирання `OR route=` — після того, як stats у проді покажуть `missingOd = 0` (окремий коміт)

Фаза 4
- [x] **4.1** `poputky-match.ts`: `findMatchCandidates` у SQL, одна реалізація для бота/адмінки
- [x] **4.2** Одна «доба Києва» + фікс along-route у `/search`
- [x] **4.3** `NotificationJob` + воркер

Фаза 5
- [x] **5.1** Ідемпотентний ingest: `ViberListingSource(hash @unique)` — одне оголошення ← багато повідомлень; `viber-ingest.ts` як єдиний шлях для POST і bulk
- [x] **5.2** Telethon/Opendatabot name-lookup → job `resolve_sender_name` (перед `listing_match` у черзі)
- [x] **5.3** Парсер → один `POST /viber-listings/bulk` (масив) на тик, курсор після відповіді пачки; `db_parser_state.json` чистить сміттєві ключі сам; `viberparser/test_parser.py`
- [x] **5.4** Імпорт Telegram-груп: пошук імені (бот/Telethon/Opendatabot) винесено з циклу імпорту в job `resolve_sender_name`; перетини — через чергу з 4.3. Bulk-шлях HTTP не потрібен: імпорт іде всередині процесу

Фаза 6
- [ ] Бот (`/allrides`, inline, `/my*rides`) на `searchListings()`

---

## Контекст

Пошук поїздок на головній (`/` → `MizhgorodskiPage`) працює повільно. Ті самі дані
(`ViberListing`) читають сайт, Telegram-бот, парсер Viber/Telegram-груп (додавання + мерж),
і логіка «перетинів» (матчинг пасажир↔водій). Потрібно зрозуміти, чому повільно зараз, і що
не масштабується при зростанні користувачів і оголошень.

## Що виміряно (Railway, production, останні 7 днів)

| Показник | Значення |
|---|---|
| Регіон бекенду `kyiv-malyn-booking` | **us-east4** (США, Вірджинія) |
| Регіон фронту `frontend` | **us-east4** |
| Регіон `Postgres` + volume | **europe-west4** (Нідерланди) |
| CPU бекенду / Postgres (avg) | 0.3 % / 0.1 % |
| Диск Postgres | 0.12 GB |
| Запитів до API за тиждень | ~21 400 (з них `/viber-listings` ~1 100) |
| `GET /trip-points` p50 / p90 | ~95 мс / ~850 мс |
| `GET /od-pairs` p50 / p90 | ~550–820 мс / ~1 600 мс |
| `GET /trip-routes` p50 / p90 | ~560–840 мс / ~1 800 мс |
| `GET /schedules` p50 / p90 | ~1 000 мс / ~2 450 мс |
| `GET /viber-listings` p50 / p90 | ~730–1 220 мс / ~3 100 мс |

Висновок: це **не** навантаження і **не** обсяг даних. БД крихітна, CPU нульовий. Латентність
= кількість послідовних round-trip'ів до Postgres (кожен ≈ 90–100 мс через Атлантику) ×
кількість запитів, які фронт робить на один пошук, + ~130 мс від користувача в Україні до
бекенду в США на кожен HTTP-запит.

## Діагноз (за впливом)

### D1. Топологія: бекенд/фронт у США, база в Європі
`describe-environment` показує `us-east4` для двох сервісів і `europe-west4` для Postgres.
`/trip-points` (1 SQL-запит) p50 ≈ 95 мс — це і є ціна одного round-trip. Ендпоінти з
Prisma `include` (Prisma 5 без `relationJoins` = окремий запит на кожен рівень зв'язку)
множать це: `/od-pairs` = 4 запити ≈ 550–800 мс, `/schedules` (deep include + `tripPoint.findMany`)
≈ 1 с.

### D2. Фронт: на кожен пошук — 4 «bulk» запити + 2×N availability, все фільтрується в браузері
`frontend/src/pages/MizhgorodskiPage/MizhgorodskiPage.tsx:230-289` (`loadResults`):
- `GET /viber-listings?active=true` — **усі активні оголошення за всі дати й маршрути**, повні
  рядки (`serializeViberListing` у `backend/src/index-helpers.ts:71` розгортає весь ряд:
  `rawMessage`, `phone`). Фільтр по даті й OD — у браузері (`mizhUtils.ts:143 listingMatchesCities`).
- `GET /schedules?fromCode&toCode` — без `date` (сервер підтримує).
- `GET /trip-routes` (усі маршрути з усіма зупинками) і `GET /trip-points?appearInPoputky=true` —
  **повторно на кожен пошук**, хоча це майже статичний каталог (на маунті вони вже завантажені: 166-176).
- Далі N × `GET /schedules/by-id/:id/availability` — і **вдруге** ті самі N запитів з ефекту
  `[schedules, date]` (341-370). `BusBookingModal` робить третій.
- Немає AbortController/request-id: швидкі кліки → старіша відповідь перезаписує новішу.
- Немає кешу (react-query/SWR/ручного), немає gzip на бекенді, немає `Cache-Control`.
- Серверний `GET /viber-listings/search?fromCode&toCode&date` (`backend/src/routes/viber-listings.ts:89`)
  **існує і робить ту саму логіку**, але його використовує лише мертвий `BookingPage`.
  `PoputkyPage`/`BookingPage` не імпортуються ніде (dead code).

### D3. Бекенд: кожен ендпоінт вантажить цілі каталоги
- `resolveOdPointIdsFromRoute`, `/viber-listings/search`, `/schedules?fromCode`,
  `/poputky/announce-draft` — усі роблять `tripPoint.findMany()` без фільтра й шукають у JS.
- `/viber-listings/search` ще й `tripRoute.findMany({include: stops})` на кожен запит.
- `scheduleInclude` (`schedules-bookings.ts:100`) — 4 рівні вкладення = 5+ SQL round-trip'ів.
- Жодного in-process кешу для `TripPoint`/`TripRoute`/`TripRouteStop` (десятки рядків, змінюються
  лише з адмінки).

### D4. Модель/індекси `ViberListing` (`backend/prisma/schema.prisma:327`)
- Індекси: `[tripRouteId]`, `[fromPointId, toPointId, date, listingType]`. Але всі гарячі
  запити фільтрують по `isActive` + `date` (+ `listingType`): матчинг (`telegram.ts:671, 734`),
  `/checkclients`, `cleanup-old`, `/viber-listings?active=true`, `/allrides`, inline. Індекс,
  що починається з `fromPointId`, їх не покриває → seq scan. Зараз таблиця маленька, тому
  непомітно; з ростом стане помітно.
- Немає індексу по `personId`/`phone` (мерж-кандидати, «мої поїздки» — фільтр у JS після
  повного завантаження типу: `telegram.ts:4644, 4726`).
- «Dual-read»: identity = `fromPointId/toPointId`, але всюди ще `OR route = ...` fallback,
  бо поля nullable. Це подвоює умови й заважає індексам.
- `cleanup-old` вантажить **усі активні** рядки й рахує «дату по» в JS
  (`getViberListingEndDateTime`), бо кінець поїздки не зберігається як колонка.
- Нічого не архівується: таблиця росте назавжди (`isActive=false` лишається в тій самій таблиці).
- `RideShareRequest.expiresAt` ніколи не чиститься.
- Публічний `GET /viber-listings` віддає `phone` та `rawMessage` усім — суперечить задуму
  `/viber-listings/:id/contact` (коментар у `viber-listings.ts:63-68`). Це і приватність, і зайвий обсяг.
  `rawMessage` ще й росте при кожному мержі (`mergeRawMessage` дописує через `---`).
- Суміжні таблиці без індексів по колонках, за якими читають: `RideShareRequest` (жодного
  індексу; FK у Postgres не індексуються автоматично), `Person.telegramUserId/telegramChatId`
  (`getPersonByTelegram` — OR-скан на кожен `/rideshare/request`), `Booking.phone/telegramChatId`.
- Три різні означення «доби»: `/search` — локальний `setHours(0)`, матчинг — UTC
  `T00:00:00.000Z`, мерж — локальні `getFullYear/getMonth/getDate`. Одне оголошення може
  потрапити в різні дні у трьох шляхах.
- Семантика along-route у `/viber-listings/search`: гілка `tripRouteId in (...)` повертає
  будь-яке оголошення на маршруті, не перевіряючи його власний OD (пасажир Malyn→Kyiv
  з'являється в пошуку Irpin→Kyiv).

### D5. Матчинг («перетини») — O(усі оголошення дня) в JS, синхронно в ланцюжку ingest
- `findMatchingPassengersForDriver`/`findMatchingDriversForPassenger` вантажать усі активні
  оголошення протилежного типу за день і класифікують у JS (`classifyPoputkyRouteMatch`).
  Геометрії немає — «перетин» = порядок зупинок на `TripRoute` + перетин часових інтервалів
  (±45 хв exact, ±2 год approximate). Це нормально по суті, але кандидати не звужуються SQL-ом.
- `/checkclients` — вкладений цикл D×P по всіх майбутніх, 1.5 с sleep на пару, послідовно.
- Розсилка сповіщень (`notifyMatching*`) живе у пам'яті процесу: рестарт деплою = втрачені
  сповіщення; помилка Telethon = fan-out зупиняється.
- Відома проблема TZ: `toDateKey` (UTC) у матчингу vs локальна доба у мержі
  (`Docs/На будущее.md` §2.5).

### D6. Ingest (парсер → бекенд)
- `viberparser/parser.py` шле по одному `POST /viber-listings` кожні 2–3 с полінгу, синхронно.
- На кожен insert: `getNameByPhone` → (якщо нема імені) **spawn Python/Telethon процесу**
  (`resolveNameByPhoneFromTelegram`) → `findOrCreatePersonByPhone` → мерж (2 повних
  скани каталогів) → 3 фонові Telegram-виклики → матчинг. HTTP-відповідь чекає на все, крім
  фонових. При масовому імпорті (Telegram-групи, `/bulk`) це послідовно × N.
- Retry парсера = at-least-once без ідемпотентного ключа; дедуп рятує лише мерж-евристика.
- `getChatIdByPhone` (`telegram.ts:7597`) при відсутньому chatId у Person робить
  `booking.findMany` **без `take`** по всіх Telegram-бронюваннях і порівнює телефони в JS —
  і викликається на кожен insert та всередині кожного `sendMatchMessageToPerson`.
  `getNameByPhone` аналогічно сканує `booking.findMany({ take: 500 })`.
- Загалом ~8–11 послідовних round-trip'ів до відповіді на один `POST /viber-listings`
  (× ~100 мс при поточній топології ≈ 1 с на повідомлення).

### Чого НЕ треба робити зараз
Elasticsearch/Redis/мікросервіси/read-replica — не для 0.12 GB і 21k запитів/тиждень.
Проблема архітектурна, але рішення — у топології, формі API та індексах, а не в новій інфраструктурі.

---

## План (фази → коміти; кожен коміт — самодостатній і деплоїться окремо)

### Фаза 0 — Топологія і базова гігієна (без зміни логіки; найбільший ефект)
Очікування: p50 `/viber-listings` ~1 с → ~150 мс, увесь пошук з ~3 с → <1 с, ще до зміни коду.

- **0.1 Railway: перенести `kyiv-malyn-booking` і `frontend` в `europe-west4`** (той самий
  регіон, що Postgres). Це налаштування сервісу (`multiRegionConfig`), редеплой ~1–2 хв.
  Рішення власника: коротка недоступність під час редеплою. Перевірити, що `DATABASE_URL`
  вказує на приватний домен (`*.railway.internal`), а не на публічний TCP-proxy.
- **0.2 gzip** — `compression` middleware у `backend/src/create-app.ts` (JSON-відповіді
  каталогів/оголошень стискаються в 5–10×).
- **0.3 Таймінги запитів** — легкий middleware, що логує `method path status ms` (щоб
  вимірювати ефект наступних фаз без Railway UI). Без зовнішніх залежностей.
- **0.4 `Docs/poputky-search-performance-plan.md`** — цей план у репозиторії за конвенцією
  проекту (як `Docs/local-transport-*-plan.md`), з чеклістом комітів.

### Фаза 1 — Фронт: один пошук = мінімум запитів (без зміни бекенд-контрактів)
Файли: `MizhgorodskiPage.tsx`, `src/api/client.ts`, новий `src/api/catalogCache.ts`.

- **1.1** Оголошення через існуючий `GET /viber-listings/search?fromCode&toCode&date` замість
  `getViberListings(true)` + клієнтської фільтрації. `listingMatchesCities` лишається для
  тестів/фолбеку, але з гарячого шляху йде.
- **1.2** `date` у `GET /schedules` (сервер вже фільтрує `activeWeekdays`).
- **1.3** Кеш каталогів на рівні модуля (за зразком `useSiteLocalTransport.ts:12-35`):
  `trip-points`, `trip-routes`, `od-pairs` — завантажити раз, TTL ~5 хв, dedupe inflight.
  Прибрати повторні `getTripRoutes()`/`getTripPoints()` з `loadResults`.
- **1.4** Прибрати дубль availability: залишити один шлях (ефект `[schedules, date]`),
  видалити блок 267-281; `BusBookingModal` отримує availability пропсом.
- **1.5** AbortController + request-id guard у `loadResults` (стара відповідь не перезаписує нову).
- **1.6** Видалити мертві `pages/BookingPage`, `pages/PoputkyPage` (єдині споживачі
  застарілих шляхів). Оновити e2e-моки (`e2e/booking.spec.ts`), якщо вони чекають старі URL.
- Перевірка: кількість запитів на пошук з ~4+2N до 2+N (Network tab), e2e зелені.

### Фаза 2 — Бекенд: один ендпоінт пошуку + кеш каталогів + індекси
Мета: пошук з браузера = **1 HTTP-запит**, на бекенді = **1–2 SQL-запити**.

- **2.1 Міграція індексів** (`prisma migrate`): на `ViberListing`
  `@@index([isActive, date, listingType])` (покриває матчинг, cleanup, allrides, search),
  `@@index([personId])`, `@@index([phone])`. На `RideShareRequest`
  `@@index([driverListingId, status])`, `@@index([passengerListingId, status])`.
  На `Person` — `@@index([telegramUserId])`, `@@index([telegramChatId])`.
  Дешево, без зміни коду.
- **2.1b Прибрати unbounded-скани `Booking`** у `getChatIdByPhone`/`getNameByPhone`:
  індекс `Booking.phone` + `findFirst` по нормалізованому телефону (або backfill
  `Person.telegramChatId` з `Booking` одноразовим скриптом і прибрати fallback).
- **2.2 Модуль `backend/src/catalog-cache.ts`**: in-memory снапшот `TripPoint` +
  `TripRoute` + `TripRouteStop` (упорядковані `pointId` по маршруту), TTL 60 с + інвалідaція
  з адмін-роутів `trip-points`/`trip-routes` на запис. Функції `getPointByCode`,
  `getItinerary(tripRouteId)`, `tripRouteIdsAlong(fromId,toId)`. Замінити всі
  `tripPoint.findMany()`/`tripRoute.findMany({include: stops})` у `poputky-od.ts`,
  `viber-listing-merge.ts`, `viber-listings.ts:/search`, `schedules-bookings.ts:/schedules`,
  `telegram.ts:loadItineraryPointIds`. Тестується через існуючий DI (`createApp({prisma})`,
  `setTelegramPrismaForTests`).
- **2.3 Публічний DTO оголошення** `toPublicListing()` — без `phone`, `rawMessage`,
  `authorNotifiedAt`, `personId`. Використати в `/viber-listings/search` і
  `/viber-listings` (адмінка має свій auth і повний рядок). Оновити `frontend/src/types`.
- **2.4 `GET /poputky/search?from&to&date`** (у `routes/poputky.ts`): повертає
  `{ listings, schedules, availability }` за один запит; всередині — одна вибірка листингів
  за індексом `(isActive, date, listingType)` + `OR` по OD/`tripRouteId in (...)` з кешу,
  одна вибірка `Schedule` з мінімальним `select`, availability одним `groupBy` по bookings.
  `Cache-Control: public, max-age=20` (+ `ETag`) — CDN/браузер гасять повторні кліки
  «Оновити» і однакові пошуки різних користувачів.
- **2.5** Фронт переходить на `/poputky/search` (замість 1.1+1.2+availability). Каталоги з 1.3 лишаються
  для форми.
- Перевірка: `http-response-time` по `/poputky/search` p50 < 100 мс у EU-регіоні; supertest-тест
  на форму відповіді; e2e.

**Примітка до 2.1.** `prisma migrate dev` виявив дрейф історії міграцій: схема не має DB-default
на `updatedAt` у `LunchDish`, `LunchSettings`, `NotificationSettings`, `TripPoint`, `TripRoute`,
а в БД він є. Згенеровані `ALTER TABLE … DROP DEFAULT` з міграції індексів вирізано (не її
справа); окрема міграція-«вирівнювання» — на розсуд, поки шкоди немає.

### Фаза 3 — Сховище: життєвий цикл оголошення (щоб таблиця не росла безкінечно і не сканувалась)
- **3.1 Колонка `endsAt DateTime`** (обчислюється у `createOrMergeViberListing`/PUT з
  `getViberListingEndDateTime`; backfill у міграції). `cleanup-old` стає одним
  `updateMany({ where: { isActive: true, endsAt: { lt: cutoff } } })`. Індекс `[isActive, endsAt]`.
  Узгодити константу (код 1 год vs docs 3 год) у `RAILWAY_CRON_REMINDERS.md`.
- **3.2 Партиціювання «гаряче/холодне» без зміни схеми**: partial index
  `WHERE "isActive"` (через `prisma migrate` + raw SQL у міграції) — усі публічні/бот-запити
  читають лише активний хвіст, скільки б історії не накопичилось.
- **3.3 Архів**: щомісячний job (той самий cron-job.org → `POST /admin/viber-listings/archive`)
  переносить `isActive=false AND date < now-90d` у `ViberListingArchive` (аналітика
  `ViberRideEvent` вже є окремою таблицею — узгодити, що саме лишається джерелом для
  `/admin/viber-analytics`). Прибирання протермінованих `RideShareRequest`.
- **3.4 Завершити перехід на OD-identity**: після перевірки з `gold-route-model-smoke.md`
  (`tripRouteId IS NULL` = 0, `fromPointId IS NULL` = 0) зробити `fromPointId/toPointId`
  NOT NULL і прибрати `OR route = ...` з гарячих запитів (`buildOdMatchWhere`, `/search`,
  мерж). `route` лишається як snapshot для відображення.

### Фаза 4 — Матчинг («перетини»): звуження кандидатів у SQL + надійна черга сповіщень
- **4.1 Спільний модуль `backend/src/poputky-match.ts`**: одна функція
  `findMatchCandidates(prisma, listing)` — SQL по індексу `(isActive, date, listingType)` +
  `fromPointId/toPointId` + `tripRouteId in tripRouteIdsAlong(...)` з кешу (Фаза 2.2);
  класифікація часу лишається в JS (`resolveMatchType`). Використати в
  `notifyMatching*`, `/checkclients`, `/mydriverrides`, `/mypassengerrides` (зараз три різні
  реалізації, дві з яких без along-route).
- **4.2 Фікс TZ**: одна утиліта «локальна доба Києва» (`Europe/Kyiv`) для мержа, матчингу і
  пошуку (зараз три різні означення доби); тест на межі доби (`Docs/На будущее.md` §2.5).
  Разом з цим — виправити along-route гілку `/search` (перевіряти OD самого оголошення
  через `classifyPoputkyRouteMatch`, а не лише належність до маршруту).
- **4.3 Черга сповіщень у БД**: таблиця `NotificationJob { kind, payload Json, status,
  attempts, runAfter, lockedAt }`; `notifyMatching*` лише кладе job; воркер (`setInterval`
  у `index.ts`, single-flight, як лунч-лістенер) забирає пачками й виконує з існуючим
  `sleepTelethonBatchDelay`. Ефект: ingest-відповідь не чекає на Telegram/SMS; рестарт не
  губить розсилку; `/checkclients` стає ідемпотентним (пари вже є в `ViberMatchPairNotification`).
- Перевірка: `telegram-match-names.test.ts`, `sms-fallback-match.test.ts` + нові юніт-тести
  на `findMatchCandidates` (exact / along_route / інша дата / інший напрямок).

**Що змінилося у Фазах 3–4 проти плану.**
- `endsAt` рахується у мержі/PUT/PATCH; backfill у міграції припускає TZ=UTC на сервері (як на Railway).
- Матчинг: `poputky-match.ts` будує `where` з OD-пар підвідрізків маршруту водія (для пасажирів)
  або `tripRouteId in routeIdsAlong` (для водіїв) + legacy `route`; класифікація часу лишилась у JS.
  `/allrides`, `/mydriverrides`, `/mypassengerrides` тепер передають точки й маршрут (along-route
  працює і там). `/checkclients` не чіпали (адмінський, рідкий).
- Єдина доба: `trip-day.ts` (локальна доба процесу) у пошуку, мержі, дедупі, матчингу, `/checkclients`.
- Черга: `NotificationJob` + воркер (`notification-queue.ts`, `listing-match-jobs.ts`), тік кожні 10 с,
  5 спроб з бекофом 1→2→4→8 хв, «завислі» running після 15 хв забираються знову. Продюсери:
  POST/bulk/PUT `/viber-listings`, PATCH by-user, імпорт Telegram-груп, бот (`/adddriverride`,
  `/addpassengerride`, `/addviber`, `/addtelegram`). Вимкнути воркер: `NOTIFICATION_WORKER_DISABLED=1`.
- Ідемпотентність ingest (5.1) і Telethon-lookup у job (5.2) — ще не зроблено.

### Фаза 5 — Ingest: швидкий і ідемпотентний прийом
- **5.1 Ідемпотентний ключ**: `sourceHash` (sha256 нормалізованого `rawMessage` + source)
  з `@unique` — повторний POST від парсера після retry = 200 з тим самим id, без мерж-евристики.
- **5.2 Прибрати spawn Telethon з шляху запиту**: `resolveNameByPhoneFromTelegram` → job у
  черзі (4.3), який доповнює `senderName` пізніше. `POST /viber-listings` = parse + merge +
  enqueue, відповідь < 100 мс.
- **5.3 Парсер**: збирати повідомлення за тик і слати `POST /viber-listings/bulk`
  (ендпоінт існує), поллінг 2–3 с лишити. `db_parser_state.json` — прибрати сміттєві ключі
  (`::1: 439`, старий шлях `/Users/merenkoff`).
- **5.4 Імпорт Telegram-груп** (`fetchTelegramGroupMessages`) — той самий bulk-шлях + черга.

### Фаза 6 — Бот на тому самому сервісі пошуку
- `/allrides`, inline (`inline-listings.ts`), `/mydriverrides`, `/mypassengerrides` →
  `searchListings()` з Фази 2 з фільтром `personId` у SQL (замість завантаження всього
  типу і фільтру по телефону в JS).
- Один DTO/формат для сайту й бота (зменшує дублікати в `telegram.ts`).

### Фаза 7 (умовно, коли з'явиться потреба)
Тригери: >~5 000 активних оголошень або >~10 міст-хабів.
- Denormalised таблиця `ListingSearchIndex (listingId, dayKey, fromId, toId, corridorId,
  startMin, endMin)` заповнюється в мержі → пошук і матчинг = один range-запит по
  `(dayKey, corridorId, startMin)`. Це дешевша альтернатива full-text/ES і природно виростає
  з Фази 2.2 + 4.1.
- Замість in-memory кешу — той самий, але з `LISTEN/NOTIFY` інвалідaцією, якщо реплік стане >1.

## Порядок і дроблення
Фази 0→1→2 — критичний шлях для «швидко на головній» (0 — година налаштувань, 1 — один PR,
2 — 2–3 PR). Фази 3–5 незалежні між собою й можуть іти паралельно після 2.2 (кеш каталогів)
і 2.1 (індекси). Фаза 6 — після 2 і 4.1. Кожна фаза — окремий чекліст комітів у
`Docs/poputky-search-performance-plan.md`; правило проекту: після змін у `backend/src` —
`npm run build` і коміт `dist/` разом.

## Верифікація
- До/після кожної фази: Railway `http-response-time` по `/viber-listings`, `/poputky/search`,
  `/schedules`, `/trip-routes` (p50/p90 за 24 год) + лог таймінгів з 0.3.
- Локально: `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e`; для міграцій —
  `npm run db:reset && npm run prisma:migrate` і `test:integration-db`.
- Ручний smoke: `Docs/gold-route-model-smoke.md`, `Docs/poputky-od-city-scale-smoke.md`
  (along-route пари, `/od-pairs`), бот `/checkclients` на тестовій парі.
- Кількість запитів на один пошук у Network-панелі: ціль — 1 (`/poputky/search`) + кешовані каталоги.

## Рішення, які потрібні від власника
1. Перенос бекенду і фронту в `europe-west4` (Фаза 0.1) — коротка недоступність при редеплої.
2. Термін архіву (Фаза 3.3): 90 днів у гарячій таблиці — ок?
3. Чи лишати `GET /viber-listings` публічним з телефонами до Фази 2.3 (пропозиція: ні, прибрати
   `phone`/`rawMessage` уже в Фазі 1 як мінімальний патч серіалізатора для не-адмінських запитів).
