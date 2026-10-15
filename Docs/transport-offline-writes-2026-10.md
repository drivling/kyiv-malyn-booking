# Записи без мережі: outbox для табло транспорту

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ⏳ · Фаза 3 ⏳ · Фаза 4 ⏳  
**Де зупинились:** фази 0–1 закомічені й запушені (сесію перервав ліміт використання 2026-10-15); далі — фаза 2 (бекенд: `occurredAt` + `clientEventId`, міграція, `backend/dist`), потім 3 і 4; перед суїтами знову поставити стаби `compression` / `uqr` (див. «Фаза 0» у знахідках) — їх після сесії видалено  
**Created:** 2026-10-15 · **Гілка:** `merenkoff/eloquent-lalande-e7938b` (від `main` після #86)

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт. Це **етап 2** великого плану «malin.kiev.ua за маніфестом own-net» — таблиця етапів і
рішення власника в [`Docs/transport-pwa-2026-10.md`](transport-pwa-2026-10.md) (етап 1, «Табло без мережі»:
копія датасету, знімок збірки, service worker, встановлення — задеплоєно #82, #83, #85, #86).

## Що не так сьогодні (перевірено 2026-10-15)

Табло відкривається без мережі (етап 1), але все, що людина на ньому **робить**, без мережі губиться:

- `POST /transport/sticker-scans` і `POST /transport/sticker-returns` — fire-and-forget у `stickerScan.ts` /
  `stickerReturn.ts` (`.catch(() => undefined)`): QR-скан на зупинці без зв'язку не потрапляє в лічильники адмінки.
- `POST /transport/arrival-reports` — `ArrivalReportSheet.tsx` показує «Не вдалося надіслати. Перевірте зʼєднання»,
  і людина, яка щойно бачила автобус, нічого не може з цим зробити. Повторити пізніше теж не можна: сервер бере
  **свій** час отримання і відкидає все поза ±90 хв від розкладу (422), а факт прибуття — саме подія «зараз».
- Service worker (`sw/transport-sw.js`) свідомо не чіпає не-GET запити й крос-доменний API — черга має жити в
  сторінці, а не у воркері; Background Sync не використовуємо (етап 1, таблиця «запит → дія SW»).

Бекенд: `sticker-scans` / `sticker-returns` **безпечно повторювати** — дедуп лише в пам'яті процесу
(`createScanDeduper`: 2 хв за IP+UA для сканів, 30 хв за `clientId` для повернень, `backend/src/sticker-scans.ts`),
тобто після рестарту контейнера повтор порахується ще раз. `arrival-reports` повторювати **не можна** без змін
бекенду: час бере сервер, дедуп — 10 хв за IP (`routes/transport.ts`).

## Рішення

**Outbox — у сторінці, у localStorage, один на всі три записи.** `frontend/src/pwa/outbox.ts`, ключ
`transport-outbox:v1`, масив записів `{ id, kind, key, body, createdAt, attempts }`, `kind ∈ sticker-scan |
sticker-return | arrival-report`. Не у воркері: API крос-доменний, воркер не-GET не чіпає; не IndexedDB: записів
десятки, а не тисячі, і localStorage уже тримає копію датасету (`transport-dataset:v1`).

- **Коли в чергу.** `sendOrQueue(kind, body, key)`: без мережі (`!navigator.onLine`, `isOnline()` з `useOnline.ts`)
  — одразу в чергу; з мережею — спроба надіслати, і в чергу лише коли помилка **повторювана**: мережева
  (`TypeError` від `fetch`, таймаут) або 5xx. Відповідь 4xx (400 невалідне тіло, 404 невідомий рейс/зупинка,
  422 поза вікном) — **не** повторювана: запис викидається, викликач бачить помилку як і раніше.
- **Коли повторювати.** `flushOutbox()` — single-flight, по черзі в порядку додавання: подія `online`,
  відкриття сторінки (`useOutboxSync()` в `App.tsx`), повернення до вкладки (`visibilitychange` → visible) і
  **успішний** `GET /transport/dataset` (`adoptNetwork` в `useTransportDataset.ts` — доказ, що API відповідає, а не
  лише що є Wi-Fi). Повторювана помилка зупиняє прохід (мережі, найімовірніше, нема) — наступний тригер спробує
  знову; `navigator.locks` (`ifAvailable`), де є, щоб дві вкладки не слали одне й те саме одночасно.
- **Дедуп на клієнті за ключем**, бо серверний живе лише в пам'яті процесу: запис із тим самим `key` замінює
  попередній у черзі. Ключі (київська доба з `kyivTime.ts`):
  `scan:<stopId>-<side>:<YYYY-MM-DD>`, `return:<stopId>-<side>:<YYYY-MM-DD>`,
  `arrival:<tripId>:<stopId>:<YYYY-MM-DD>:<kind>` (як серверний ключ дедупу «рейс · зупинка · доба · вид»).
- **Межі черги.** ≤ 50 записів (найстаріші викидаються), ≤ 7 днів (прострочені не надсилаються — звіт про рейс
  тижневої давнини нікому не потрібен, а бекенд його все одно відкине), ≤ 10 спроб на запис (щоб запис, який
  сервер стабільно не приймає 5xx, не жив вічно). Без localStorage (приватний режим Safari) черги нема — як і
  раніше, запис просто не доходить.
- **Арrival-reports: час події і ідемпотентність на бекенді** (фаза 2). Тіло отримує `occurredAt` (ISO, момент
  натискання за годинником телефона) і `clientEventId` (UUID запису в outbox) поруч із `clientId`.
  `buildArrivalRow(input, now)` рахує `actualTime` / `serviceDate` / вікна ±90 і −5…+180 хв від `occurredAt`, а не
  від моменту отримання. Запобіжники: `occurredAt` більш як на 5 хв у майбутньому (годинник телефона поспішає)
  → беремо серверний «зараз»; старший за 7 днів → 422 `too_old`. Повтор із тим самим `clientId + clientEventId`
  (запис дійшов, відповідь — ні) → 200 `{ counted: false }` з уже збереженими `actualTime` / `delayMin`;
  гарантія — унікальний індекс `(clientId, clientEventId)` у `TransportArrivalReport` (міграція), гонка двох
  вкладок ловиться за P2002. Дедуп за IP на 10 хв лишається для клієнтів без `clientEventId`. `createdAt` і далі
  — час отримання: за різницею з `serviceDate + actualTime` в адмінці видно, що звіт приїхав із черги.
- **Фронтенд «Факту прибуття»** (фаза 3): панель рахує текст сама (`actual = now − minutesAgo`, `clockDiff`) і
  показує «Запишемо: автобус приїхав о HH:MM — … Надішлемо, щойно з'явиться мережа» замість помилки; GA-подія
  `transport_arrival_report` іде в момент дії людини (і для черги теж), доставка — окрема подія
  `transport_outbox` (`kind`, `result: queued | sent | rejected | dropped`).
- **Смужка стану** (фаза 4): `TransportStatusBar` сам читає `useOutboxPending()`; без мережі — «Без мережі —
  розклад станом на … · 2 записи чекають на мережу»; сервер мовчить — те саме доповнення до «Сервер не
  відповідає…»; мережа є, помилок нема, а черга не порожня (наприклад, 5xx) — «2 записи чекають на мережу» і
  кнопка «Надіслати» (`flushOutbox()`). Відмінки: 1 запис чекає · 2–4 записи чекають · 5+ записів чекають.
- **Без змін у service worker**, без Background Sync, без змін у публічному API крім двох нових необов'язкових
  полів `arrival-reports` — старі клієнти (вкладки до деплою) працюють як досі.

## Чекліст

Фаза 0 — файл відновлення
- [x] **0.1** Цей файл; рядок-посилання з таблиці етапів у `Docs/transport-pwa-2026-10.md`

Фаза 1 — outbox для наклейок (лише фронтенд)
- [x] **1.1** `src/pwa/outbox.ts`: `enqueueOutbox`, `flushOutbox` (single-flight, `navigator.locks` де є),
  `sendOrQueue`, `isRetryableError`, `outboxPending` + `subscribeOutbox` + `useOutboxPending`, `useOutboxSync`;
  межі 50 / 7 днів / 10 спроб; дедуп за `key`; no-op під `isPrerendering()`
- [x] **1.2** `kyivTime.ts`: `getKyivDateString()` для ключів
- [x] **1.3** `stickerScan.ts`, `stickerReturn.ts` → `sendOrQueue`; `App.tsx` → `useOutboxSync()`;
  `useTransportDataset.ts` → `flushOutbox()` після успішного датасету
- [x] **1.4** `src/pwa/outbox.test.ts` (черга, дедуп, межі, повтор на `online`, 4xx викидається, 5xx лишається,
  ліміт спроб, хук), доповнення в `stickerScan`/`stickerReturn` тестах (офлайн → у черзі → `online` → POST)

Фаза 2 — бекенд: час події і ідемпотентність
- [ ] **2.1** `prisma/schema.prisma`: `TransportArrivalReport.clientEventId String?`, `@@unique([clientId,
  clientEventId])`; міграція `20261015120000_arrival_report_client_event_id`
- [ ] **2.2** `arrival-reports.ts`: `parseArrivalReport` читає `occurredAt` (ISO; невалідний → 400) і
  `clientEventId` (як `clientId`: невалідний → null); `buildArrivalRow` від `occurredAt` із запобіжниками
  (`MAX_CLOCK_AHEAD_MIN = 5`, `MAX_OCCURRED_AGE_DAYS = 7`, помилка `too_old`); рядок із `clientEventId`
- [ ] **2.3** `routes/transport.ts`: пошук за `(clientId, clientEventId)` → 200 `{ counted: false }`; P2002 → те
  саме; 422 для `too_old`
- [ ] **2.4** Тести в `arrival-reports.test.ts`; `backend/dist` перезібрано (`npm run build`) і закомічено разом із src
- [ ] **2.5** `frontend/src/types/index.ts`: `ArrivalReportBody.occurredAt?`, `clientEventId?`

Фаза 3 — «Факт прибуття» через outbox
- [ ] **3.1** `ArrivalReportSheet.tsx`: тіло з `occurredAt` + `clientEventId`, `sendOrQueue` з ключем
  `arrival:…`; стан `queued` з локально порахованим часом і текстом «Надішлемо, щойно з'явиться мережа»;
  4xx — помилка як досі (422 → «далеко від поточного часу»)
- [ ] **3.2** `ArrivalReport.test.tsx`: офлайн → без POST, текст черги, запис у outbox з `occurredAt` /
  `clientEventId` → `online` → POST з тим самим `clientEventId` → черга порожня; 500 → у черзі; 422 → помилка,
  не в черзі

Фаза 4 — смужка стану, документація
- [ ] **4.1** `TransportStatusBar.tsx`: `useOutboxPending()`, `pendingLabel(n)`, кнопка «Надіслати»; тести
- [ ] **4.2** `Docs/transport-analytics.md`: `transport_outbox`
- [ ] **4.3** `CLAUDE.md`: абзац про outbox у «Transport PWA»
- [ ] **4.4** `Docs/transport-pwa-smoke.md`: розділ «Записи без мережі»

## Пастки

1. `apiClient.request()` кидає `Error` зі `status` лише на HTTP-відповідь; мережева помилка — `TypeError` без
   `status`, таймаут датасету — `AbortError`. Повторюваність визначається саме відсутністю `status` у 4xx.
2. Київська доба в ключах, не локальна: телефон у іншому поясі (або з «автоматичним» поясом, що збився) не
   повинен ділити один скан на два записи.
3. `sessionStorage`-мітка «вже рахували» в `stickerScan.ts` ставиться **до** надсилання — це правильно: повтор
   робить outbox, а не ефект React.
4. `useTransportDataset.adoptNetwork` зветься і в `prerender-spa` (jsdom з реальним fetch): `flushOutbox` під
   `isPrerendering()` — no-op, інакше пререндер слав би POST на прод.
5. У jsdom `navigator.onLine` — `true` і не міняється сам: тести підміняють геттер через `Object.defineProperty`
   і шлють `new Event('online')`.
6. Тест ArrivalReport «a server error is shown» (500) після фази 3 **міняє сенс**: 500 — повторювана помилка →
   запис у черзі, а не alert; alert лишається для 4xx.

## Знахідки по фазах

### Фаза 0 (2026-10-15)

- Локальне середовище: husky не активний, `compression` (backend) і `uqr` (frontend) не встановлені — для суїт
  у сесії поставлено тимчасові стаби в `node_modules` (видалити після); у worktree `node_modules` — символьні
  посилання на основний чекаут. Базова лінія до змін: backend 67 файлів / 584 тести ✅, `tsc` чистий після
  `prisma generate` (клієнт у клоні був застарілий — `accessHash`), `dist` збігається з `src`; frontend 85 файлів,
  596 ✅ + 2 ❌ у `stickerSvg.test.ts` лише через стаб `uqr`.

### Фаза 1 — outbox для наклейок (зроблено, 2026-10-15)

- `useSyncExternalStore` для лічильника: `getSnapshot` — число, тож повторні виклики React не ламають; черга
  перечитується з localStorage (≤ 50 коротких записів — дешево), зміни з інших вкладок — через подію `storage`.
- `flushNow` після кожного запису перечитує чергу з localStorage (інша вкладка могла вже надіслати), а при
  невдалому записі в localStorage виходить із циклу — інакше запис, який не вдається видалити, крутився б вічно.
- `navigator.locks.request(…, { ifAvailable: true })` — у jsdom `locks` нема, тож тести йдуть без блокування;
  у браузері друга вкладка просто пропускає прохід.
- Тести: `outbox.test.ts` (20 кейсів разом із доповненнями в `stickerScan` / `stickerReturn`), eslint і `tsc` чисті.
