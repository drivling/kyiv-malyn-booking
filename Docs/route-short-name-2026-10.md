# Номер маршруту для показу (`shortName`) — «11/1» без зміни ключа

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ✅ · Фаза 3 ⬜ · Фаза 4 ⬜ · Фаза 5 ⬜ · Фаза 6 ⬜  
**Де зупинились:** фаза 3 — замінити показ номера в решті файлів (список нижче); фаза 2 зроблена  
**Created:** 2026-10-10 · **Гілка:** `feat/route-short-name`

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт.

## Що просив власник (2026-10-10)

«Номер «11/1» у заголовку — робимо назву, яка не ламає зв'язки: окреме поле або що порадиш як архітектор.
Щоб у майбутньому бути готовими до інших незвичних назв. І схема — саме назва має бути правильна всюди.»

## Рішення

- **Ключ і номер — різні речі.** `TransportRoute.id` («11») лишається ключем: адреси `/transport/route/11`,
  рейси `11-NN`, сегменти, кольори схеми `--lts-r11`, статті зупинок, GTFS `route_id`, факти прибуття.
- **Нове поле `TransportRoute.shortName`** — номер для показу («11/1», «5А», «Експрес»), як `route_short_name`
  у GTFS. Порожнє → показуємо id. Обмеження: до 16 символів, один рядок.
- **Одне джерело — база.** Сайт бере `shortName` з `/transport/dataset`; схема (SVG, легенда, плакат)
  генерується з того самого датасету. Після зміни номера в адмінці — перегенерувати схему (як після розкладу).
- **Один хелпер на фронтенді.** `routeNo(id)` у `routeNames.ts`: реєстр заповнює
  `apiClient.getTransportDataset()` (кожне завантаження датасету — сайт, адмінка, стіна); до завантаження —
  номери зі згенерованої легенди схеми. Усі «№…» міського транспорту йдуть через нього.
- **Старі клієнти не стирають номер.** `PUT /transport/dataset` без ключа `shortName` у маршруті лишає
  попереднє значення (закешована адмінка до деплою не обнулить «11/1»).
- **Міграція** додає колонку й одразу ставить `shortName = '11/1'` для маршруту `11` (як перейменування 6 → 10).

## Чекліст

Фаза 0 — інвентаризація
- [x] **0.1** Місця, де показується номер міського маршруту (≈45 `№…` + плашки без «№»), джерела датасету

Фаза 1 — бекенд
- [x] **1.1** Prisma: `shortName String @default("")`, міграція (+ `'11/1'` для `11`)
- [x] **1.2** `local-transport.ts`: тип, валідація, збереження (без ключа — попереднє значення), читання, legacy JSON
- [x] **1.3** GTFS `route_short_name` = `shortName` або id; тести; `dist`

Фаза 2 — фронтенд: дані й хелпер
- [x] **2.1** `TransportRouteDto.shortName`, `routeNames.ts` (`routeNo`, `configureRouteNames`), виклик у `getTransportDataset`
- [x] **2.2** `routeTitle` / `routeLine` і view-model через `routeNo`

Фаза 3 — фронтенд: усі місця показу
- [ ] **3.1** Маршрут, планер, табло, схема, факти прибуття, автостанція, стіна, наклейки
- [ ] **3.2** SEO: заголовки, описи, FAQ, JSON-LD (адреси й canonical — з id)
- [ ] **3.3** Адмінка: показ «11/1 (id 11)», поле «Номер для показу» на `/admin/route-schedule`

Фаза 4 — статичні сторінки
- [ ] **4.1** `prerender-transport-stops.mjs`, `stop-page-copy.mjs` — номери з датасету

Фаза 5 — схема міста
- [ ] **5.1** Генератор: номер з датасету в плашках (ширина за довжиною), легенді, `SCHEME_ROUTES.label`
- [ ] **5.2** Перегенерувати схему, Docs, плакат і PDF

Фаза 6 — перевірка й документація
- [ ] **6.1** Тести, локальна перевірка, CLAUDE.md (id ≠ номер), підсумок

## Знахідки по фазах

### Фаза 1 — бекенд

- `TransportRoute.shortName` (`TEXT NOT NULL DEFAULT ''`), міграція `20261010160000_transport_route_short_name`
  ставить `'11/1'` маршруту `11` (лише якщо порожньо — повторний запуск нічого не змінить).
- `validateTransportDataset`: рядок, один рядок, до 16 символів після обрізання; порожньо або без ключа — можна.
- `replaceTransportDataset`: значення обрізається; маршрут без ключа `shortName` отримує попередній номер з БД
  (одне додаткове читання, лише коли такий маршрут є).
- `loadTransportDataset` віддає `shortName`; legacy JSON — `supplement.routes[id].short_name`.
- GTFS: `route_short_name` = `shortName` або id.
- `dist` — `local-transport.js`, `scripts/export-gtfs.js` (решта збігається зі свіжою компіляцією).
- Локально: `npx prisma generate` оновив застарілий клієнт Prisma; `tsc` лишає одну помилку середовища
  (немає пакета `compression`).

### Фаза 2 — дані й хелпер (зроблено)

- `frontend/src/utils/routeNames.ts`: `configureRouteNames(routes)`, `routeNo(id)`, `routeNoWithId(id)` (для адмінки).
- `apiClient.getTransportDataset()` заповнює реєстр — сайт, адмінка й стіна отримують номери автоматично.
- `TransportRouteDto.shortName`; `routeTitle()` і вся `LocalTransportPage.tsx` (заголовок, FAQ, опис, JSON-LD,
  картки планера, «поряд», список маршрутів) показують `routeNo(id)`. GA4 і адреси — далі з id.

### Що лишилось у фазі 3 (інвентаризація 2026-10-10)

Замінити показ `id` на `routeNo(id)` (ключі, `key=`, адреси, `data-route`, CSS-змінні, GA4 — лишити з id):
- `LocalTransportSchemePage.tsx`: чипи (aria + текст), «Лінії через …», `lts-card-num`, «Розклад №…»
- `LocalTransportStopBoardPage.tsx`: `schemeMiniNote`, FAQ-приклади, JSON-LD, фільтр ліній (title + текст),
  «маршрут №… в …», aria картки, плашка картки, чипи статті; у `stopFallbackDescription` / `stopRoutesFaq` /
  `stopArticlePlainText` передавати вже `routeIds.map(routeNo)`
- `ArrivalReportSheet.tsx` (№…), `RouteMap.tsx` (плашки ліній на картці зупинки)
- `StickerWallPage/WallBadges.tsx` (aria + текст)
- `MizhgorodskiPage/AvtostantsiyaPage.tsx`, `avtostantsiyaContent.ts`
- Адмінка: `MapEditorTab.tsx` (підписи вибору й перерахунку; технічні точки «№id т.N» НЕ чіпати — це назви
  зупинок), `StopStickerTab.tsx`, `stopSticker/StickerStopList.tsx`, `stopSticker/stickerSvg.ts` (текст і
  ширина плашки — номер, `data-route` — id), `stopRename.ts`, `ArrivalReportsTab.tsx`
- `ScheduleEditorTab.tsx`: поле «Номер для показу» (`shortName`, до 16 символів) поруч із «Ненадійний»;
  у списку маршрутів і заголовку — номер з форми + id

Далі фази 4 (prerender: номери з `dataset.routes[].shortName`), 5 (генератор схеми: плашки й легенда з
датасету — до деплою генерувати з `--dataset` = продовий датасет + `shortName: '11/1'` для 11; ширина плашки за
довжиною; `SCHEME_ROUTES.label`), 6 (CLAUDE.md, тести, підсумок).

