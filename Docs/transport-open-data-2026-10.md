# Дані належать людині: відкритий GTFS і JSON транспорту Малина

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ⏳ · Фаза 3 ⏳ · Фаза 4 — лише план  
**Де зупинились:** фази 0–1 закомічені; далі фаза 2 — блок «Дані відкриті» на `/transport/scheme`  
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
| ліцензія даних | ⏳ власник (пропозиція CC BY 4.0; код шле її за замовчуванням) |

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
- [ ] **2.1** `LocalTransportPage/openData.ts`: `OPEN_DATA_LICENSE`, `GTFS_FEED_URL`, `DATASET_JSON_URL`, `OPEN_DATA_DOC_URL`
- [ ] **2.2** `LocalTransportSchemePage.tsx`: блок «Дані відкриті» (`#open-data`), кнопки, ліцензія, «станом на»;
  CSS у `LocalTransportSchemePage.css`
- [ ] **2.3** GA `transport_data_download` `{ format }` + рядок у `Docs/transport-analytics.md`
- [ ] **2.4** Тести в `LocalTransportSchemePage.test.tsx` (href обох кнопок, ліцензія, «станом на» з revision, GA-подія)

Фаза 3 — документація
- [ ] **3.1** `Docs/transport-open-data.md` для людей: що за файли, як відкрити (OpenTripPlanner, gtfs-validator,
  QGIS/Python), версія й оновлення, ліцензія й атрибуція
- [ ] **3.2** `/support/transport`: короткий розділ «Дані відкриті» (TOC `city-open-data`) з посиланнями
- [ ] **3.3** `frontend/public/llms.txt`: рядки про GTFS і JSON

Фаза 4 — особисті дані (лише план, код — наступна сесія)
- [ ] **4.1** Обсяг описано в розділі «Фаза 4 — план» нижче

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

_Заповнюється наприкінці цієї сесії._

## Знахідки по фазах

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
