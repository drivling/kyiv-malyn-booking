# Журнал ревізій розкладу міського транспорту Малина: таблиця `TransportRevision`, diff у RSS, `GET /transport/revisions`

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ✅ · Фаза 3 ✅ · Фаза 4 ✅  
**Де зупинились:** код, міграція, тести й docs закомічені — далі PR (compare-посилання), деплой бекенду (міграція
`20261018150000_transport_revision` застосовується `npm start`), перший рядок журналу з'явиться при старті сам  
**Created:** 2026-10-18 · **Гілка:** `transport-revisions` (від `main` після #91 «Transport open protocols»)

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт. Це продовження **етапу 4** «Відкриті протоколи»
([`transport-open-protocols-2026-10.md`](transport-open-protocols-2026-10.md), «Що далі», пункт 1): там RSS мав один
запис про поточну `revision`, бо історії ревізій у БД не було. Сторінка для людей —
[`transport-open-data.md`](transport-open-data.md).

## Що не так сьогодні (перевірено 2026-10-18)

- Єдина пам'ять про зміни розкладу — `TransportMeta.updatedAt`. Коли редактор зберігає датасет, попередній стан
  зникає: ні ми, ні підписник RSS не можуть сказати, **що** змінилось — лише що щось змінилось о такій-то годині.
- RSS (`GET /transport/changes.rss`) тому має один запис, і читач, який не завантажив фід між двома правками,
  бачить лише останню. Застосункам, що беруть GTFS, нема як дізнатися, чи варто перезавантажувати фід (один рейс
  зсунуто на 5 хвилин чи додано маршрут).
- Три шляхи запису бампають `revision`: `PUT /transport/dataset` (редактор), `POST /admin/transport/recalculate-segments`
  («Перерахувати час») і `PUT /admin/transport/stop-redirects` — плюс seed при порожній БД. Усі мають лишати слід.

## Рішення

### Фаза 1 — модель і міграція

`TransportRevision { revision String @id; createdAt; source String; stats Json; diff Json? }` — `revision` = ISO
`TransportMeta.updatedAt` **після** запису, та сама, що в `GET /transport/dataset`, `feed_version` і `ETag`, тож рядок
журналу й кеш фіду говорять однією мовою. Без FK на транспортні таблиці (датасет замінюється цілком; історія має
пережити видалення зупинки). `source` — не з ТЗ, але коштує одну колонку і потрібен для людського підсумку, коли
diff порожній («Перераховано час у дорозі…», а не «технічне оновлення»). `stats` — рівно `GtfsFeedStats` з
`buildGtfsFeed(...).stats`, щоб не вигадувати другого набору лічильників. Індекс за `createdAt`; сортуємо за
`revision desc` (ISO-рядок сортується як час).

### Фаза 2 — чистий diff і запис

`backend/src/transport-revisions.ts`:
- `diffTransportDatasets(prev, next)` — чиста функція: зупинки додані / перейменовані / зняті (за id), маршрути
  додані / зняті (з `no` = `shortName || id` і «звідки — куди»), рейси додані / зняті / **зсунуті** (той самий
  `trip_id`, інший `departureTime`; `07:00:00` і `07:00` — один час), кількість перегонів зі зміненим часом у дорозі
  (ключ `routeId|from|to`, разом із новими й зниклими — інакше «Перерахувати час» не лишав би сліду), редиректи
  зупинок через `stopRedirectsOf` (ціль змінилась = знято + додано).
- `describeTransportDiff` → підсумок українською, ≤ 6 позицій на категорію, далі «та ще N»;
  `describeTransportRevision` вирішує, що писати без diff (`initial` / `seed`) і при порожньому diff — за `source`.
- `snapshotTransportDataset(prisma)` **до** запису і `recordTransportRevision(prisma, { source, previous })` після.
  Запис — `upsert` без `update`, тож повторний виклик для тієї самої revision нічого не ламає; `previous.revision ===
  current.revision` → пропуск. Усе в `try/catch` з `console.error`: журнал ніколи не блокує збереження розкладу
  (стара БД без міграції, збій БД — редактор усе одно отримує 200).
- `ensureInitialTransportRevision` у `index.ts` при старті: таблиця порожня, датасет є → перший рядок `initial` без
  diff. Seed (`seed-local-transport.ts`) пише `seed` (при порожній БД — без diff, при повторному seed — з diff).
- Чому запис у роутері, а не всередині `replaceTransportDataset`: diff потрібен проти стану **до** транзакції, а
  `recalculateSegmentDurations` і редиректи пишуть повз `replaceTransportDataset`; один шаблон «знімок → запис →
  рядок» у трьох хендлерах читається краще, ніж прихований побічний ефект у функції, яку кличуть і тести, і seed.

### Фаза 3 — читачі: RSS і JSON

- `GET /transport/revisions` → `{ revisions: [...] }`, новіші першими, `?limit=` 1…200 (типово 50), кожен рядок із
  `summary`. Порожній журнал — `200 { revisions: [] }` (застосунку зручніше, ніж 404), ETag = найновіша revision у
  відповіді, інакше лише `Cache-Control`.
- `GET /transport/changes.rss` — `buildChangesRss(feed, { revisions })`: запис на рядок (`guid` =
  `malyn-transport-revision:<revision>`, заголовок «Розклад оновлено 14.10.2026 о 13:17» за Києвом, опис = `summary` +
  лічильники + revision; посилання на GTFS/JSON/журнал — лише в найновішому). Порожній журнал → старий єдиний запис
  із фіду (БД до міграції). Тіло кешується в пам'яті роутера на revision (`rssCache`), поруч із кешем GTFS.
- OpenAPI: шлях `/transport/revisions`, схеми `TransportRevision`, `TransportRevisionDiff`, `Revision*Ref`;
  `PUBLIC_ENDPOINTS` в `openapi.test.ts`.

### Фаза 4 — docs

`transport-open-data.md` (рядок таблиці про RSS переписано, рядок про журнал JSON додано, пункт «чого поки нема»
про журнал знято), `transport-open-protocols-2026-10.md` («Що далі» → посилання сюди), абзац у `CLAUDE.md`,
`/support/api` згадує `/transport/revisions`.

## Чекліст

Фаза 0 — файл відновлення
- [x] **0.1** Цей файл

Фаза 1 — модель
- [x] **1.1** `TransportRevision` у `schema.prisma` + міграція `20261018150000_transport_revision`; `prisma generate`

Фаза 2 — diff і запис
- [x] **2.1** `transport-revisions.ts`: diff, підсумок, `snapshot` / `record` / `ensureInitial` / `list`, тести
  (`transport-revisions.test.ts`, 9)
- [x] **2.2** `routes/transport.ts`: три хендлери пишуть рядок; `seed-local-transport.ts`; `index.ts`

Фаза 3 — читачі
- [x] **3.1** `buildChangesRss(feed, { revisions })` + тест у `transport-feeds.test.ts`; `GET /transport/revisions`
- [x] **3.2** `openapi/public.yaml` + `PUBLIC_ENDPOINTS`; HTTP-тести в `transport-http.test.ts` (стаб отримав
  `transportRevision`, `@updatedAt` у стабі тепер бампається на upsert — як у Postgres)

Фаза 4 — docs
- [x] **4.1** `transport-open-data.md`, `transport-open-protocols-2026-10.md`, `CLAUDE.md`, `/support/api`

Фінал
- [x] **F.1** `npm test` (обидва пакети), `npm run lint`, `npm run typecheck`; `backend/dist` = `src`
- [ ] **F.2** push, compare-посилання; після деплою — перевірити `GET /transport/revisions` на проді (один рядок
  `initial`), потім зберегти щось в адмінці й подивитись RSS

## Пастки

1. `stats.stops` рахує лише зупинки, що є на маршрутах (як GTFS): нова зупинка без маршруту видна в `diff.stops.added`,
   але не в лічильнику — це не баг.
2. Стаб Prisma в `transport-http.test.ts` раніше не бампав `updatedAt` на `upsert` — тест «200 with the new revision»
   насправді перевіряв, що revision **не** змінилась. Тепер стаб тягне час уперед на ≥ 1 мс, бо два записи за один тест
   лягають в одну мілісекунду, а `revision` — первинний ключ журналу.
3. `prisma.transportRevision.upsert` із `diff: undefined` у `create` — Prisma пише NULL; стаб має робити так само
   (`create.diff ?? null`), інакше `{ diff: null, ...create }` дає `undefined`.
4. `recordTransportRevision` читає весь датасет ще раз після запису (`loadTransportDataset`) — це дешево (~150 КБ з
   БД) і гарантує, що revision у рядку = та, яку щойно виставив `@updatedAt`, а не та, що була б розрахована в коді.
5. На БД до міграції всі три хендлери логують `relation "TransportRevision" does not exist` і відповідають 200 —
   журнал не блокує роботу; RSS віддає один запис із фіду, `/transport/revisions` — 500 (прочитати таблицю не може).

## Знахідки

### Фази 1–4 (зроблено, 2026-10-18)

- Гілка починалась від `transport-open-protocols` (PR #91 ще не було злито на момент старту: `buildChangesRss` і
  `openapi/public.yaml` існували лише там); #91 злили під час роботи, тож перед пушем — `git rebase --onto origin/main
  origin/transport-open-protocols` (squash-merge, без конфліктів).
- `plural()` переїхав із `transport-feeds.ts` у `transport-revisions.ts` (обом потрібен), `kyivDate` віддає ще й
  `time` (`hh` береться `% 24`, бо `en-GB` з `hour12: false` друкує «24» для півночі).
- Перевірка: backend 73 файли / 629 тестів, frontend без змін у тестах (правка тексту `/support/api` і коментаря);
  `tsc` обох пакетів чистий; `backend/dist` перезібрано.
