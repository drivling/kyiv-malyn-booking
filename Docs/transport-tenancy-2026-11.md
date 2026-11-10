# Транспорт кількох міст в одній базі (tenancy) — під-план фаз 3–4

**Status:** M1 (фаза 3) ✅ у PR · M2 (фаза 4) ⬜  
**Де зупинились:** M1 — колонка `cityCode`, код зі scope міста, `?city=`, серверний гейт — гілка `merenkoff/dreamy-dijkstra-1k3yl4`; після злиття й деплою M1 має відстоятись на проді, далі M2 (зміна ключів)  
**Created:** 2026-11-10 · частина [`korosten-transport-2026-11.md`](korosten-transport-2026-11.md) (фази 3 і 4)

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту.

## Навіщо

Щоб покласти в базу транспорт Коростеня поруч із малинським. До M1 транспорт був однотенантний:
`PUT /transport/dataset` стирав усі таблиці без фільтра, читання брало все підряд, `TransportMeta` — один рядок
`id = 1`. Вимога до обох кроків: **для Малина нічого не змінюється ні на байт**.

## Рішення

- **Місто — колонка `cityCode`** (`TripPoint.code`: `Malyn`, `Korosten`) на 11 таблицях: `TransportStop`, `Route`,
  `RouteStop`, `Trip`, `Segment`, `Meta`, `Revision`, `StickerScan`, `StickerReturn`, `StickerPrint`,
  `TransportArrivalReport`. Default — `'Malyn'`.
- **Два кроки.** M1 лише додає колонку й проводить місто через код; первинні ключі ті самі. M2 міняє ключі на
  `(cityCode, id)` — тільки після цього в базі можуть лежати два маршрути «№1».
- **`?city=<код>`** на наявних шляхах (у тілі — поле `city` для трьох публічних POST). Без параметра — Малин.
  Відомі міста — активні сайти з `backend/src/site-domains.ts`; невідоме → 404.
- **Гейт на сервері** (`resolveTransportCity`, `backend/src/transport-city.ts`): місто, де
  `TripPoint.hasLocalTransport = false`, публічно відповідає 404; адмін (той самий токен) бачить його з
  `Cache-Control: private, no-store`. Чернетку Коростеня не можна підглянути, знаючи параметр.
- **Поки M2 не зроблено:** запис датасету не-Малина → 409 `city_writes_disabled` (`PUT /transport/dataset`,
  `PUT /admin/transport/stop-redirects`, `POST /admin/transport/recalculate-segments`).
- **Відкриті дані іншого міста** (GTFS, RSS, журнал ревізій, календар) → 404 до окремої фази; кеші лишаються одні.
- `TransportMeta` шукається за `cityCode` (унікальний індекс), а не за `id = 1`.

## Як перевірено (M1)

| Перевірка | Що доводить |
|---|---|
| `transport-golden.test.ts` + `fixtures/transport-golden.json` | sha256 тринадцяти публічних відповідей на справжньому датасеті Малина зняті **до** змін (перший коміт гілки) і не змінились після |
| `transport-tenancy.test.ts` на `transport-test-store.ts` | кожен виклик Prisma до 11 таблиць несе `cityCode` (журнал викликів); рядки Коростеня не видно в Малині й вони переживають `PUT` Малина; гейт, 409, 404 |
| Мутаційна проба | прибраний `where` в одному `findMany` валить три тести |
| Репетиція на Postgres 16 | база наповнена кодом `main` → знято відповіді → міграція → нова збірка: усі відповіді Малина й заголовки (`ETag`, `Last-Modified`) побайтно ті самі, включно з `gtfs.zip` і адмінською статистикою; стара збірка на мігрованій базі — теж (відкат безпечний); `revision` міграцією не змінена |
| `transport-tenancy.integration.test.ts` | те саме на справжній базі через Prisma: default колонки, scope, заміна датасету Малина не чіпає інше місто |

Тестове сховище `transport-test-store.ts` чесно застосовує `where` — на відміну від старих ручних заглушок, які
аргументи ігнорували (заглушка мети в `transport-http.test.ts` проходила випадково: `undefined === undefined`).
Нові тести транспорту писати на ньому.

## Чекліст

M1 — фаза 3

