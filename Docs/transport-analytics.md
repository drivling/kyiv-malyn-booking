# Аналітика розділу /transport — події GA4

Усі події йдуть через `gaTrackEvent` (`frontend/src/analytics/googleAnalytics.ts`): no-op без
`window.gtag` (ініціалізується в `index.html`) і на `/admin*`. Параметри — лише службові id
(зупинки `st_…`, номери маршрутів, id вузлів схеми) та категорії; назв зупинок, координат чи
іншого особистого — ніколи. Юніт-тести стаблять `window.gtag = vi.fn()` і перевіряють, що в
параметрах немає назв зупинок. Нова взаємодія → подія в цій таблиці + тест.

| Подія | Коли | Параметри |
|---|---|---|
| `transport_search` | планер: пара «Звідки → Куди» визначилась (поле, URL, карта, вузол, ⇅) | `from`, `to`, `direct_routes` |
| `transport_no_route` | та сама пара без прямого маршруту | `from`, `to`, `nearby` |
| `transport_swap` | ⇅ у формі планера / на смужці карти | `source: form \| map` |
| `transport_date_chip` | чіпи дати: «Зараз», «Завтра», розгортання «DD.MM.YY о HH:MM» | `chip: now \| tomorrow \| custom`, `page: planner \| route \| board` |
| `transport_route_card_click` | картка маршруту у видачі планера | `route_id` |
| `transport_nearby_pick` | підказка сусідньої зупинки без прямого маршруту | `from`, `to`, `changed`, `walk_m` |
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

Перегляди сторінок — `page_view` з `GoogleAnalyticsTracker` (SPA-навігація), окремо від цієї таблиці.

Переходи з наклейок на зупинках (`/admin/stickers`, `Docs/stop-stickers.md`): QR веде на табло
`/transport/stop/<id>?utm_source=sticker&utm_medium=qr`, тож у звітах GA4 «Джерело / канал» вони
видні як `sticker / qr`, а сама зупинка — у шляху сторінки.
