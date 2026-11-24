# Житомир: звідки дані

| Що | Звідки | Умови |
|---|---|---|
| Маршрути, зупинки по порядку, хвилини між ними, відправлення від першої зупинки (`source/`, `routes.json`) | `zt.rozklad.in.ua` — сайт власника цього проєкту (той самий, що `kor.rozklad.in.ua`) | власні дані, без обмежень |
| Координати зупинок (`osm/stops.json`) | OpenStreetMap через Overpass | © OpenStreetMap contributors, ODbL 1.0 |
| Координати зупинок, яких немає в OSM (`google/stop-geocode.json`) | Google Places Text Search | зберігаємо на підставі договору власника з Google (рішення власника 2026-11-17, `Docs/dovede-roadmap.md`) |
| Звірка маршрутів (`google/checks.json`, `REPORT.md`) | Google Routes, TRANSIT | те саме |
| Трамвай і тролейбуси: зупинки по порядку, відправлення (`easyway/`); автобуси 1, 4, 26 — для звірки | EasyWay, знято руками 2026-11-24 (`easyway/README.md`) | з дозволу EasyWay (дані брати руками; API немає) |

Оновлення — `npm run zhytomyr:snapshot` у `backend/` (прапорці — у шапці `backend/src/scripts/zhytomyr-snapshot.ts`).
`routes.json`, `stops.json`, `REPORT.md` і `backend/src/dovede/zhytomyr-own-data.ts` згенеровано — руками не редагувати;
ручні координати зупинок — у `stops.hints.json` (`{ "<id зупинки>": { "lat": …, "lng": … } }`).

На сайті zt.rozklad.in.ua лише автобуси (19 маршрутів); трамвай і тролейбуси — з EasyWay.

Датасет для сайту (`dataset/`) — `npm run zhytomyr:dataset`; оновити знімок EasyWay — `npm run zhytomyr:dataset -- --easyway-from <тека>`.
План і перемикач — `Docs/zhytomyr-transport-2026-11.md`.