- [x] **3.1** Golden-тест і тестове сховище на коді до змін
- [x] **3.2** Міграція `20261110090000_transport_city_code`: колонка на 11 таблицях, індекси, унікальний `TransportMeta.cityCode`
- [x] **3.3** Scope міста: `local-transport.ts`, `transport-revisions.ts`, `transport-segments.ts`, `sticker-scans.ts`,
  `sticker-wall.ts`, `arrival-reports.ts`, `gtfs-feed.ts`, seed (`--if-empty` рахує лише Малин)
- [x] **3.4** `transport-city.ts`, `?city=` у `routes/transport.ts`, гейт, 409 на запис, 404 на відкриті дані
- [x] **3.5** `openapi/public.yaml` (параметр `City`), `backend/dist`, інтеграційний тест на Postgres
- [ ] **3.6** Деплой за розділом «Деплой M1» (власник)

M2 — фаза 4 (окремий PR після того, як M1 попрацює на проді)

- [ ] **4.1** SQL: первинні ключі `TransportStop/Route/Trip` → `(cityCode, id)`; унікальні індекси `RouteStop`,
  `Segment` і зовнішні ключі — з `cityCode`; `TransportMeta.id` — послідовність замість default 1;
  `TransportRevision` — ключ `(cityCode, revision)`. Одна транзакція, таблиці малі.
- [ ] **4.2** `schema.prisma` зі складеними ключами; `findUnique` → складені `where` (`cityCode_id`);
  зняти 409 на запис не-Малина; `recalculate` і редиректи для міста
- [ ] **4.3** Ті самі golden + репетиція на дампі проду (не на seed); тест «два міста з однаковими id»
- [ ] **4.4** Деплой: `pg_dump` до, звірка відповідей після; у базі на цей момент нема рядків Коростеня

## Деплой M1

Міграція лише додає колонки з default — виконується миттєво, `TransportMeta.updatedAt` не чіпає.

1. До злиття зберегти відповіді проду (адреса бекенда — у `frontend/scripts/api-base.mjs`):

   ```bash
   curl -s https://malin.kiev.ua/transport/dataset -L -o dataset-before.json
   ```

   ```bash
   curl -s https://malin.kiev.ua/transport/gtfs.zip -L -o gtfs-before.zip
   ```

2. Злити PR — Railway накотить міграцію при старті (`prisma migrate deploy`).
3. Після деплою зняти ті самі два файли як `…-after` і порівняти:

   ```bash
   cmp dataset-before.json dataset-after.json && cmp gtfs-before.zip gtfs-after.zip && echo identical
   ```

   Якщо між знімками хтось зберігав розклад в адмінці, `revision` буде іншою — тоді порівнювати не варто,
   досить перевірити, що сайт і адмінка працюють.
4. В адмінці відкрити «Графік транспорту», змінити й зберегти будь-що дрібне — без помилки 409.

## Відкат

- **M1:** повернути попередній деплой у Railway. Старий код колонку не бачить і пише рядки з default `Malyn`
  (перевірено репетицією). Міграцію не відкочувати.
- **Після M2 і появи рядків Коростеня:** відкат на код до tenancy — **спершу** експорт
  `GET /transport/dataset?city=Korosten` (адмін) і `DELETE … WHERE "cityCode" = 'Korosten'` у всіх 11 таблицях,
  інакше старий `PUT` Малина зітре обидва міста, а `GET` їх змішає.

## Пастки

- Будь-який новий запит до цих 11 таблиць — з `cityCode`; `transport-tenancy.test.ts` валиться, якщо новий
  ендпоінт цього не робить (додати його виклик у тест «кожен запит… несе cityCode»).
- `siteForCityCode()` для перевірки міста не годиться — мовчки повертає головний сайт; тільки `parseTransportCity`.
- Шлях без `city` не звертається до каталогу `TripPoint`: Малин має працювати, навіть якщо каталог недоступний.
- `prisma format` переформатовує весь `schema.prisma` (сотні рядків diff) — не запускати.
- `prisma migrate diff` показує стару розбіжність `TripRoute.updatedAt` (default) між міграціями і схемою — вона
  була до цієї роботи й транспорту не стосується.
- Фронтенд місто ще не передає (фаза 5): усе, що він робить, — Малин.
