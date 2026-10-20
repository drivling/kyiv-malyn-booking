# Дані належать людині: відкритий GTFS і JSON транспорту Малина

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ✅ · Фаза 3 ✅ · Фаза 4 ✅ (2026-10-20)  
**Де зупинились:** фази 0–3 злиті в `main`; фаза 4 «особисті дані» — гілка `personal-data-phase4` (від `main` після #97), 4 коміти, PR відкриває власник; після деплою — перевірити з телефона пункти «Мої дані» в `Docs/transport-pwa-smoke.md`  
**Created:** 2026-10-16 · **Гілка:** `merenkoff/reverent-grothendieck-d7950b` (від `main` після #88)

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт. Це **етап 3** великого плану «malin.kiev.ua за маніфестом own-net» — таблиця етапів і
рішення власника в [`Docs/transport-pwa-2026-10.md`](transport-pwa-2026-10.md) (етап 1 «Табло без мережі»
задеплоєно #82–#86, #88; етап 2 «Записи без мережі» — #87,
[`transport-offline-writes-2026-10.md`](transport-offline-writes-2026-10.md)).

## Що не так сьогодні (перевірено 2026-10-16)

Принципи П4 («дані належать людині») і П3 («відкриті стандарти») маніфесту own-net: розклад, який людина
читає на табло, вона мала б могти **забрати з собою** у відкритому форматі й відкрити в будь-якому іншому
застосунку без нас.

- GTFS уже **є**, але лише в репозиторії: `backend/src/scripts/export-gtfs.ts` пише `data/malyn-transport/gtfs/`
  (`txt` + `malyn-gtfs.zip`) з локальної БД, запускається руками (`npm run export:gtfs`), викликає системний
  `zip`, а `feed_version` = дата запуску. На сайті й в API фіду нема; закомічений zip — на 2026-10-14 і застаріє
  після першої ж правки розкладу в адмінці.
- `GET /transport/dataset` (повний JSON, `revision`) і знімок збірки `/transport/dataset.json` (етап 1) публічні,
  але ніде не названі як «дані, які можна забрати»: ні посилання на сайті, ні ліцензії, ні опису формату.
- Жодної ліцензії на дані нема ніде — отже, формально їх не можна використовувати повторно, навіть із посиланням.

## Рішення

### Ліцензія даних — пропозиція для власника

Два реальні варіанти для розкладів (не коду):

| | **CC BY 4.0** (рекомендація) | ODbL 1.0 |
|---|---|---|
| Суть | роби що хочеш, назви джерело | те саме + **share-alike**: похідна база даних теж під ODbL |
| Хто так робить | більшість GTFS-фідів у Mobility Database / Transitland, data.gov.ua (CC BY за замовчуванням), Transport for London, Swiss opentransportdata | OpenStreetMap |
| Що дає нам | максимум повторного використання: Google / Apple / Moovit / OpenTripPlanner / студентський застосунок беруть без юристів; згадка «дані malin.kiev.ua» у кожному споживачі | захист від «взяли, закрили, не поділились» |
| Ризик | хтось продасть застосунок із нашими даними, згадавши нас | великі агрегатори share-alike даних **не беруть** (Google Transit вимагає ліцензію без copyleft); спільний набір з OSM-даними неможливий без юридичних викрутасів |
| Етап 4 (Mobility Database / Transitland) | каталог приймає, поле `license` заповнюється | приймають, але застосунки на їх основі часто фільтрують за ліцензією |

**Пропозиція: CC BY 4.0.** Мета етапу — щоб дані *пішли далі*, а не щоб їх охороняти; share-alike для
розкладу, який і так переписується з офіційних листків, нічого не захищає, а дорогу до Google Transit
(`Docs/local-transport-gtfs-feed.md`, «Google Maps publication») перекриває. Атрибуція «Дані: malin.kiev.ua» —
саме те, що нам потрібно від кожного споживача.

**Поки власник не вирішив**, код шле CC BY 4.0: одна константа на бекенді (`OPEN_DATA_LICENSE` у
`backend/src/gtfs-feed.ts`) і одна на фронтенді (`frontend/src/pages/LocalTransportPage/openData.ts`) — зміна
ліцензії = правка двох рядків і `Docs/transport-open-data.md`. Рішення власника записати в таблицю нижче.

| питання | відповідь |
|---|---|
| ліцензія даних | **OwnNet Source License 1.1** (рішення власника 2026-10-16, після інтерв'ю malyn.media: база зібрана руками — «дані маршруток мої»); ліцензіар подвійний — Сергій Меренков / ТОВ «Технології»; людям, місту й бізнесу до 100 000 USD вільно, корпораціям за договором; ціна — фід не підходить для Google/Apple Maps і каталогів «open data» (CC BY), що власник прийняв свідомо. Код репозиторію — під тією ж ліцензією (`LICENSE`) |

### Стабільні URL

| URL | що | звідки |
|---|---|---|
| `https://<API>/transport/gtfs.zip` | повний GTFS Static | бекенд, з БД, кеш у пам'яті за `revision` |
| `https://<API>/transport/gtfs/<file>.txt` | один файл фіду (`feed_info.txt`, `stops.txt`, …) без zip | те саме, для `curl` і перевірки версії |
| `https://malin.kiev.ua/transport/dataset.json` | повний датасет у внутрішньому JSON (знімок збірки) | `prerender-transport-stops.mjs`, етап 1 |
| `https://<API>/transport/dataset` | той самий JSON наживо, з `revision` | уже є |

`<API>` — `https://kyiv-malyn-booking-production.up.railway.app` (`frontend/scripts/api-base.mjs`), на сайті
посилання будується з `API_URL`. Сайт не проксує API, тож GTFS живе на домені бекенду; `Content-Disposition:
attachment; filename="malyn-gtfs.zip"` робить клік «Завантажити» завантаженням, а не відкриттям. У етапі 4
(каталоги фідів) цей URL і буде «канонічним» — тому шлях більше не змінюємо.

### Як `revision` потрапляє у файли

`revision` = `TransportMeta.updatedAt` в ISO (`2026-10-14T18:03:11.000Z`), його бампає кожен `PUT
/transport/dataset` і «Перерахувати час» (`Docs/route-variants-2026-10.md`, «Lost-update guard»).

- `feed_info.txt` → `feed_version` = `revision` як є (ISO-рядок; спец GTFS дозволяє будь-який текст), тож
  `feed_version` збігається з `revision` у `GET /transport/dataset` і з «станом на» на сайті.
  `feed_start_date` / `feed_end_date` лишаються константами (`20240101` … `20271231`, як у `calendar.txt`).
- HTTP: `ETag: "<revision>"`, `Last-Modified` = та сама дата, `Cache-Control: public, max-age=300`;
  `If-None-Match` → 304 (Express перевіряє сам, коли ETag уже стоїть). Споживач перевіряє зміни одним
  умовним GET без завантаження zip.
- Кеш у пам'яті процесу: `{ revision, files, zip }`; на кожен запит — один `findUnique` `TransportMeta`
  (`currentTransportRevision`), і лише коли `revision` інша — повне `loadTransportDataset` + збірка. Два
  контейнери під час деплою мають кожен свій кеш — це нормально, обидва віддають одне й те саме.
- Zip **детермінований** для однієї `revision`: час файлів у zip = дата `revision`, порядок файлів фіксований,
  стиснення `zlib.deflateRawSync` з типовим рівнем — ті самі байти на обох контейнерах і після рестарту.
  Zip пишемо самі (`backend/src/zip.ts`, ~80 рядків: local header + central directory + EOCD, CRC-32
  таблицею) — у Railway-контейнері немає гарантії системного `zip`, а тягнути `archiver` заради восьми
  файлів не варто.
- `dataset.json` знімок: `revision` уже всередині файлу (поле `revision`); на сторінці «станом на» береться
  з `useTransportDataset().dataAsOf` (жива `revision`, або час копії).
- Ліцензія в zip: `feed_info.txt` за спецификацією **не має** поля ліцензії (є `feed_publisher_*`,
  `feed_contact_email`, `feed_contact_url`, `feed_version`), і нестандартні колонки ми не додаємо, щоб
  валідатор MobilityData не сипав `unknown_column`. Тому ліцензія їде як окремий `LICENSE.txt` у zip (назва,
  URL, атрибуція «Дані: malin.kiev.ua», `feed_version`), а `feed_contact_url` веде на блок «Дані відкриті»
  (`https://malin.kiev.ua/transport/scheme#open-data`). У каталогах етапу 4 ліцензія — окреме поле.

### Що саме в фіді

Те саме, що й у `npm run export:gtfs` (`Docs/local-transport-gtfs-feed.md`): лише рейси з `departureTime`;
маршрути з прапорцем `unreliable` («Ненадійний — приховати») **не потрапляють** — ні в `routes.txt`, ні в
`trips.txt` / `stop_times.txt` / `shapes.txt`; `mapOnly`-точки лише в `shapes.txt`; варіанти шляху й опорні
часи через `buildTripStopTimes` (`gtfs-stop-times.ts`). Генерацію винесено в `backend/src/gtfs-feed.ts`
(`buildGtfsFeed(dataset, { revision }) → { files, stats }`, чиста функція без fs), скрипт лишається обгорткою,
яка пише ті самі файли в `data/malyn-transport/gtfs/` (тепер без системного `zip`).

### Сторінка

Блок «Дані відкриті» (`<section id="open-data">`) унизу `/transport/scheme`, під абзацом про плакат: один
рядок пояснення, дві кнопки — «Завантажити розклад (GTFS)» (`${API_URL}/transport/gtfs.zip`) і «Дані у JSON»
(`/transport/dataset.json`, атрибут `download`), рядок «Ліцензія CC BY 4.0 · станом на 14.10.2026 · як
відкрити» (посилання на `Docs/transport-open-data.md` у GitHub — репозиторій публічний). Посилання статичні
(під пререндером рендеряться як є; «станом на» — лише коли є `dataAsOf`). GA: `transport_data_download`
`{ format: gtfs | json }`.

## Чекліст

Фаза 0 — файл відновлення
- [x] **0.1** Цей файл; рядок-посилання з таблиці етапів у `Docs/transport-pwa-2026-10.md`

Фаза 1 — публічний GTFS (бекенд)
- [x] **1.1** `backend/src/zip.ts`: `buildZip(entries, { mtime })` — store/deflate, CRC-32, детермінований; тест
- [x] **1.2** `backend/src/gtfs-feed.ts`: `buildGtfsFeed(dataset, { revision })` — 8 `txt` + `LICENSE.txt`,
  `feed_version = revision`, `OPEN_DATA_LICENSE`, статистика; `unreliable` поза фідом; `zipGtfsFeed(files, revision)`
- [x] **1.3** `scripts/export-gtfs.ts` → обгортка над `buildGtfsFeed` (ті самі файли в `data/…/gtfs/`, zip без CLI)
- [x] **1.4** `routes/transport.ts`: `GET /transport/gtfs.zip`, `GET /transport/gtfs/:file`; кеш за `revision`;
  `Cache-Control: public, max-age=300`, `ETag`, `Last-Modified`, `Content-Disposition`; порожня БД → 404
- [x] **1.5** Тести: `gtfs-feed.test.ts` (вміст, `unreliable`, `feed_version`, LICENSE), `zip.test.ts` (розпакування
  через `zlib.inflateRawSync` за заголовками), `transport-http.test.ts` (zip-відповідь, заголовки, 304, кеш за
  `revision`, 404 файлу/порожньої БД)
- [x] **1.6** `backend/dist` перезібрано і закомічено разом із src; `CLAUDE.md` — абзац про GTFS-ендпоінт

Фаза 2 — сторінка (фронтенд)
- [x] **2.1** `LocalTransportPage/openData.ts`: `OPEN_DATA_LICENSE`, `GTFS_FEED_URL`, `DATASET_JSON_URL`, `OPEN_DATA_DOC_URL`
- [x] **2.2** `LocalTransportSchemePage.tsx`: блок «Дані відкриті» (`#open-data`), кнопки, ліцензія, «станом на»;
  CSS у `LocalTransportSchemePage.css`
- [x] **2.3** GA `transport_data_download` `{ format }` + рядок у `Docs/transport-analytics.md`
- [x] **2.4** Тести в `LocalTransportSchemePage.test.tsx` (href обох кнопок, ліцензія, «станом на» з revision, GA-подія)

Фаза 3 — документація
- [x] **3.1** `Docs/transport-open-data.md` для людей: що за файли, як відкрити (OpenTripPlanner, gtfs-validator,
  QGIS/Python), версія й оновлення, ліцензія й атрибуція
- [x] **3.2** `/support/transport`: короткий розділ «Дані відкриті» (TOC `city-open-data`) з посиланнями
- [x] **3.3** `frontend/public/llms.txt`: рядки про GTFS і JSON

Фаза 4 — особисті дані (зроблено 2026-10-20, гілка `personal-data-phase4`; план — розділ «Фаза 4 — план» нижче)
- [x] **4.0** Файл відновлення дописано; worktree від `main` (#97), `node_modules` — символьні посилання на основний чекаут
- [x] **4.1-auth** `backend/src/telegram-login-auth.ts`: перевірка підпису віджета (HMAC-SHA256, ключ sha256(`TELEGRAM_BOT_TOKEN`),
  `auth_date` ≤ 1 доба) із заголовка `X-Telegram-Login` (base64url JSON відповіді віджета); `requireTelegramLogin` на всіх
  `/user/*` — 401 `{ reason: missing | malformed | invalid | expired }`, 503 без токена; `createApp({ telegramBotToken })`;
  фронтенд: `utils/telegramLogin.ts` шле заголовок з `userState.getTelegramUser()`, `/user` на 401 просить увійти знову
- [x] **4.1** `person-data-export.ts` `collectPersonData(prisma, { telegramUserId })` → `GET /user/export`
  (`Content-Disposition: attachment; filename="malin-kiev-ua-my-data-<дата>.json"`) і `/mydata` у боті (`sendDocument`);
  кнопка «Завантажити мої дані» в розділі «Мої дані» на `/user`
- [x] **4.2** `person-erase.ts` `erasePerson(prisma, { telegramUserId, now })` у транзакції → `DELETE /user { confirm: true }`
  і `/deleteme` з inline-підтвердженням у боті; на `/user` — «Видалити акаунт» з підтвердженням; власнику — повідомлення в
  адмін-чат; політика на `/about` («Строки зберігання», «Ваші права») описує, що саме стирається
- [x] **4.3** `LocalTransportPage/transportPrefs.ts` + `TransportPrefsPanel.tsx` у блоці «Дані відкриті» на `/transport/scheme`:
  «Зберегти налаштування у файл» (`malin-transport-prefs.json`, `{ version: 1, site, exportedAt, frequentToStops }`),
  «Відновити з файлу» (лише назви зупинок із датасету, імпортоване наперед, ≤ 5), «Очистити мої дані на цьому пристрої»
  (ключі транспорту + кеші `malin-transport-*`); GA `transport_prefs { action, count }`
- [x] **4.4** Тести: backend `telegram-login-auth`, `person-data-export`, `person-erase`, `user-profile-http`, `telegram-mydata`;
  frontend `telegramLogin`, `UserPage`, `transportPrefs`, `LocalTransportSchemePage` (+1), `CompanyLegalPage` (+1)
- [x] **4.5** Документація: `Docs/transport-open-data.md` «Ваші дані», `llms.txt`, `CLAUDE.md`, `Docs/transport-pwa-smoke.md`
  «Мої дані (з телефона)», `Docs/manifesto-communication-2026-10.md` (П4 → зроблено), `backend/dist` перезібрано
- [x] **4.6** Кейс на own-net.com: рядок П4 у `cases/malin/index.html` → «done» з адресами-доказами у трьох мовах (гілка
  `case-malin-p4-done` в `merenkoff/internet4`), `/about` згадує експорт і видалення

## Пастки

1. Express `res.send(Buffer)` сам ставить `ETag`, **якщо його ще нема**, і сам відповідає 304 на `If-None-Match`
   (`req.fresh`) — тож ETag треба виставити до `send`, а 304 окремо не кодувати.
2. `compression` пропускає `application/zip` (не стискається), а `text/plain` файли фіду гзипує — це нормально,
   `ETag` лишається сильним, `Vary: Accept-Encoding` додає middleware.
3. `TransportMeta` у HTTP-стабі `transport-http.test.ts` тримає `updatedAt` лише якщо тест його поклав — для
   тестів кешу/ETag стаб має віддавати `updatedAt`, і PUT має його бампати (перевірити `replaceTransportDataset`
   → `upsert` у стабі).
4. Системний `zip` у скрипті більше не потрібен; старий zip у `data/` перезапишеться новим форматом (інший
   порядок/час файлів) — це очікувано, не «регресія».
5. `download`-атрибут працює лише для same-origin — для GTFS на домені API він ні на що не впливає, завантаження
   забезпечує `Content-Disposition` на бекенді.

## Фаза 4 — план (особисті дані, наступна сесія)

Та сама П4, але про дані **про людину**, а не про розклад: що сайт і бот знають про мене, забрати це файлом,
видалити. Сьогодні політика конфіденційності на `/about` («Ваші права») обіцяє це лише листом на пошту
власника. Код — у наступній сесії зі своїм файлом відновлення; тут — обсяг і межі, щоб не вигадувати заново.

**Передумова (знайдено 2026-10-16): автентифікація.** `GET /user/profile?telegramUserId=` і
`PUT /user/profile/name` вірять голому `telegramUserId` з query/body — хто знає чужий id, читає чужі бронювання.
Експорт і тим паче видалення так будувати **не можна**. Спочатку: бекенд перевіряє підпис Telegram Login
(`hash` + `auth_date` ≤ 1 доба, HMAC-SHA256 з `sha256(TELEGRAM_BOT_TOKEN)`, як у
[документації віджета](https://core.telegram.org/widgets/login#checking-authorization)); фронтенд уже тримає
відповідь віджета в `userState.getTelegramUser()` — передавати її цілком заголовком. Існуючі два ендпоінти
перевести на ту саму перевірку (це окремий, перший коміт фази; старі клієнти без `hash` → 401).

**4.1 Що віддавати («мої дані»).** Один JSON `malin-kiev-ua-my-data-<дата>.json` з усього, що прив'язане до
людини (ключ — `Person` за `telegramUserId`, плюс рядки за `telegramUserId` / `phoneNormalized` там, де FK на
`Person` нема):

| джерело | що | примітка |
|---|---|---|
| `Person` | ім'я, телефон, `telegramUsername`, `createdAt`, прапорці блокування | без `accessHash`, без технічних `telegram*SentAt` |
| `Booking` (+ `BookingReminder`) | усі бронювання «Зубастика», не лише з сьогодні | `personId`, а для старих рядків — `telegramUserId` / `phone` |
| `ViberListing` (`personId`) + `ViberRideEvent` | оголошення попуток і їх історія | тільки свої |
| `RideShareRequest` | запити на попутки | за `personId` |
| `ReferralInvite` / `ReferralReward` / виплати | акція «Приведи друга» | друга — лише як «є», без його даних |
| `DzhuraMessage` / `DzhuraPerson` (`tgUserId` = `Person.telegramUserId`) | захоплені повідомлення з групи PoDoroguem, де людина автор | тільки власні повідомлення; чужі відповіді — ні |
| `LunchOrder*` | якщо людина в обідньому боті | за `Person` |

Не віддаємо: чужі дані в тих самих рядках (телефон водія в моєму бронюванні — лише ім'я/маршрут), внутрішні
`telegramChatId`, `accessHash`, службові мітки антиспаму. Форма — `GET /user/export` → JSON (`Content-Disposition`),
у боті — команда `/mydata` з тим самим файлом як документ (`sendDocument`), обидва з одного `collectPersonData(prisma,
person)` (чиста функція, тест на стабі).

**4.2 Видалення.** `DELETE /user` і `/deleteme` в боті з підтвердженням (кнопка в боті / повторний клік на сайті).
Що саме: `Person` → анонімізувати, не видаляти рядок (на нього дивляться `Booking.personId` / `ViberListing.personId` з `SetNull`, рефералка з `Cascade`;
`Booking` ще тримає копії `phone` і `telegramUserId` — їх теж знеособити): телефон → технічний `380000000000+id`, ім'я → «Видалений користувач», `telegram*` → null,
`telegramBotBlockedAt` → зараз (щоб бот більше не писав). Активні оголошення й бронювання на майбутнє — зняти
(`isActive=false`, бронювання → `cancelled` з повідомленням адмінці, як у `/cancel`). Історію бронювань і
`ViberRideEvent` лишаємо без прив'язки (потрібні для статистики, уже знеособлені). Рефералка: нараховані
винагороди не зникають — про це сказати в підтвердженні. Дзюра: `DzhuraMessage` людини — видалити текст, лишити
факт (`text: ''`, прапор `deletedByAuthor`), бо чужі відповіді на нього лишаються. Виконавець — одна функція
`erasePerson(prisma, person, now)` у транзакції, тест на стабі з усіма таблицями.

**4.3 `/user`.** Два рядки внизу профілю: «Завантажити мої дані» і «Видалити акаунт» (друге — червоне, з
діалогом). Політика конфіденційності на `/about` («Ваші права») отримує речення «або самі на сторінці
профілю / командою в боті»; пошта лишається як запасний шлях.

**4.4 Часті зупинки — експорт/імпорт файлом.** Сьогодні на пристрої в localStorage: `lt.frequentToStops` (до 5 назв
«куди», `LocalTransportPage.tsx`), `sticker-origin` (перша наклейка), `transport-dataset:v1`, `transport-outbox:v1`,
`site-local-transport:<city>`, `transport-install-hint`. Особисте тут — лише часті зупинки й (слабко) наклейка;
решта — кеш. Обсяг: на планері поруч із чіпами «Часто їду в…» — «Зберегти список» (`malin-transport-prefs.json`:
`{ version: 1, frequentToStops: [...] }`, посилання `download` з `Blob`) і «Відновити» (`<input type=file>`,
валідація: масив рядків ≤ 5, лише назви зупинок із датасету; злиття — імпортоване наперед). Без бекенду, без акаунта:
саме для перенесення на новий телефон і для «встановленого застосунку», коли сайту вже нема (етап 5.4). Ключ
лишається `lt.frequentToStops`, формат файлу версіонований. Там же — «Очистити мої дані на цьому пристрої» (усі
ключі вище + кеші воркера) — для спільного телефона.

**4.5 Що не входить.** Експорт для людей без Telegram-входу (телефон як ідентифікатор — не підтверджений, видавати
дані за ним не можна); видалення з резервних копій БД (Railway робить їх сам — описати в політиці «до 30 днів»);
дані з Google Analytics (їх і так нема в нас — лише в Google).

Порядок у наступній сесії: 4.0 файл відновлення → 4.1-auth (перевірка підпису) → 4.1 експорт → 4.2 видалення →
4.3 `/user` + політика → 4.4 часті зупинки. Кожна — окремий коміт; бекенд → `dist` разом із src.

## Знахідки по фазах

### Фаза 4 — особисті дані (зроблено, 2026-10-20)

- **Авторизація — лише за підписом віджета.** Старий `GET /user/profile?telegramUserId=` і `PUT /user/profile/name`
  з `telegramUserId` у тілі тепер 401: ідентичність береться з `X-Telegram-Login` (відповідь віджета цілком; наш `phone`
  у рядок перевірки не входить — підписані лише `id, first_name, last_name, username, photo_url, auth_date`). Підпис
  живе добу, як радить документація віджета: сторінка `/user` на 401 показує «увійдіть ще раз» з посиланням на `/login`.
  Вхід «за телефоном» (`LoginPage.handlePhoneLogin`, `id: 0, hash: ''`) ніколи не мав справжнього профілю — тепер він чесно
  отримує 401 замість порожнього профілю. Решту особистих маршрутів поза `/user/*` — `DELETE /bookings/:id/by-user`,
  `PATCH /viber-listings/:id/by-user`, `…/deactivate/by-user`, `POST /rideshare/request` (сайт, `createRideShareRequestFromSite`)
  — переведено на той самий `requireTelegramLogin` окремим слідом (гілка `user-auth-signed-login`, 2026-10-20):
  `telegramUserId` у тілі ігнорується, власник/пасажир — лише з `X-Telegram-Login`; `createApp` роздає один
  `telegramBotToken` усім чотирьом роутерам. Фронтенд: ті чотири методи `apiClient` шлють `telegramLoginHeaders()` без
  id у тілі, `/user` на 401 показує те саме «увійдіть ще раз» для скасування/редагування, дошка `/mizhgorodski` — текст
  `RIDESHARE_LOGIN_STALE_MESSAGE` у `useRideShareRequest`. Тести: `backend/src/person-scoped-telegram-login-http.test.ts`,
  `frontend/src/hooks/useRideShareRequest.test.tsx`, `UserPage.test.tsx`. Слід закрито.
- `vitest.setup.ts` стирає `TELEGRAM_BOT_TOKEN` до імпортів, тому HTTP-тести передають `createApp({ telegramBotToken })`;
  у проді токен той самий, що й у бота. Без токена `/user/*` відповідає 503, а не пропускає без перевірки (локально без
  бота профіль не відкриється — це свідомо).
- **Експорт** — один збирач `collectPersonData` для сайту й бота: Person без `telegramChatId`/`accessHash`, бронювання
  за `personId` **або** `telegramUserId` (старі рядки), ім'я водія без телефону, запрошення без контакту друга, нарахування
  другові — лише кількість, Дзюра — лише власні повідомлення (`DzhuraPerson.tgUserId = telegramUserId`), обіди — замовлення
  й платежі, SMS — привід і статус. `null`, коли нема жодного рядка → 404 «експортувати нічого».
- **Видалення ≠ адмінська архівація** (`person-archive.ts`): знімка не лишаємо, номер **не** забороняємо (людина
  може повернутися — буде новий Person), рядки з FK не видаляємо, а знеособлюємо. Технічний телефон стертого —
  `380000` + id з нулями (`technicalPhoneForErased`), `isTechnicalPlaceholderPhone` тепер знає обидва діапазони
  (`3800100…` username-only і `380000…`), тож платних SMS і видачі контакту на нього не буде. Майбутні бронювання —
  `deleteMany` (як `/cancel`; нагадування каскадом), минулі — ім'я/телефон/telegram знеособлено. Нарахування «Приведи
  друга» не зникають (гаманець): свої — без `payoutNote`, невиплачені другові — `flagged` для перевірки адміном, як в
  архівації; про це сказано в підтвердженні. `Booking` не має статусу `cancelled` — план уточнено: видаляємо.
- Дзюра: `DzhuraMessage.text = ''`, `rawJson`/`editHistoryJson` → `Prisma.DbNull`, `deletedAt = now` (окремого прапора
  `deletedByAuthor` нема — міграції уникнули); `DzhuraPerson` лишається (ключ `tgUserId` для нових повідомлень), ім'я й
  телефон → null. **Пастка:** `db.py` пише `ON CONFLICT … DO UPDATE SET text = EXCLUDED.text` — повний backfill
  (`fullFetch`) старої історії повернув би текст; gap-fill після пауз читає лише від `lastCapturedTgMessageId`, тож
  у звичайному режимі стерте не повертається.
- Бот: `/mydata` і `/deleteme` — модульні `handleMyDataCommand` / `handleDeleteMeCommand` / `handleDeleteMeCallback`
  (експортовані, тести на `setTelegramBotForTests` + `setTelegramPrismaForTests`), inline-кнопки `deleteme_confirm` /
  `deleteme_cancel`, після натискання клавіатура знімається (`editMessageReplyMarkup`). Додано в `CLIENT_BOT_COMMANDS` і
  `/help`; у reply-меню не додавали (меню — дії щодня, видалення — ні).
- Файл налаштувань транспорту: особисте в localStorage — лише `lt.frequentToStops`; «Очистити» стирає і анонімний
  `arrival-report-client`, `sticker-origin`, кеш датасету/черги, `site-local-transport:*` і кеші воркера
  `malin-transport-*`, але не `user_state`. Імпорт звіряє назви з датасетом (перейменовані зупинки пропускаються з
  підрахунком). Панель — у блоці «Дані відкриті» (`role="group"`), а не на планері: `LocalTransportPage.tsx` на 2000 рядків
  чіпати не стали, ключ той самий.
- `/about#privacy-policy` — саме такий id у `PRIVACY_SECTION_ID` (не `#privacy`); посилання на профіль відносне (`/user`),
  політика каже «якщо входу через Telegram у вас нема — пошта», резервні копії Railway — «до 30 днів».
- Перевірки: backend 78 файлів / 656 ✅ + 1 skipped, `tsc` чистий, `dist` перезібрано (змінені `create-app.js`,
  `routes/user-profile.js`, `telegram-contact.js`, `telegram.js`; нові `person-data-export.js`, `person-erase.js`,
  `telegram-login-auth.js`); frontend 93 файли / 660 ✅, eslint і `tsc` чисті. У браузері не перевірялося: Telegram Login
  Widget прив'язаний до домену бота, тож `/user` локально не відкрити — пункти для телефона в `Docs/transport-pwa-smoke.md`.

### Підсумок сесії (2026-10-20, фаза 4)

- Гілки: `personal-data-phase4` у `drivling/kyiv-malyn-booking` (4 коміти: бекенд + dist; `/user` і політика; файл
  налаштувань; документація) —
  <https://github.com/drivling/kyiv-malyn-booking/compare/main...personal-data-phase4?expand=1>;
  `case-malin-p4-done` у `merenkoff/internet4` (рядок П4 → «зроблено», три мови) —
  <https://github.com/merenkoff/internet4/compare/main...case-malin-p4-done?expand=1>. PR відкриває власник (`gh` дає 403).
- Свідомо не зроблено (у цій гілці; підпис на `…/by-user` і `rideshare …FromSite` дороблено слідом — див. «Знахідки»): експорт
  для людей без входу через Telegram (телефон не підтверджений — план 4.5); видалення з резервних копій (у політиці «до 30
  днів»); прапор `deletedByAuthor` у `DzhuraMessage` (замість нього `deletedAt`, без міграції); кнопки «Мої дані» в
  reply-меню бота (лише команди й `/help`).

### Фаза 3 — документація (зроблено, 2026-10-16)

- `Docs/transport-open-data.md` — для людей, українською: таблиця адрес, що в кожному файлі фіду, версії й
  умовний GET, рецепти (валідатор MobilityData у Docker, OpenTripPlanner 2.5 з OSM-витягом, pandas, QGIS),
  ліцензія з текстом атрибуції, «чого поки нема» (GTFS-RT, каталоги — етап 4, міжміські).
- `/support/transport`: розділ «Дані відкриті» між «Проїзд» і FAQ (TOC `city-open-data`), константи беруться з
  `openData.ts` — одне місце для URL і ліцензії. Тестів на статтю допомоги в репо нема (і не було) — перевірено в
  браузері: TOC-посилання, розділ, перехід на `/transport/scheme#open-data` (сторінка коротка, блок у видимій частині).
- `llms.txt`: окремий розділ «Відкриті дані» з чотирма адресами і ліцензією — щоб ШІ-відповіді про «де взяти розклад
  Малина» вели на фід, а не на скриншоти.

### Фаза 2 — блок «Дані відкриті» (зроблено, 2026-10-16)

- `openData.ts` — лише константи (URL, ліцензія, тип формату): eslint `react-refresh/only-export-components` не пускає
  їх у файл сторінки. `GTFS_FEED_URL` з `API_URL` — у тестах це `http://localhost:3000` (`TEST_API_URL`).
- Блок — `<section id="open-data" aria-labelledby>` → `role="region"` у тестах; `rel="license"` на посиланні ліцензії,
  `download` лише на JSON (same-origin). Існуючий тест «Показати всі → жодного h2» звужено до заголовка картки, бо
  тепер на сторінці завжди є h2 «Дані відкриті».
- «станом на» — `formatDataAsOf(dataAsOf)` з хука, тобто жива `revision` (на проді 2026-10-16 показує 14.10.2026);
  у jsdom-тесті датасет без `revision` дає час копії, тому тест на дату кладе `revision` у відповідь MSW і чистить
  кеш хука до/після.
- Перевірено в браузері на dev-сервері з прод-API (`VITE_API_URL=…railway.app`, тимчасовий запис у
  `.claude/launch.json`, прибрано): блок під абзацом про плакат, кнопки, ліцензія, дата. Сам `gtfs.zip` на проді
  з'явиться після деплою бекенду — до того кнопка GTFS на проді дає 404.
- Тести: `LocalTransportSchemePage.test.tsx` +2 (посилання/ліцензія/дата, GA-подія); frontend 87 файлів: 623 ✅ + 2 ❌ у
  `stickerSvg.test.ts` лише через стаб `uqr` (як в етапі 2); `tsc` і eslint чисті.

### Фаза 1 — публічний GTFS (зроблено, 2026-10-16)

- `buildGtfsFeed` — перенесений один в один код старого скрипта мінус `fs`: таблиці повертаються рядками, статистика —
  об'єктом; скрипт друкує те саме, що й раніше, плюс `feed_version`. Старий zip у `data/malyn-transport/gtfs/` не
  перегенеровано (потрібна жива БД) — наступний `npm run export:gtfs` перепише його новим форматом.
- `zip.ts`: deflate лише коли він справді коротший (порожній/дрібний файл — store), біт UTF-8 у прапорцях — кириличні
  назви зупинок у `stops.txt` розпаковуються коректно; DOS-час з revision (роздільність 2 с, UTC-поля як є).
- Провайдер кешу single-flight: паралельні перші запити ділять одну збірку (`building`), тест із `Promise.all`
  перевіряє один `findMany`. На кожен запит один `findUnique` `TransportMeta` — дешевше за 150 КБ датасету.
- `GET /transport/gtfs/:file` з `..%2Findex.js` → 404 (ім'я перевіряється за списком, не за файловою системою).
- 304: Express сам порівнює `If-None-Match` з виставленим `ETag` у `res.send` — окремого коду нема (перевірено тестом).
- Тести: `zip.test.ts` 3, `gtfs-feed.test.ts` 6, `transport-http.test.ts` +4; backend 69 файлів / 601 ✅, `tsc` чистий;
  `dist`: `routes/transport.js`, `scripts/export-gtfs.js` змінені, `gtfs-feed.js`, `zip.js` нові.

### Фаза 0 (2026-10-16)

- Локальне середовище як в етапі 2: husky не активний, `compression` / `uqr` не встановлені — тимчасові стаби в
  `node_modules` (символьні посилання на основний чекаут), видалити після сесії. Базова лінія: backend 67 файлів /
  588 тестів ✅, `tsc` чистий, `dist` збігається з `src`.
- Репозиторій `drivling/kyiv-malyn-booking` публічний — на `Docs/transport-open-data.md` можна посилатися з сайту.

### Підсумок сесії (2026-10-16)

- Фінальні перевірки: backend 69 файлів / 601 ✅ (`tsc` чистий, `dist` = `src`); frontend 87 файлів: 623 ✅ + 2 ❌ у
  `stickerSvg.test.ts` лише через стаб `uqr` (env-only, як в етапах 1–2), eslint і `tsc` чисті. Стаби
  `compression` / `uqr` з `node_modules` основного чекауту прибрано.
- Для наступної сесії (фаза 4) найважливіша знахідка — `/user/profile` без перевірки підпису Telegram Login
  (розділ «Фаза 4 — план», передумова).
