# Табло без мережі: транспорт Малина як PWA

**Status:** Фаза 0 ✅ · Фаза 1 ⏳ · Фаза 2 ⏳ · Фаза 3 ⏳ · Фаза 4 ⏳ · Фаза 5 ⏳ · Фаза 6 ⏳  
**Де зупинились:** фаза 0 закрита; далі — фаза 1 (serve-dist)  
**Created:** 2026-10-15 · **Гілка:** `feat/transport-pwa` (від `main` після #79)

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт. Це **етап 1** великого плану «malin.kiev.ua за маніфестом own-net» (таблиця етапів нижче);
кожен наступний етап отримає свій файл відновлення перед стартом.

## Що просив власник (2026-10-15)

Маніфест own-net.com (принцип 5, «Спочатку офлайн»): *«Кожна важлива система має коректно деградувати та
працювати без центральних серверів»*. Рецензент маніфесту: якщо табло й розклади malin.kiev.ua відкриваються
без інтернету — вимога закрита, якщо ні — сильне формулювання обернеться проти нас. Власник хоче, щоб сайт із
табло працював офлайн, як `pos.the-live.shop/tablet`, і ставився на телефон як застосунок кнопкою в браузері.

**Перевірено 2026-10-15 — сьогодні вимога НЕ закрита.** На malin.kiev.ua немає ні webmanifest, ні service
worker (`/sw.js`, `/manifest.json` віддають SPA-оболонку), favicon веде на неіснуючий `/vite.svg`. Датасет
транспорту живе лише в пам'яті вкладки й у HTTP-кеші на 5 хв; без мережі сторінка показує сирий «Failed to
fetch», а після однієї невдачі `useTransportDataset` більше ніколи не перезавантажує дані (`inflight` не
скидається). `LocalTransportGate` блокує рендер, поки не відповість `/trip-points`.

**Зразок:** `/Users/merenkoff/Projects/tiktok-live/pos` (`TechDocs/POS_PWA.md`) — рукописний SW без workbox,
precache-список зі збірки, оболонка з кешу, оновлення «встановилось і чекає», кнопка «Встановити», підказка для
iOS. Тут його повторюємо під `/transport*`; відмінності: API крос-доменний (Railway), оновлення застосовуємо самі
за правилами `freshBuild`.

## Рішення власника (AskUserQuestion, 2026-10-15)

| питання | відповідь |
|---|---|
| межі PWA | **лише `/transport*`** — застосунок «Транспорт Малина»; міжміське табло й адмінка — звичайний сайт |
| «великий план» | **увесь маніфест own-net** — malin.kiev.ua як зразок 10 принципів; етап 1 — офлайн-табло |
| оновлення версії | **авто, коли безпечно** (правила `freshBuild`) або при наступному переході; інакше банер «Оновити» |
| іконка | **згенерувати просту** (маршрутка на фірмовому `#00aff5`), PNG закомічені, замінити можна будь-коли |

## Великий план: етапи (фази фаз)

Принципи маніфесту: П1 власність без kill switch, П2 без дозволу корпорації, П3 відкриті стандарти, П4 дані
належать людині, П5 спочатку офлайн, П6 інтероперабельність, П7 перевірювана архітектура, П8 ремонт/форк,
П9 протоколи замість платформ, П10 суверенітет. Фази етапів 2–6 — орієнтир, уточнюється перед стартом етапу.

| етап | принципи | мета | фази (орієнтовно) |
|---|---|---|---|
| **1. Табло без мережі** (цей файл) | П5 | `/transport*` відкривається без мережі й без бекенду; ставиться на телефон як застосунок | 0 файл відновлення · 1 serve-dist · 2 дані переживають відсутність мережі/бекенду · 3 встановлення · 4 service worker + оновлення · 5 шліфування · 6 перевірка на проді |
| 2. Записи без мережі | П5 | те, що людина робить на табло, не губиться без мережі | 1 outbox у localStorage для sticker-scans/returns (безпечно повторювати — бекенд дедуплікує 2/30 хв) · 2 бекенд: `occurredAt` + `clientId` для arrival-reports (зараз сервер бере свій час, ±90 хв → 422; `backend/dist` комітимо) · 3 черга «факту прибуття» · 4 стани банера «надішлемо, коли з'явиться мережа» |
| 3. Дані належать людині | П4, П3 | дані можна забрати з собою | 1 публічні `/transport/dataset.json` (знімок, уже з етапу 1) і `/transport/gtfs.zip` зі стабільними URL + `revision` + ліцензія (експорт GTFS уже є: `backend/src/scripts/export-gtfs.ts`, поки лише в `data/`) · 2 «Завантажити розклад» на `/transport/scheme` · 3 експорт/видалення особистих даних у `/user` і боті · 4 часті зупинки — експорт/імпорт файлом |
| 4. Відкриті протоколи | П3, П6, П9 | дані доступні іншим застосункам без нас | 1 GTFS-фід у Mobility Database / Transitland · 2 OpenAPI для публічних ендпоінтів · 3 стабільні id зупинок/маршрутів як контракт · 4 iCal/RSS там, де є сенс |
| 5. Ремонт, форк, перевірка | П7, П8, П1, П2 | сайт можна перевірити і підняти самому | 1 ліцензія й відкритий код (або лише дані + фронтенд) · 2 `Docs/fork.md` «як підняти свою копію» · 3 SRI на бандл і видимий `BUILD_ID` на `/about` · 4 встановлений застосунок живе, навіть якщо домен зник |
| 6. Маніфест і комунікація | П1, П10 | чесне формулювання | 1 розділ «Працює без мережі» на `/about` з межами · 2 правка тексту на own-net.com (репо `internet4`): «табло й розклади відкриваються без мережі», не «сайт працює без сервера» · 3 кейс-сторінка |

## Рішення (етап 1)

**Два незалежні шари.** Шар даних працює й без SW і сам закриває «бекенд упав, фронт живий»; шар оболонки
додає «мережі немає взагалі» і встановлення.

### Шар даних (застосунок, не SW)

- `useTransportDataset`: **локальна копія** (localStorage `transport-dataset:v1` = `{dataset, revision,
  fetchedAt}`, віддаємо миттєво) → **мережа** (`GET /transport/dataset`; стан міняємо лише якщо `revision` інша;
  успіх → перезаписуємо копію) → якщо копії нема і мережа не відповіла → **знімок збірки**
  `/transport/dataset.json` (пише `prerender-transport-stops.mjs` з того ж API, що й пререндер; SW його
  precache-ить). Хук віддає `{ dataset, loading, error, reload, offline, source: 'network'|'local'|'snapshot',
  dataAsOf }`.
- Копія і знімок минають `apiClient` → `configureRouteNames(dataset.routes)` викликає хук, інакше «11/1» зламається.
- `useSiteLocalTransport` пам'ятає відповідь у localStorage `site-local-transport:<cityCode>` — ворота не блокують
  без мережі. Слухач `online` → `reload()`.

### Шар оболонки (service worker)

- `/transport-sw.js` у корені (шаблон `frontend/sw/transport-sw.js`, плейсхолдери `'__BUILD_ID__'` /
  `__PRECACHE__`, збирає `scripts/build-sw.mjs`), scope **`/transport`** без слеша — щоб контролювати й сам
  `/transport` (scope — строковий префікс, збігається і з `/transport-sw.js`, `/transport.webmanifest` — не
  сторінки). Реєструємо лише в `PROD`, не в пререндері, на `getCurrentSite().isPrimary`, і лише коли людина вже на
  `/transport*`.
- **Оболонка — `dist/index.html`** (ключ `/index.html`, serve-dist віддає його файлом, `no-cache`), не пререндерений
  `/transport`: на `/transport/stop/x` блимав би планер, і він у 20 разів більший. `createRoot` замінює вміст,
  `usePageSeo` ставить title/canonical у рантаймі. Краулери SW не запускають — SEO не змінюється.
- Precache: `['/index.html', ...sorted('/assets/**'), '/transport.webmanifest', ...sorted('/icons/*'),
  '/transport/dataset.json']`. Не precache-имо `/` (301), пререндерені html, постер схеми, robots/sitemap.
  `BUILD_ID` = sha256(список + вміст **нехешованих** записів) — у планшеті хешується лише список, але тут знімок
  змінюється під сталим URL щодеплою. Нехешовані записи при install беремо з `cache: 'reload'`. `build-sw.mjs`
  падає, якщо файлу зі списку нема в `dist/`.
- Кеші: `malin-transport-shell-<BUILD_ID>` (старі чистимо на `activate`), `malin-transport-fonts-v1` для Google
  Fonts (cache-first; у `<link>` потрібен `crossorigin`, інакше відповідь opaque).

| запит | дія SW |
|---|---|
| не GET (sticker-scans, arrival-reports, PUT) | не чіпаємо |
| `fonts.googleapis.com` / `fonts.gstatic.com` | cache-first у кеш шрифтів |
| інший крос-домен (API Railway, OSM-тайли, gtag, telegram) | не чіпаємо |
| навігація, `pathname === '/transport' \|\| startsWith('/transport/')`, останній сегмент без крапки | `cache.match('/index.html')` ∥ `fetch` |
| інша навігація (`/`, `/mizhgorodski`, `/admin`, постер `.pdf/.svg`) | не чіпаємо |
| same-origin GET, pathname ∈ precache (`Set`) | cache-first, промах → fetch → put |
| same-origin GET поза precache (`/` від freshBuild, sitemap, `routes.json`) | не чіпаємо |

### Оновлення (інтеграція з `freshBuild.ts`)

SW при install **не** кличе `skipWaiting` — новий білд ставиться й чекає. `useFreshBuild` лишає собі політику
(10 хв між перевірками, 30 хв «покинутої» вкладки, `safeToReload`, loop-guard у sessionStorage, повний перехід на
наступному маршруті) і міняє два примітиви через `opts.updater = { controlled, check, apply }`:
- `controlled()` — сторінка під SW; рішення на кожну перевірку (перший візит стає контрольованим після `clients.claim()`);
- `check()` — замість `fetch('/')`: `reg.update()` → дочекатись `installed` → якщо є `reg.waiting` **і**
  `navigator.serviceWorker.controller` → `'sw:<buildId>'` (`GET_BUILD_ID` через MessageChannel);
- `apply()` — `postMessage('SKIP_WAITING')`; справжній `location.reload()` робить слухач `controllerchange` **лише
  коли `applying`** (перший install теж кидає `controllerchange`).
Чому не лишити `fetch('/')`: reload під старим SW знову віддав би стару оболонку. Нова версія відома, але зараз
не безпечно → `UpdateBanner` «Доступна нова версія — Оновити / Пізніше» (`role="status"`, без `aria-modal`, не на
`/admin`). Якщо при реєстрації вже є `reg.waiting` (кілька вкладок) — банер, не reload. Без `updater` (jsdom) —
старий шлях, наявні тести freshBuild не змінюються.

### Встановлення

`public/transport.webmanifest`: `id`/`start_url`/`scope` = `/transport` (не `/` — він 301), name «Транспорт
Малина», short_name «Транспорт», `display: standalone`, `lang: uk`, `theme_color`/`background_color` `#00aff5`,
іконки 192/512 `any` + 512 `maskable`. `captureInstallPrompt()` у `main.tsx` (подія одна; `prerender-entry.tsx`
`main.tsx` не виконує). Кнопка «Встановити застосунок» у `TransportStatusBar`, коли `canInstall &&
!isStandalone()`; iOS — підказка «Поділитися → На Початковий екран» із закриттям. На вторинному домені serve-dist
віддає 404 на маніфест і SW.

## Чекліст

Фаза 0 — файл відновлення
- [x] **0.1** Цей файл

Фаза 1 — serve-dist (без змін UI)
- [ ] **1.1** `scripts/serve-dist-rules.mjs`: `cacheControlFor(pathname)` — `.html`, `/transport-sw.js`,
  `/transport.webmanifest`, `/transport/dataset.json`, `/transport/routes.json` → `no-cache`; `/icons/` → день;
  `/assets/` → `immutable`; решта (robots, sitemap, постер — досі immutable на рік) → година; `isPrimaryOnlyFile`
- [ ] **1.2** `scripts/serve-dist.mjs`: MIME `.webmanifest`, `.pdf`; `sendFile` через `cacheControlFor`; HEAD віддає той
  самий `Cache-Control`; на вторинному домені 404 для `isPrimaryOnlyFile`
- [ ] **1.3** Тести в `src/test/serve-dist-rules.test.ts`

Фаза 2 — дані переживають відсутність мережі й бекенду (без SW)
- [ ] **2.1** `useTransportDataset.ts`: `inflight = null` у `.catch`
- [ ] **2.2** `dataset/datasetStore.ts`: `readStored`, `writeStored` (ліміт ~1.5 МБ, `QuotaExceededError` ковтаємо),
  `fetchSnapshot` (`/transport/dataset.json`, `cache: 'no-cache'`, лише `res.ok` + content-type json — у dev і при
  SPA-fallback приходить HTML 200); усе no-op під `isPrerendering()`
- [ ] **2.3** Хук: копія → мережа → знімок; `configureRouteNames`; `online` → `reload()`; `{ offline, source, dataAsOf }`
- [ ] **2.4** `prerender-transport-stops.mjs` `loadTransportIndex()`: запис `dist/transport/dataset.json`
- [ ] **2.5** `useSiteLocalTransport.ts`: пам'ять у localStorage per `cityCode`
- [ ] **2.6** `TransportStatusBar.tsx` (+css): «Без мережі — розклад станом на …» / «Сервер не відповідає — показуємо
  збережений розклад станом на …» + «Оновити»; після `LocalTransportSubNav` у планері, маршруті, табло, схемі
- [ ] **2.7** Планер і табло: `if (!data)` замість `if (error || !data)`; у `.lt-error` — «Спробувати ще раз»
- [ ] **2.8** MSW `GET /transport/dataset.json` → 404; тести хука, воріт, смужки; e2e без SW (`context.setOffline`)

Фаза 3 — встановлення (Chrome ставить і без SW)
- [ ] **3.1** `scripts/gen-pwa-icons.mjs` (Chromium із `@playwright/test`) → `public/icons/transport-192.png`,
  `transport-512.png`, `transport-maskable-512.png`, `apple-touch-icon-180.png`, `transport.svg`; `npm run pwa:icons`;
  PNG закомічені
- [ ] **3.2** `public/transport.webmanifest`
- [ ] **3.3** `index.html`: favicon, `<link rel="manifest">`, `apple-touch-icon`, `crossorigin` на Google Fonts
- [ ] **3.4** `src/pwa/installPrompt.ts`, `src/pwa/InstallButton.tsx`, виклик у `main.tsx`, кнопка в `TransportStatusBar`
- [ ] **3.5** GA4 `transport_pwa_install` + `Docs/transport-analytics.md`; тести

Фаза 4 — service worker і оновлення
- [ ] **4.1** `sw/transport-sw.js` (install / activate / message / fetch за таблицею); eslint override для `sw/**`
- [ ] **4.2** `scripts/precache.mjs` (чиста) + `src/test/precache.test.ts`
- [ ] **4.3** `scripts/build-sw.mjs` (не Vite-плагін: vitest `mergeConfig` і `prerender-spa` піднімають плагіни)
- [ ] **4.4** `package.json` build: `build-sw.mjs` після `prerender-spa.mjs`, перед seo-smoke
- [ ] **4.5** `src/pwa/serviceWorker.ts`, `src/pwa/useTransportServiceWorker.ts`
- [ ] **4.6** `freshBuild.ts` + `opts.updater`; `src/pwa/UpdateBanner.tsx` в `App.tsx`
- [ ] **4.7** Тести: serviceWorker (стаб `navigator.serviceWorker`), freshBuild з updater, UpdateBanner
- [ ] **4.8** `Docs/transport-pwa-smoke.md`

Фаза 5 — шліфування
- [ ] **5.1** Шрифти без мережі (self-host woff2 у `src/fonts` або `media="print" onload`)
- [ ] **5.2** `client.ts` `request()`: `Content-Type` лише з `body`; таймаут на датасет
- [ ] **5.3** `RouteMap` під `offline`
- [ ] **5.4** Рядок «Працює без мережі» на `/about`; розділ «Transport PWA» у `CLAUDE.md`
- [ ] **5.5** Lighthouse «Installable» + axe

Фаза 6 — перевірка на проді й закриття зауваження
- [ ] **6.1** Smoke на malin.kiev.ua (Android Chrome + iOS Safari)
- [ ] **6.2** Сюди — «Що покрито / що ні» для етапу 6 великого плану

## Пастки саме цього репо

1. `/` — 301 на `/mizhgorodski`: ніколи в precache і не `start_url`; `fetch('/')` від freshBuild іде повз SW.
2. Scope `/transport` — префікс; навігацію відбирати явно і без крапки в останньому сегменті (постер, `dataset.json`,
   `routes.json`).
3. Install падає на будь-якому non-200 — іконки закомічені, `/index.html` resolvable.
4. serve-dist давав `immutable` на рік усьому не-HTML — без фази 1 `dataset.json` і маніфест замерзли б у HTTP-кеші.
5. `prerender-spa` виконує `<App/>` у jsdom з реальним `localStorage` і fetch на прод — збереження/знімок під
   `isPrerendering()` вимикати, інакше смужка «без мережі» запечеться в HTML (seo-smoke це побачить).
6. `/transport/route/<retired>`: serve-dist 410, контрольований клієнт — оболонка + «не знайдено»; краулери не
   контрольовані.
7. `BUILD_ID` з хешами вмісту нехешованих записів, інакше деплой «лише дані» не дійде до клієнтів.
8. korosten.kiev.ua — окремий origin на тому ж `dist`: реєстрація лише на primary, 404 на маніфест/SW, пам'ять воріт
   per `cityCode`.
9. Посилання зі встановленого застосунку поза scope (NavBar → `/mizhgorodski`) відкриваються в custom tab.

## Чого свідомо немає в етапі 1

Офлайнових записів (етап 2); кешу OSM-тайлів; офлайну для `/mizhgorodski` і адмінки; workbox / vite-plugin-pwa;
автоматичного e2e з реальним SW (потрібен `npm run build` проти живого API + `serve-dist`; ручний smoke).

## Знахідки по фазах
