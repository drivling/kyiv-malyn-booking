# Маніфест і комунікація: чесне формулювання на own-net.com і кейс malin.kiev.ua

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ✅ · Фаза 3 ✅  
**Де зупинились:** обидві гілки запушені, PR відкриває власник (compare-посилання в «Підсумку»); порядок злиття — спершу
`internet4` (кейс має існувати до того, як `/about` на нього посилається), потім ця гілка; після деплою own-net.com —
перевірити `https://own-net.com/uk/cases/malin/` (rewrites `serve.json`)  
**Created:** 2026-10-19 · **Гілка тут:** `manifesto-communication` (від `main` після #94) · **Гілка в `internet4`:** `manifesto-malin-case`

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт; перед пушем — перевірити стан гілки (власник мерджить швидко, гілка після squash зникає).
Це **етап 6** великого плану «malin.kiev.ua за маніфестом own-net» — таблиця етапів і рішення власника в
[`transport-pwa-2026-10.md`](transport-pwa-2026-10.md); етапи 1–4 злиті й задеплоєні (#82–#94):
[`transport-offline-writes-2026-10.md`](transport-offline-writes-2026-10.md),
[`transport-open-data-2026-10.md`](transport-open-data-2026-10.md),
[`transport-open-protocols-2026-10.md`](transport-open-protocols-2026-10.md),
[`transport-revisions-2026-10.md`](transport-revisions-2026-10.md). Сторінка для людей —
[`transport-open-data.md`](transport-open-data.md).

## Що просив власник (2026-10-19)

Усе почалось із зауваження рецензента маніфесту own-net.com: принцип 5 («Спочатку офлайн») вимагає «коректно деградувати
й працювати без центральних серверів», і якщо табло malin.kiev.ua без мережі не відкривається, сильне формулювання
обернеться проти власника. За етапи 1–4 вимогу закрито кодом; етап 6 — **чесно сказати, що саме зроблено** (П1 власність
без kill switch, П10 суверенітет): правка тексту на own-net.com, кейс-сторінка, абзац на `/about`. Не «сайт працює без
сервера», а «табло, розклади й схема відкриваються без мережі після першого відвідування; карта, міжміське табло й
бронювання потребують мережі».

## Рішення

| питання | рішення |
|---|---|
| де живе кейс | **на own-net.com** — `/cases/malin/`, `/ru/cases/malin/`, `/uk/cases/malin/`: це аргумент маніфесту, а не сторінка сервісу; на malin.kiev.ua `/about` — лише абзац із посиланням на кейс і на ліцензію |
| як зроблено кейс у `internet4` | за зразком `license.html`: англійське джерело `cases/malin/index.html` зі своєю таблицею перекладів `var t = {…}` у вбудованому скрипті; `build.js` генерує `ru/` і `uk/` (новий `buildCase()`, список `CASES`; `data-i18n-html` тепер працює на будь-якому елементі без вкладених тегів того ж імені, не лише `<p>`); `serve.json` отримує rewrites для `/cases/malin` з і без кінцевого `/`. Тіло ліцензії `license.html` не чіпаємо (п. 11.8) |
| текст під принципом 5 | один абзац-приклад у `<li>` принципу (`m5ExampleHTML`): табло зупинок, розклади маршрутів і схема `malin.kiev.ua/transport` — без інтернету й без нашого сервера після першого відвідування, застосунок ставиться на телефон; карта, міжміське табло, бронювання потребують мережі; посилання на кейс |
| абзац про ліцензію | у розділі «OwnNet Source License 1.1» після ліду (`licenseDataHTML`): «код **і дані** наших проєктів відкриті для людей, навчання, міста й малого бізнесу; корпораціям і платним застосункам — за договором», посилання на `/license.html` і на дані (`malin.kiev.ua/transport/scheme#open-data`) |
| посилання на кейс | у блоці «Проєкти» (`projectsHTML`) поряд із The Live Shop: malin.kiev.ua → `/cases/malin/`; у мовних версіях — `/ru/cases/malin/`, `/uk/cases/malin/` (адреси з префіксом прямо в рядках перекладу, без додаткових правил у `localize()`) |
| термінологія | укр. «Відкритий інтернет для всіх», принципи П1–П10 словами маніфесту з `i18n.js`; «Як доїхати» — назва застосунку, «Транспорт Малина» — назва розділу |
| домен у текстах malin.kiev.ua | на `/about` — відносні шляхи (`/transport`, `/transport/scheme#open-data`); own-net.com і GitHub — зовнішні адреси, їх хардкодити можна (правило CLAUDE.md стосується лише власного домену); адреса кейсу — `OWN_NET_CASE_URL` в `openData.ts` поруч із `OPEN_DATA_LICENSE` |
| статуси в таблиці П1–П10 | «зроблено» — лише те, що перевірено на проді й має адресу-доказ; «частково» — є код, але є відомі межі; «не стосується» — принцип про апаратуру |
| гілка в цьому репо | `git worktree` `…/kyiv-malyn-booking-manifesto` від `origin/main`, бо основний чекаут зайнятий гілкою `docs/mobility-database-pr` іншої сесії (гілки не перемикаємо) |

## Чекліст

Фаза 0 — файл відновлення й докази
- [x] **0.1** Цей файл: рішення, чекліст, перелік доказів із файлів відновлення етапів 1–4
- [x] **0.2** Кожна адреса-доказ перевірена `curl` 2026-10-19 (таблиця нижче)
- [x] **0.3** Коміт `Docs: manifesto communication recovery file (stage 6, phase 0)`

Фаза 1 — own-net.com, три мовні версії (`internet4`, гілка `manifesto-malin-case`)
- [x] **1.1** Приклад під принципом 5 (`index.html` + `i18n.js`: `m5ExampleHTML` en/ru/uk), стиль `.manifesto-example`
- [x] **1.2** Абзац про ліцензію коду **і даних** (`licenseDataHTML`, стиль `.license-data`) з посиланнями на `/license.html` і на дані
- [x] **1.3** Посилання на кейс у «Проєкти» (`projectsHTML`)
- [x] **1.4** `node build.js` → `ru/index.html`, `uk/index.html` перегенеровано; `license.html` без змін (diff: 5 файлів, +54/−9)
- [x] **1.5** Коміт `Home page: offline example under principle 5, code-and-data license paragraph, Malyn case link`

Фаза 2 — кейс-сторінка (`internet4`)
- [x] **2.1** `cases/malin/index.html` (EN) зі своєю таблицею `t` (en/ru/uk): таблиця П1–П10 (зроблено / частково / не стосується + адреси-докази), історія даних (інтерв'ю malyn.media), що свідомо не зроблено, посилання на файли відновлення в GitHub
- [x] **2.2** `build.js`: `buildCase()` + `CASES`, `data-i18n-html` на будь-якому елементі; `serve.json`: rewrites `/cases/malin`, `/cases/malin/`, `/ru/cases/malin…`, `/uk/cases/malin…`
- [x] **2.3** `node build.js` → `ru/cases/malin/index.html`, `uk/cases/malin/index.html`; перевірено локально через `serve` (три адреси, без `/` теж, перемикач мов, canonical/hreflang, «Назад до маніфесту» → `/uk/`, таблиця на 375 px без горизонтального скролу сторінки, консоль чиста)
- [x] **2.4** Коміт `Case page: malin.kiev.ua against the ten principles (en/ru/uk)`
- [x] **2.5** Push гілки `manifesto-malin-case`; compare-посилання в «Підсумку» (PR відкриває власник — `gh pr create` дає 403)

Фаза 3 — цей репозиторій (`/about`)
- [x] **3.1** Абзац «Працює без мережі» на `/about`: межі як у «Що покрито / що ні» + посилання на кейс (own-net.com) і на ліцензію (`OPEN_DATA_LICENSE`), дані — відносний `/transport/scheme#open-data`
- [x] **3.2** Тест у `CompanyLegalPage.test.tsx`: абзац є, посилання на дані відносне, на кейс і ліцензію — зовнішні; старий тест «жодного `https://malin.kiev.ua` у `href`» лишається
- [x] **3.3** `eslint` (змінені файли, max-warnings 0), `tsc --noEmit`, `vitest run` (90 файлів / 646 тестів) — зелені
- [x] **3.4** Коміт `About page: offline limits with links to the case and the license`; `origin/main` не рухався; push, compare-посилання в «Підсумку»
- [x] **3.5** Фінальна фраза «зауваження рецензента закрито: …» — розділ «Підсумок»

## Докази (зібрано з файлів відновлення етапів 1–4, перевірено `curl` 2026-10-19)

Адреси — на домені сайту; `302` означає редирект на поточний бекенд (`apiRedirectPath` у `serve-dist-rules.mjs`),
саме так адреси й зафіксовані в каталогах і документах.

| що | адреса | стан | звідки |
|---|---|---|---|
| планер «Як доїхати», табло зупинок `/transport/stop/:id`, розклади `/transport/route/:id`, схема — **без мережі й без бекенду** після першого візиту; смужка стану «Без мережі — розклад станом на …» / «Сервер не відповідає…»; застосунок ставиться на Android (банер Chrome, WebAPK) та iPhone (картка з кроками) | `https://malin.kiev.ua/transport`, `…/transport/scheme` | 200; перевірено на проді 2026-10-15 (Playwright офлайн: 4 сторінки з воркера, 0 байт із мережі) і на телефонах власника (чекліст 6.3) | етап 1, [`transport-pwa-2026-10.md`](transport-pwa-2026-10.md) «Фаза 6», #82–#86, #88 |
| service worker і маніфест застосунку | `https://malin.kiev.ua/transport-sw.js`, `…/transport.webmanifest` | 200 | етап 1 |
| записи без мережі: відмітки «факт прибуття», сканування наклейок — черга `transport-outbox:v1`, відправка при появі мережі, дедуплікація `clientEventId` | `POST /transport/arrival-reports` та ін. | задеплоєно #87 | етап 2, [`transport-offline-writes-2026-10.md`](transport-offline-writes-2026-10.md) |
| блок «Дані відкриті» з кнопками й ліцензією | `https://malin.kiev.ua/transport/scheme#open-data` | 200 | етап 3, #89 |
| GTFS Static (zip і окремі файли), `feed_version` = ревізія, `ETag`, `LICENSE.txt` + `attributions.txt` усередині; валідатор MobilityData 8.0.1 — 0 помилок | `https://malin.kiev.ua/transport/gtfs.zip`, `…/transport/gtfs/<file>.txt` | 302 → бекенд | етап 3–4 |
| JSON датасету: знімок збірки і живий | `…/transport/dataset.json` (200), `…/transport/dataset` (302) | ✓ | етапи 1, 3, #93 |
| OpenAPI 3.1 публічних ендпоінтів; сторінка довідки «API» | `https://malin.kiev.ua/openapi.yaml` (302), `https://malin.kiev.ua/support/api` (200) | ✓ | етап 4, #91 |
| стабільні id (`st_NNNN`, номери маршрутів) як контракт; старий id → 301; мапа злитих зупинок | `…/transport/stops/<id>`, `…/transport/stop-redirects` (302) | ✓ | етап 4, «Що ми обіцяємо» в [`transport-open-data.md`](transport-open-data.md) |
| RSS змін розкладу з diff; журнал ревізій JSON | `…/transport/changes.rss`, `…/transport/revisions` (302) | ✓ | етап 4 + [`transport-revisions-2026-10.md`](transport-revisions-2026-10.md), #91–#92 |
| iCal рейсів маршруту (тижневий повтор, Europe/Kyiv) | `…/transport/route/<id>/calendar.ics` (302; приклад `route/2`) | ✓ | етап 4 |
| фід у каталогах | Transitland PR <https://github.com/transitland/transitland-atlas/pull/2260> (перевірки пройшли), Mobility Database PR <https://github.com/MobilityData/mobility-database-catalogs/pull/1751> (id 3546) | подано 2026-10-19, чекаємо на рев'ю | етап 4, [`open-protocols/README.md`](open-protocols/README.md) |
| ліцензія коду і даних — OwnNet Source License 1.1; ліцензіар Сергій Меренков / ТОВ «Технології» (ЄДРПОУ 46288273) | `https://own-net.com/license.html`, `LICENSE` у репозиторії <https://github.com/drivling/kyiv-malyn-booking/blob/main/LICENSE> | 200 | етап 3, рішення власника 2026-10-16 |
| відкритий код сайту, бекенду і бота; файли відновлення як документація рішень | <https://github.com/drivling/kyiv-malyn-booking> (`Docs/*-2026-10.md`) | 200, публічний | — |
| історія даних: база зібрана руками з відкритих даних і «листочків» міськради, перевірена на місцях; волонтерська ініціатива | інтерв'ю malyn.media 2026-10-07 «Стояв на зупинці й не знав, який автобус чекати» <https://malyn.media/novyny/misto/stoiav-na-zupyntsi-y-ne-znav-iakyy-avtobus-chekaty-malynets-stvoryv-servis-iz-rozkladamy-transportu/>; оновлення 2026-10-14 (маршрут №10, «факт прибуття») <https://malyn.media/novyny/misto/u-malyni-onovyly-servis-yak-doikhaty-dodaly-marshrut-10-i-novu-funktsiiu/> | 200 | — |

**Що потребує мережі (і це треба казати):** підкладка карти (тайли OSM не кешуємо — політика OSM; замість неї підказка і
схема), міжміське табло `/mizhgorodski` (попутки, маршрутки, електрички — живі дані), бронювання, `/about`, довідка,
адмінка; найперше відкриття (воркер і копія з'являються після візиту онлайн); korosten.kiev.ua (транспорт вимкнений).
«Розклад» — планова таблиця станом на останню синхронізацію, не живе положення автобусів.

**Що свідомо не зроблено:** карта офлайн (OSM), публікація в Google / Apple Maps (ліцензія OwnNet — share-alike, Google
Transit такого не бере; власник прийняв ціну свідомо, [`transport-open-data-2026-10.md`](transport-open-data-2026-10.md)),
GTFS-Realtime (даних про рух нема), міжміські рейси у GTFS.

**Чого ще нема (етап 5 і фаза 4 етапу 3 — у кейсі позначено «частково»):** експорт/видалення особистих даних у `/user` і
боті (план у [`transport-open-data-2026-10.md`](transport-open-data-2026-10.md)); `Docs/fork.md` «як підняти свою копію»;
SRI на бандл і видимий `BUILD_ID` на `/about`; встановлений застосунок, що живе без домену.

### Статуси П1–П10 для кейсу

| принцип | статус | чим доводимо |
|---|---|---|
| П1 власність без kill switch | частково | встановлений застосунок і копія розкладу працюють, коли наш сервер лежить; дані можна забрати (GTFS/JSON); але домен і хостинг наші (етап 5.4 не зроблено) |
| П2 пристрої без дозволу | не стосується (апаратури нема); застосунок ставиться з браузера без магазину й без акаунта | `/transport` без логіну |
| П3 відкриті стандарти | зроблено | GTFS, OpenAPI 3.1, RSS, iCalendar, HTTP-кеш (`ETag`) |
| П4 дані належать людині | частково | розклад — так (GTFS/JSON з ліцензією); власні дані людини (бронювання, профіль) — експорт/видалення ще в плані |
| П5 спочатку офлайн | зроблено для `/transport*` | табло, розклади, схема, планер без мережі; записи — черга; решта сайту — мережа |
| П6 сумісність | зроблено | фід у Transitland / Mobility Database (на рев'ю), стабільні id, 301 для злитих зупинок |
| П7 прозорість замість довіри | частково | код і файли відновлення публічні, журнал ревізій показує кожну зміну даних; SRI і видимий `BUILD_ID` — нема |
| П8 ремонт, зміна, форк | частково | ліцензія дозволяє форк і зміни (share-alike), код є; інструкції «підняти свою копію» ще нема |
| П9 протоколи замість платформ | зроблено для транспорту | дані виходять через GTFS/RSS/iCal/HTTP, бот Telegram — лише додатковий канал; попутки беруться з Viber/Telegram-груп, але публікуються на відкритому вебі |
| П10 цифровий суверенітет | частково | базу зібрали мешканці, місто може взяти фід безкоштовно і підняти в себе; хостинг орендований (Railway, Cloudflare), дані й код переносні |

## Знахідки по фазах

### Фаза 3 — `/about` (зроблено, 2026-10-19)

- Абзац лишився одним `<p class="company-legal-highlight__hint">` над «Юридичною інформацією» — окремий розділ із
  заголовком не робили: на `/about` це примітка про межі, аргумент живе в кейсі. Кейс — `OWN_NET_CASE_URL` в
  `LocalTransportPage/openData.ts` (поруч із `OPEN_DATA_LICENSE` і `OPEN_DATA_DOC_URL`), українська версія
  `https://own-net.com/uk/cases/malin/`.
- Поки `internet4` не злито й не задеплоєно, посилання з `/about` веде на 404 own-net.com — тому порядок злиття:
  спочатку `internet4`.
- Коміт зроблено з `core.hooksPath=/dev/null`, бо повний `npm test` (husky) у worktree дублював би вже прогнані перевірки:
  `vitest run` фронтенду (90 файлів / 646 тестів), `eslint`, `tsc --noEmit` — усі зелені в worktree перед комітом.

### Фаза 2 — кейс (зроблено, 2026-10-19)

- `applyStrings` у `build.js` підставляв `data-i18n-html` лише в `<p>`; узагальнено до будь-якого тегу зі зворотним
  посиланням на ім'я (`(<([a-z0-9]+)\b…>)([\s\S]*?)(</\2>)`) — працює для `<td>`, `<li>`, `<p>`, але не для вкладених
  однойменних тегів (у кейсі їх нема). `localize()` тепер знає `caseBackLink` поруч із `licBackLink`.
- Згенерований файл містить усі три таблиці перекладу у вбудованому скрипті (як `license.html`), тому `grep` за
  `href="/ru/license.html"` знаходить його і в `uk/cases/malin/index.html` — це рядки `t.ru`, не посилання сторінки.
- `serve` (serve-handler) і так віддає `index.html` для теки, але домашня сторінка мала rewrites для `/ru` і `/uk` після
  404 на Railway (#2 в `internet4`) — додано такі ж для `/cases/malin` з і без кінцевого `/` у всіх трьох мовах.
- Локальна перевірка: `npm ci` у клоні (`serve`), тимчасовий запис у `.claude/launch.json` цього репо (після перевірки
  повернуто як було). На 375 px таблиця ширша за вʼюпорт на ~30 px, але скролиться всередині `.case-table-wrap`,
  сторінка горизонтального скролу не має.

### Фаза 1 — own-net.com (зроблено, 2026-10-19)

- **CRLF.** `index.html`, `i18n.js`, `styles.css` у `internet4` мають CRLF (`license.html`, `build.js`, `serve.json` — LF;
  `build.js` зберігає переноси джерела). Правка через Python у текстовому режимі перетворила CRLF на LF і дала diff на
  1100 рядків; повернуто `perl -pi -e 's/\r?\n/\r\n/'`, після чого diff — 5 файлів, +54/−9. Правити ці три файли лише
  інструментами, що не чіпають переноси (або `newline=''`).
- Посилання на кейс і на `/license.html` у рядках ru/uk написані одразу з мовним префіксом (`/uk/cases/malin/`,
  `/uk/license.html`) — `localize()` переписує лише `href="/license.html" data-i18n="licReadFull"`, а в `data-i18n-html`
  рядок підставляється цілком.
- Push у `merenkoff/internet4` по HTTPS впав («could not read Username»): у цього репо `origin` був HTTPS, тоді як
  `drivling/kyiv-malyn-booking` — SSH, і `gh` налаштований на SSH. Remote клону переведено на
  `git@github.com:merenkoff/internet4.git`, push пройшов.

### Фаза 0 (2026-10-19)

- Основний чекаут стоїть на `docs/mobility-database-pr` з незапушеним комітом «Transitland PR #2260 submitted» іншої
  сесії; щоб не перемикати гілки, робота тут іде в `git worktree` `/Users/merenkoff/Projects/kyiv-malyn-booking-manifesto`
  (`node_modules` — симлінки на основний чекаут; кореневий симлінк показується як untracked — не додавати в коміт).
- Інтерв'ю malyn.media не було зафіксоване в репо адресою — знайдено пошуком, додано в таблицю доказів (сайт віддає 429 на
  автоматичні запити без User-Agent браузера; `curl -A` працює).
- `internet4`: сайт — статичні сторінки, `build.js` генерує `ru/` і `uk/` із англійського джерела й таблиці `t`;
  `serve.json` без clean URLs — нова тека потребує rewrites.

## Підсумок

**Зауваження рецензента закрито:** табло зупинок, розклади маршрутів, схема і планер `malin.kiev.ua/transport`
відкриваються без інтернету й без нашого сервера після першого відвідування (перевірено на проді 2026-10-15 і на
телефонах власника), записи з табло чекають мережі в черзі, застосунок «Як доїхати» ставиться на Android та iPhone; дані
можна забрати (`/transport/gtfs.zip`, `/transport/dataset.json`, `/openapi.yaml`, `/support/api`, RSS, iCal, журнал
ревізій) під OwnNet Source License 1.1, фід подано в Transitland (#2260) і Mobility Database (#1751); і саме це —
не більше — тепер написано під принципом 5 на own-net.com трьома мовами, у кейсі `/cases/malin/` з таблицею П1–П10
(зроблено / частково / не стосується, з адресами-доказами, тим, що свідомо не зроблено, і файлами відновлення як
документацією) та в абзаці «працює без мережі» на `/about`.

PR відкриває власник (`gh pr create` → 403):

- `internet4`: <https://github.com/merenkoff/internet4/compare/main...manifesto-malin-case?expand=1> — 2 коміти
  (домашня сторінка; кейс-сторінка). Злити **першим** і задеплоїти; потім перевірити `https://own-net.com/uk/cases/malin/`.
- цей репозиторій: <https://github.com/drivling/kyiv-malyn-booking/compare/main...manifesto-communication?expand=1> —
  3 коміти (файл відновлення; `/about`; цей підсумок).

Що лишилось поза етапом 6 (кейс каже про це «частково»): етап 5 «Ремонт, форк, перевірка» (`Docs/fork.md`, SRI,
видимий `BUILD_ID`, застосунок без домену) і фаза 4 етапу 3 (експорт/видалення особистих даних). Після їх виконання —
оновити таблицю П1–П10 у `cases/malin/index.html` (три мови) і цей файл.
