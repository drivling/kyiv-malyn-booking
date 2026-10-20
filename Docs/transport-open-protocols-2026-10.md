# Відкриті протоколи: GTFS у каталогах, OpenAPI, стабільні id, RSS та iCal транспорту Малина

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ✅ · Фаза 3 ✅ · Фаза 4 ✅ (4.4 — лише план)  
**Де зупинились:** етап злито (#91), таблиця ревізій — #92; фід у Mobility Database (#1751 злито, id 3615), Transitland #2260 чекає на мердж; далі лише «Що далі»  
**Created:** 2026-10-18 · **Гілка:** `transport-open-protocols` (від `main` після #90)

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт. Це **етап 4** великого плану «malin.kiev.ua за маніфестом own-net» — таблиця етапів і
рішення власника в [`Docs/transport-pwa-2026-10.md`](transport-pwa-2026-10.md); етапи 1–3 злиті й задеплоєні
(#82–#90): [`transport-offline-writes-2026-10.md`](transport-offline-writes-2026-10.md),
[`transport-open-data-2026-10.md`](transport-open-data-2026-10.md). Сторінка для людей —
[`transport-open-data.md`](transport-open-data.md).

## Що не так сьогодні (перевірено 2026-10-18)

Принципи П3 (відкриті стандарти), П6 (інтероперабельність) і П9 (протоколи замість платформ): дані транспорту
мають бути доступні **іншим застосункам без нас** — не лише «можна завантажити», а «можна знайти, описано
машинно, можна покластися на адреси й id».

- GTFS є (`GET /transport/gtfs.zip`, етап 3), але його ніхто не знайде: фіду немає ні в Mobility Database, ні в
  Transitland — саме звідти його беруть OpenTripPlanner-інстанси, Transitous, дослідники. Адреса фіду — домен
  Railway (`kyiv-malyn-booking-production.up.railway.app`), який зміниться разом із хостингом; на
  malin.kiev.ua `/transport/gtfs.zip` віддає SPA-оболонку.
- Публічні ендпоінти бекенду (`/transport/dataset`, `/trip-points`, `/viber-listings`, `/search`, `/health`,
  три публічні POST табло) ніде не описані машинно — стороння людина читає `create-app.ts`.
- Ідентифікатори `st_NNNN` і номери маршрутів де-факто стабільні, але це ніде не обіцяно, і для злитої чи
  перейменованої зупинки немає жодного механізму «старий id → новий»: адреса `/transport/stop/st_0042` після
  злиття мовчки показує порожнє табло, а споживач GTFS бачить зниклий `stop_id`.
- Про зміну розкладу можна дізнатися лише умовним GET на zip (`ETag`); підписатися (RSS) або покласти рейси
  маршруту собі в календар (iCal) не можна.

## Рішення

### Фаза 1 — каталоги GTFS і валідатор

**Канонічна адреса фіду — на нашому домені.** `https://malin.kiev.ua/transport/gtfs.zip` стає адресою, яку
ми реєструємо в каталогах і друкуємо в документах; `serve-dist.mjs` відповідає на неї **302** на бекенд
(`API_BASE` з `scripts/api-base.mjs` — та сама константа, що й у пререндера), так само для
`/transport/gtfs/<file>.txt` і `/openapi.yaml` (фаза 2). Чому 302, а не 301: домен бекенду зміниться
(планований окремий API-домен), і клієнти не мають запам'ятати сьогоднішню ціль назавжди. Чому не проксі:
serve-dist — статичний хост без залежностей, а zip і так віддається з кешем 5 хв і `ETag` на бекенді; проксі
подвоїв би трафік через Railway і нічого не додав. Заголовки редиректу — `NO_CACHE_HEADERS`
(`Cache-Control: no-cache` + `CDN-Cache-Control: no-store`), бо `.zip` і `.txt` входять у перелік розширень,
які Cloudflare кешує за замовчуванням, і 302 міг би застрягти на edge.

**PWA-правила кешу не порушуються.** Service worker (`sw/transport-sw.js`) перехоплює під `/transport` лише
навігації без крапки в останньому сегменті (`isTransportPage`) та адреси з precache; `/transport/gtfs.zip` —
не навігація і не в precache → іде повз воркер у мережу. Пастка 2 етапу 1 («крапка в останньому сегменті»)
працює на нас. `cacheControlFor` редиректу не стосується (він не файл у `dist/`).

**Валідатор.** MobilityData `gtfs-validator` 8.0.1 (jar, Java 17; у репо Java немає — JRE Temurin
розпаковано в scratchpad, як запустити — в «Знахідках» і в `transport-open-data.md`). Результат на фіді проду
2026-10-18 (`feed_version 2026-10-14T13:17:49.327Z`): **0 помилок**, 1 попередження
`mixed_case_recommended_field` ×6 (`14 ОМБ`, `10 ОГШБ`, `ЗОШ` — справжні абревіатури, не виправляємо),
2 info: `trip_headsign_matches_intermediate_stop` ×3 (дані: рейси `2-32`, `7-12` і ще один мають headsign
«маркет "Соборний"», хоча ця зупинка проміжна — перевірити власнику в адмінці) і `unknown_file LICENSE.txt`
(свідоме рішення етапу 3). Що робимо в коді: додаємо стандартний `attributions.txt`
(`organization_name`, `is_producer=1`, `attribution_url`, `attribution_email`) — валідатор його знає, а
споживачі (OTP, Transitland) показують атрибуцію з нього; `LICENSE.txt` лишається.

**Каталоги** — файли готуємо ми, PR у чужі репозиторії робить власник (його GitHub-акаунт, його підпис під
ліцензією фіду):

| каталог | що готуємо | куди |
|---|---|---|
| Mobility Database | `Docs/open-protocols/mobility-database/ua-malyn-malin-kiev-ua-gtfs.json` (без `mdb_source_id` — його дає `tools.operations.add_gtfs_schedule_source` або команда MobilityData) + текст PR | PR у `MobilityData/mobility-database-catalogs` з `[SOURCES]` у заголовку **або** форма <https://mobilitydatabase.org/contribute> (без GitHub) — обираємо форму як перший крок, PR — якщо форма не відповість за 2 тижні |
| Transitland | `Docs/open-protocols/transitland/malin.kiev.ua.dmfr.json` (DMFR 0.5.1: `f-u8x8-malyn~city~transport`, оператор `o-u8x8-malyn~city~transport`) + текст PR | PR у `transitland/transitland-atlas`, файл `feeds/malin.kiev.ua.dmfr.json` (ім'я = домен фіду); CI валідує схему |

Ліцензія в каталогах — поле `license` = `https://own-net.com/license.html` (OwnNet Source License 1.1, рішення
власника з етапу 3); у DMFR немає SPDX-ідентифікатора для неї, тож `license.url` + прапорці
(`use_without_attribution: no`, `create_derived_product: yes`, `redistribution_allowed: yes`,
`share_alike_optional: no`, `commercial_use_allowed: unknown` — дозволено до порога доходу, а трьох станів
бракує) і `attribution_text`. Ризик, прийнятий власником: споживачі, що фільтрують за «вільними» ліцензіями,
фід пропустять.

### Фаза 2 — OpenAPI 3.1

`backend/openapi/public.yaml` — рукописний опис **лише публічних** ендпоінтів (без адмінки й без `/user/*`,
які чекають перевірки підпису Telegram Login): `GET /health`, `GET /transport/dataset`,
`GET /transport/gtfs.zip`, `GET /transport/gtfs/{file}`, `POST /transport/sticker-scans`,
`POST /transport/sticker-returns`, `POST /transport/arrival-reports`, `GET /trip-points`,
`GET /viber-listings`, `GET /viber-listings/{id}/contact`, `GET /viber-listings/search`,
`GET /poputky/search`; плюс ендпоінти фаз 3–4, коли з'являться. `servers` — адреса бекенду; `info.license` —
OwnNet 1.1. Роздача: `GET /openapi.yaml` у `routes/public-routes.ts` (читається з диска один раз,
`Content-Type: application/yaml`, кеш 1 год) — файл лежить у `backend/openapi/`, тож однаковий шлях
`../../openapi/public.yaml` і з `src/routes`, і з `dist/routes`. Без Swagger UI: сторінка `/support/api` на
сайті — коротко українською, що є, посилання на yaml, приклади `curl`, ліцензія. Тест
(`openapi.test.ts`, парсер — devDependency `yaml`): документ парситься, `openapi` починається з `3.1`, у кожної
операції є `responses`, кожен шлях із yaml існує серед `getRegisteredRoutes(createApp(...))` (з `{file}` →
`:file`), і навпаки — кожен публічний GET/POST бекенду з явного списку присутній у yaml, щоб новий публічний
ендпоінт не лишився неописаним.

### Фаза 3 — стабільні id як контракт

**Що обіцяємо** (розділ «Що ми обіцяємо» у `transport-open-data.md`): `stop_id` `st_NNNN` і `route_id` не
змінюються й **не перевикористовуються**; перейменування зупинки не змінює id; злиття або видалення зупинки
лишає запис у `stopRedirects` (старий id → чинний) щонайменше рік; `revision` монотонний ISO-час і той самий у
`/transport/dataset`, `feed_info.feed_version`, `ETag`; адреси `https://malin.kiev.ua/transport/gtfs.zip`,
`/transport/dataset.json`, `/openapi.yaml` стабільні; `trip_id` стабільний лише в межах однієї `revision`.

**Механізм — `meta.stopRedirects` у `TransportMeta.payload`, без міграції.** З трьох варіантів (колонка
`TransportStop.aliasOf`, таблиця `TransportStopRedirect`, ключ у JSON-меті) обрано мету: нуль міграцій, уже
їде в `GET /transport/dataset` і в знімок `dataset.json`, PUT датасету його не губить (редактори передають
`meta` з бази як є), `stopRename.ts` не зачіпає (він працює з назвами, не з id), статичні статті
`src/content/stops/<id>.ts` живуть за id і їх просто не чіпаємо (стаття злитої зупинки або переїжджає під
новий id руками, або лишається — редирект табло веде на нову). Чиста логіка в `backend/src/stop-redirects.ts`:
`parseStopRedirects(meta, stopIds)` → `Map<old, new>` (ключ `st_\d+`, не чинна зупинка; значення — чинна
зупинка; ланцюжки стискаються, цикли й самопосилання відкидаються). Валідація датасету попереджає про сміття,
але не блокує PUT.
- API: `GET /transport/stops/{id}` → `200 { id, name, lat, lng, routeIds }`; старий id → **301** на
  `/transport/stops/<new>`; невідомий → 404. `GET /transport/stop-redirects` → `{ "<old>": "<new>" }` цілком.
  Редагування — `PUT /admin/transport/stop-redirects` `{ redirects: { old: new } }` (замінює ключ у меті,
  бампає `revision`); UI в адмінці — не зараз, рецепт `curl` у документах.
- Сайт: табло `/transport/stop/<old>` → `Navigate replace` на новий id (слаг не збігся → дивимось у
  `meta.stopRedirects`); `prerender-transport-stops.mjs` пише `dist/transport/stop-redirects.json`, і
  `serve-dist.mjs` відповідає **301** на `/transport/stop/<old>` ще до SPA — для краулерів і закладок.
- GTFS: старий `stop_id` просто зникає з `stops.txt` (спец не має редиректів); споживач читає
  `/transport/stop-redirects`.

### Фаза 4 — RSS та iCal лише де є сенс

**Історії ревізій немає** — є лише `TransportMeta.updatedAt`. Тому без нових таблиць чесно можливо:
- `GET /transport/changes.rss` — RSS 2.0 з **одним** записом про поточну `revision`: заголовок «Розклад
  оновлено 14.10.2026», у тексті — скільки маршрутів, рейсів і зупинок у фіді (`GtfsFeedStats` з того самого
  кешу, що й zip — нуль додаткових запитів), посилання на схему й zip, `guid` = `revision`. Читач RSS зберігає
  прочитані записи сам, тож для **підписника** це повноцінний журнал «коли мінявся розклад»; чого немає — «що
  саме змінилось» і записів до моменту підписки. Для цього потрібна таблиця `TransportRevision(revision,
  createdAt, stats, diff)`, яку писав би `replaceTransportDataset` — описано в «Що далі», не робимо.
- `GET /transport/route/{id}/calendar.ics` — iCalendar з подією на кожен рейс маршруту: `DTSTART` у
  `TZID=Europe/Kyiv` (сьогоднішня дата + час відправлення з першої зупинки), `DTEND` — час на останній
  зупинці зі `stop_times`, `RRULE:FREQ=WEEKLY;BYDAY=…` за календарем сервісу (`everyday` / `weekdays`),
  `SUMMARY` «№5 → Залізничний вокзал», `DESCRIPTION` — зупинки з часом, `UID` = `<tripId>@malin.kiev.ua`,
  `VTIMEZONE` Europe/Kyiv (EET/EEST) усередині, бо спец вимагає. Джерело — той самий кеш GTFS. Кеш-заголовки
  як у відкритих даних (`ETag` = revision). Посилання на сайті: RSS — у блоці «Дані відкриті» на
  `/transport/scheme` і на `/support/api`; iCal — там само в описі (на сторінці маршруту не чіпаємо розмітку
  в цьому етапі).

## Чекліст

Фаза 0 — файл відновлення
- [x] **0.1** Цей файл; рядок-посилання з таблиці етапів у `Docs/transport-pwa-2026-10.md`

Фаза 1 — каталоги GTFS і валідатор
- [x] **1.1** Валідатор на фіді проду; результат і команда запуску — у «Знахідках» і в `transport-open-data.md`
- [x] **1.2** `gtfs-feed.ts`: `attributions.txt` у фіді; тест; `backend/dist` перезібрано
- [x] **1.3** `serve-dist.mjs`: 302 `/transport/gtfs.zip`, `/transport/gtfs/<file>.txt`, `/openapi.yaml` → `API_BASE`
  з `NO_CACHE_HEADERS`; чисте правило в `serve-dist-rules.mjs` + тест у `src/test/serve-dist-rules.test.ts`
- [x] **1.4** `Docs/open-protocols/`: JSON для Mobility Database, DMFR для Transitland, тексти PR/форми
  (`README.md` з кроками для власника)
- [x] **1.5** Адреси на `malin.kiev.ua` у `openData.ts` (`GTFS_FEED_URL`), `transport-open-data.md`, `llms.txt`

Фаза 2 — OpenAPI
- [x] **2.1** `backend/openapi/public.yaml` (OpenAPI 3.1, усі публічні ендпоінти, схеми відповідей)
- [x] **2.2** `GET /openapi.yaml` у `public-routes.ts`; `backend/dist`
- [x] **2.3** `openapi.test.ts`: валідність + звірка шляхів з `getRegisteredRoutes` в обидва боки (devDependency `yaml`)
- [x] **2.4** `/support/api`: тема `api` в `supportContent.ts`, стаття, `prerender-spa.mjs`, `sitemap.xml`, `llms.txt`

Фаза 3 — стабільні id
- [x] **3.1** `transport-open-data.md`: розділ «Що ми обіцяємо»
- [x] **3.2** `backend/src/stop-redirects.ts` + валідація в `validateTransportDataset`; тест
- [x] **3.3** `GET /transport/stops/:id` (200 / 301 / 404), `GET /transport/stop-redirects`,
  `PUT /admin/transport/stop-redirects`; тести; yaml; `backend/dist`
- [x] **3.4** Сайт: редирект табло, `stop-redirects.json` з пререндера, 301 у `serve-dist.mjs`; тести

Фаза 4 — RSS та iCal
- [x] **4.1** `backend/src/transport-feeds.ts`: `buildChangesRss(feed, revision)`, `buildRouteCalendar(feed, routeId)`; тести
- [x] **4.2** `GET /transport/changes.rss`, `GET /transport/route/:id/calendar.ics` у `routes/transport.ts`; yaml; `dist`
- [x] **4.3** Посилання на сайті (`/transport/scheme#open-data`, `/support/api`), `transport-open-data.md`, `llms.txt`
- [x] **4.4** «Що далі»: таблиця ревізій для справжнього журналу змін — лише план

Фінал
- [ ] **F.1** `npm test` (обидва пакети), `npm run lint`, `npm run typecheck`; `backend/dist` = `src`
- [ ] **F.2** `gh pr view` стану гілки → push, compare-посилання; список дій для власника (каталоги, headsign-рейси)

## Що далі (поза цим етапом)

- ~~**Таблиця ревізій** `TransportRevision`~~ — зроблено окремим етапом: [`transport-revisions-2026-10.md`](transport-revisions-2026-10.md)
  (`GET /transport/revisions`, RSS із підсумком diff).
- UI редиректів зупинок у редакторі карти: при видаленні зупинки — «перенести на…» → `PUT /admin/transport/stop-redirects`.
- Посилання «У календар» на сторінці маршруту (`/transport/route/:id`) на `routeCalendarUrl(id)` — не робили, щоб не
  чіпати розмітку сторінки в цьому етапі.
- GTFS-Realtime немає і не буде, поки нема даних про рух; «Факт прибуття» — не RT.

## Пастки

1. `serve-dist.mjs` відповідає на будь-який шлях SPA-оболонкою — редирект на бекенд має стояти **до**
   `tryResolve`, інакше `/transport/gtfs.zip` віддасть `index.html` як і сьогодні.
2. Cloudflare кешує відповіді за розширенням (`.zip`, `.txt`, `.ics`, `.xml`, `.yaml`?) — для редиректів
   `CDN-Cache-Control: no-store`; бекенд на Railway без Cloudflare, там достатньо `Cache-Control`.
3. `getRegisteredRoutes` повертає Express-шляхи з `:param` і без методу у верхньому регістрі для роутерів,
   змонтованих із префіксом (`/poputky` + `/search`) — тест звірки має нормалізувати обидві сторони.
4. `meta` у PUT — це те, що редактор отримав у GET; скриптовий PUT без `stopRedirects` у `meta` їх **зітре**.
   Тому `PUT /admin/transport/stop-redirects` — окремий ендпоінт, і це задокументовано поряд із
   «Lost-update guard».
5. `prerender-spa.mjs` рендерить сторінки довідки у jsdom — стаття `/support/api` не може читати
   `import.meta.env` поза `API_URL` і не повинна робити fetch.
6. iCal: `RRULE` без `UNTIL` + `DTSTART` сьогодні означає «відтепер щотижня»; календар сам не оновиться після
   зміни розкладу, якщо клієнт не підписаний за URL (Google Calendar «за URL» оновлює раз на добу) — пишемо це
   в опис.
7. `yaml` (eemeli) як devDependency бекенду змінює `package-lock.json` — ставити через `npm install -D`
   у `backend/`, не руками.

## Знахідки по фазах

### Фаза 4 — RSS та iCal (зроблено, 2026-10-18)

- `GtfsFeed` отримав структурні `routes` і `trips` (зупинки з часом) поруч із файлами — iCal/RSS беруть їх з того самого
  кешу за revision, не парсять `stop_times.txt` назад і не ходять у БД.
- RSS: один `<item>`, `guid` = `malyn-transport-revision:<revision>`, заголовок із київською датою revision, у тексті —
  лічильники й перелік маршрутів; детерміновано для однієї revision (перевірено тестом з іншим `now`).
- iCal: `DTSTART` — дата revision за Києвом (не «сьогодні», інакше відповідь залежала б від моменту збірки кешу),
  `RRULE` тижневий за сервісом, `VTIMEZONE Europe/Kyiv` з правилами EET/EEST, згортання рядків за **байтами** UTF-8
  (кирилиця), екранування `,;\`; GTFS-час ≥ 24:00 переноситься на наступну добу. Тест на опис після згортання має
  спочатку розгорнути рядки (`\r\n ` → порожньо) — на цьому впав перший прогін.
- Маршрут, якого немає у фіді (прихований / без розкладу), → 404; обидві відповіді з `ETag` revision і 304.
- На сайті: посилання «RSS змін розкладу» і «API» у блоці «Дані відкриті», рядки на `/support/api`, `llms.txt`, таблиця
  адрес у `transport-open-data.md`. Посилання «У календар» на сторінці маршруту — «Що далі».

### Фаза 3 — стабільні id (зроблено, 2026-10-18)

- `stop-redirects.ts` (бекенд) і `stopRedirects.ts` (сайт) + копія правила в `prerender-transport-stops.mjs` — три місця
  з однією логікою (ключ `st_\d+`, не жива зупинка, ціль жива, ланцюжок ≤ 8, цикл → відкинуто); тести на кожне.
  Валідацію в `validateTransportDataset` не додавали: сміття в меті не блокує PUT датасету, а читачі санітизують самі.
- `GET /transport/stops/:id` і `/transport/stop-redirects` вантажать весь датасет (`loadTransportDataset`), бо стаб у
  `transport-http.test.ts` ігнорує `where` у `findMany`, а точкові запити заради рідкого ендпоінта не варті розширення
  стаба; кеш 5 хв + `ETag`. Стаб отримав `transportMeta.update` (бампає `updatedAt`).
- Табло: `Navigate replace` після всіх хуків (перед фінальним `return`), query зберігається — тест на це і на те, що
  жива зупинка ключем не редиректиться. serve-dist 301 стоїть **перед** API-редиректом і `tryResolve`;
  `stop-redirects.json` у `NO_CACHE_FILES`.
- UI для редиректів в адмінці не робили — `PUT /admin/transport/stop-redirects` + рецепт `curl` у
  `transport-open-data.md` (мапа замінюється цілком, 400 із переліком проблем).

### Фаза 2 — OpenAPI (зроблено, 2026-10-18)

- `getRegisteredRoutes` губив префікс монтування (`app.use('/poputky', r)` → `GET /search`): Express 4 тримає його лише
  в `layer.regexp` (`/^\/poputky\/?(?=\/|$)/i`) — тепер префікс відновлюється з regexp (`mountPath`), логи роутів теж
  стали правдивими. Пастка 3 підтвердилась.
- YAML: будь-який рядок із `: ` або `{` усередині (`Content-Disposition: attachment`, `{ counted: false }`) треба брати в
  лапки — парсер `yaml` (eemeli) інакше бачить вкладений мапінг; у тесті цього не видно, тож перевіряти `node -e parse`
  після кожної правки.
- `yaml@2` — devDependency бекенду лише для тесту; продакшн віддає файл як текст (`fs.readFileSync`, один раз, кеш 1 год),
  `.dockerignore` бекенду `openapi/` не виключає.
- `/support/api` — тема `api` між «Сайт» і «Приведи друга» (хаб, бічна навігація, чипи й prev/next підхоплюють її з
  `SUPPORT_TOPICS`), стаття з TOC `API_TOC`, `<pre>` отримав стиль у `SupportPage.css`; у `prerender-spa.mjs` і
  `sitemap.xml` додано шлях. Перший тест на статтю довідки в репо — `SupportArticle.test.tsx`.
- `openData.ts`: `OPENAPI_URL`, `DATASET_LIVE_URL` поруч із рештою адрес.

### Фаза 1 — каталоги GTFS і валідатор (зроблено, 2026-10-18)

- **Mobility Database подано 2026-10-19:** PR <https://github.com/MobilityData/mobility-database-catalogs/pull/1751>
  (`mdb_source_id` 3546; інструмент `add_gtfs_schedule_source` дав 3545, уже зайнятий — він рахує id як «кількість файлів
  + 1», а в каталозі були видалення). Воркфлоу PR від нового контрибʼютора стоять у `action_required`, доки мейнтейнер не
  натисне «Approve and run» — це не помилка. Локальне середовище інструмента на Apple Silicon: `brew install geos
  spatialindex`, потім `pip install 'rtree>=1.3'` поверх `requirements.txt` (Rtree 0.9.7 не працює з libspatialindex 2.x).
- **Mobility Database злито 2026-10-19 (того ж дня):** мейнтейнери перенумерували на **`mdb_source_id` 3615**
  (`…-malinkievua-gtfs-3615.json`); `latest` → `https://storage.googleapis.com/storage/v1/b/mdb-latest/o/ua-zhytomyr-oblast-malyn-city-public-transport-community-feed-by-malinkievua-gtfs-3615.zip?alt=media`
  (наповнюється їхнім cron-ом). Червона перевірка «Validate and download» на PR — їхня інфраструктура (`pip install GDAL
  --global-option` більше не існує в pip 26), не наш фід; злито з approve попри неї.
- **Transitland подано 2026-10-19:** PR <https://github.com/transitland/transitland-atlas/pull/2260> з форка
  `drivling/transitland-atlas`. Бот «DMFR Format Check» попросив канонічний формат (`languages` у стовпчик, `tags`
  оператора після `associated_feeds`, `gtfs_agency_id` перед `feed_onestop_id`, без `license_spdx_identifier`) —
  застосовано у форку й у `Docs/open-protocols/transitland/malin.kiev.ua.dmfr.json`; «probe» уже підтвердив фід
  (1 agency, 9 routes, 98 stops). Чекає на approve воркфлоу «Validate» і мердж.
- **Transitous уже маршрутизує Малин** (перевірено 2026-10-19): мейнтейнер додав фід у `feeds/ua.json` ще 2026-10-18
  (тип `http`, наш URL, ліцензія з атрибуцією); `api.transitous.org/api/v1/plan` між «10 ОГШБ» і «14 ОМБ» дає 5 варіантів
  рейсами №7, №3+№8 — перший реальний сторонній споживач відкритих даних (П6, П9 закриті фактом).
- Transitland: гілка форку відставала від upstream на 5 комітів, і «validate» червонів через чужі фіди в diff; після
  `git rebase upstream/main` + `--force-with-lease` перевірки лише на нашому файлі.
- **Атрибуція у планувальнику (2026-10-19):** під рейсом Transitous показує `agency_name` кнопкою з `agency_url` —
  вела на міськраду. Рішення власника «щоб бачили нас»: `agency_url` → `https://malin.kiev.ua/transport` (у БД — PUT
  датасету адміном, рецепт у `open-protocols/README.md` 3а; у коді — запасне значення), `feed_publisher_name` →
  «malin.kiev.ua (Technologies LLC)». Назву агенції не чіпаємо — це поле оператора. Запис у Transitous переводимо на
  `mdb-3615` з нашою атрибуцією, але **PR робить власник руками**: `AI_POLICY.md` Transitous забороняє коміти й тексти
  від LLM-інструментів (README 3б).
- Transitous PR власника: <https://github.com/public-transport/transitous/pull/2610> (2026-10-19) — запис `mdb-3615`
  з атрибуцією замість `http`-джерела мейнтейнера — **злито 2026-10-20**. Атрибуційні правки коду й документів злито в #96;
  `agency_url` у базі переведено на `https://malin.kiev.ua/transport` 2026-10-19 (revision `2026-10-19T19:48:17.407Z`).

- `attributions.txt` у фіді (один запис виробника `malin_kiev_ua`) — валідатор прийняв мовчки (той самий звіт:
  0 помилок, `mixed_case` ×6, 2 info); `LICENSE.txt` згадує канонічну адресу й `attributions.txt`.
- `serve-dist.mjs`: `apiRedirectPath()` у `serve-dist-rules.mjs` (чисте правило з тестами) → 302 на `API_BASE` з
  `NO_CACHE_HEADERS` **до** `tryResolve`; перевірено на локальному `dist`: `/transport/gtfs.zip`, `/transport/gtfs/feed_info.txt`,
  `/openapi.yaml` → 302 на Railway із query як є, `/transport/dataset.json` як і раніше 200. Правило вже знає адреси
  фаз 2 і 4 (`/openapi.yaml`, `/transport/changes.rss`, `/transport/route/<id>/calendar.ics`) — до їх деплою на бекенді
  редирект веде на 404 бекенду, що краще за SPA-оболонку.
- Кнопка «Завантажити розклад (GTFS)» на сайті лишається на `API_URL` напряму (без зайвого стрибка); канонічна адреса
  `malin.kiev.ua/...` — у документах, `llms.txt`, каталогах і `LICENSE.txt` (`GTFS_FEED_CANONICAL_URL` у `gtfs-feed.ts`).
- `Docs/open-protocols/`: JSON для Mobility Database (форма або `add_gtfs_schedule_source`), DMFR для Transitland
  (`f-u9hbc-malyn~city~transport`, Wikidata Малина `Q148997`), `README.md` із кроками й текстами для власника.
  Реєструвати **після** деплою фронтенду цієї гілки (інакше адреса ще віддає SPA-оболонку).

### Фаза 0 (2026-10-18)

- Гілка `transport-open-protocols` від `origin/main` (#90 злитий). У чекауті власника `node_modules` повні
  (322/258 пакетів), husky активний.
- Фід проду: `etag "2026-10-14T13:17:49.327Z"`, 39 589 байт, 9 маршрутів, 247 рейсів, 98 зупинок,
  4 473 stop_times, 1 235 точок ліній. Bounding box зупинок: lat 50.755915–50.78502, lon 29.177424–29.305429.
- Валідатор 8.0.1: `java -jar gtfs-validator-8.0.1-cli.jar -i malyn-gtfs.zip -o report -c ua` — 0.14 с;
  результат вище («Рішення», фаза 1). Java в системі немає (`/usr/libexec/java_home` порожній, Docker Desktop
  не запущений) — JRE Temurin 17 (aarch64, `api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jre/hotspot/normal/eclipse`)
  розпаковано в scratchpad сесії, нічого не встановлено в систему.
- Mobility Database вже має 7 українських фідів (`ua-kyiv-gtfs-3230`, `ua-lviv-lvivavtodor-gtfs-2374`,
  `ua-bucha-gtfs-2945`…); формат — JSON за `schemas/gtfs_schedule_source_schema.json`, bounding box у
  них часто `null` (його рахує сам каталог). У Transitland Atlas українських `*.ua.dmfr.json` немає.
- У `TransportMeta.payload` немає ні редактора в адмінці, ні історії — звідси рішення фаз 3 і 4.
