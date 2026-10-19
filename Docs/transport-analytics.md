# Аналітика розділу /transport — події GA4

Усі події йдуть через `gaTrackEvent` (`frontend/src/analytics/googleAnalytics.ts`): no-op без
`window.gtag` (ініціалізується в `index.html`) і на `/admin*`. Параметри — лише службові id
(зупинки `st_…`, номери маршрутів, id вузлів схеми) та категорії; назв зупинок, координат чи
іншого особистого — ніколи. Юніт-тести стаблять `window.gtag = vi.fn()` і перевіряють, що в
параметрах немає назв зупинок. Нова взаємодія → подія в цій таблиці + тест.

| Подія | Коли | Параметри |
|---|---|---|
| `transport_search` | планер: пара «Звідки → Куди» визначилась (поле, URL, карта, вузол, ⇅) | `from`, `to` — id зупинки або `geo` / `point` (координати не йдуть), `direct_routes` (скільки ліній возить без пересадки), `journeys` (скільки поїздок за день), `best_transfers` (мінімум пересадок, `-1` — поїздок немає) |
| `transport_no_route` | та сама пара без жодної поїздки (ні прямої, ні з пересадкою) | `from`, `to` (як у `transport_search`) |
| `transport_swap` | ⇅ у формі планера / на смужці карти | `source: form \| map` |
| `transport_date_chip` | чіпи дати: «Зараз», «Завтра», розгортання «DD.MM.YY о HH:MM» | `chip: now \| tomorrow \| custom`, `page: planner \| route \| board` |
| `transport_journey_open` | розгорнуто картку поїздки у видачі планера (`journey/JourneyResults.tsx`) | `transfers`, `legs` |
| `transport_journey_leg_click` | «Розклад маршруту №…» у розгорнутій картці поїздки | `route_id` |
| `transport_arrive_by` | чіп «Прибути до» (час пошуку — прибуття) | `on` |
| `transport_point_pick` | точка замість зупинки: «Звідси — моє місцезнаходження» після геолокації або клік по карті | `slot: from \| to`, `source: geo \| map` |
| `transport_geo` | результат геолокації («Поруч зі мною») | `result: ok \| denied \| error \| unsupported`, `page` |
| `transport_nearest_pick` | вибір зупинки зі списку найближчих (планер → «Звідки», табло → відкрити табло) | `page`, `stop`, `distance_m` |
| `transport_quick_node` | чіп вузла схеми у швидкому старті планера | `node_id`, `kind: hub \| terminal`, `slot: from \| to` |
| `transport_map_open` | чіп «Карта» на телефоні (overlay) | `page: planner \| route`, `has_pair` |
| `transport_map_pick` | «Звідси» / «Сюди» / «Часто їду в…» у картці зупинки на карті | `page`, `slot: from \| to` |
| `transport_timeline_pick` | тап по зупинці таймлайну на сторінці маршруту, «Скинути» | `route_id`, `action: from \| to \| restart \| clear_from \| clear_to \| reset` |
| `transport_departure_pick` | чіп стрічки відправлень або рядок повного розкладу | `route_id`, `dir`, `source: strip \| table` |
| `transport_timetable_toggle` | чіп «Повний розклад» | `route_id`, `open` |
| `transport_direction` | «Туди / Назад» або ⇅ на карті маршруту | `route_id`, `dir`, `source: toggle \| map` |
| `transport_print` | «Друк» на сторінці маршруту | `route_id` |
| `transport_scheme_open` | міні-схема (посилання на сторінку схеми) | `source: planner \| route \| board` |
| `transport_line_filter` | чіп лінії під назвою зупинки на табло | `stop`, `line`, `on` |
| `transport_full_day` | «Весь день» / «Показати весь день» на табло | `stop`, `on` |
| `transport_board_card_click` | картка відправлення на табло | `route_id`, `dir` |
| `transport_scheme_route` | чіп або лінія маршруту на сторінці схеми | `route_id`, `on` |
| `transport_scheme_stop` | зупинка на схемі → табло | `stop` |
| `transport_sticker_open` | табло відкрито з QR наклейки на зупинці (раз за сесію на наклейку) | `stop`, `side: a \| b \| s` |
| `transport_sticker_return` | людина, що колись прийшла з QR-наклейки, знову на сайті після перерви ≥ 30 хв (`stickerReturn.ts`) | `stop`, `side` — перша наклейка людини, `via: reload \| tab \| direct` |
| `transport_arrival_open` | довге натискання на чіп часу (сторінка маршруту) або картку табло — відкрито «Факт прибуття» | `route_id`, `source: route \| board` |
| `transport_arrival_report` | позначку «автобус тут» / «автобуса не було» записано | `route_id`, `kind: arrived \| missed`, `source: route \| board` |
| `transport_pwa_install` | «Встановити» у смужці стану транспорту — відповідь системного діалогу встановлення (`Docs/transport-pwa-2026-10.md`) | `result: accepted \| dismissed` |
| `transport_data_download` | «Завантажити розклад (GTFS)» / «Дані у JSON» у блоці «Дані відкриті» на `/transport/scheme` (`Docs/transport-open-data-2026-10.md`) | `format: gtfs \| json` |
| `transport_outbox` | запис із табло пройшов через чергу без мережі (`src/pwa/outbox.ts`, `Docs/transport-offline-writes-2026-10.md`): став у чергу, надіслано з черги, сервер відкинув (4xx), викинуто після 10 спроб | `kind: sticker-scan \| sticker-return \| arrival-report`, `result: queued \| sent \| rejected \| dropped` |

Перегляди сторінок — `page_view` з `GoogleAnalyticsTracker` (SPA-навігація), окремо від цієї таблиці.
`transport_sticker_open`, `transport_sticker_return` і `transport_arrival_report` фіксують дію людини в момент дії —
і тоді, коли запис лише став у чергу без мережі; чи дійшов він до бази, видно з `transport_outbox`.

Переходи з наклейок на зупинках (`/admin/stickers`, `Docs/stop-stickers.md`): QR веде на табло
`/transport/stop/<id>?utm_source=sticker&utm_medium=qr&utm_campaign=<id>-<a|b|s>`, тож у звітах GA4
«Джерело / канал» вони видні як `sticker / qr`, а кампанія — конкретна наклейка (`st_0015-a`:
зупинка й бік). Те саме відкриття табло пише в базу (`StickerScan`, `POST /transport/sticker-scans`)
— лічильники «Відкриття з QR» в адмінці «Наклейки зупинок» не залежать від блокувальників GA.
