# Житомир: звідки дані

| Що | Звідки | Умови |
|---|---|---|
| Маршрути, зупинки по порядку, хвилини між ними, відправлення від першої зупинки (`source/`, `routes.json`) | `zt.rozklad.in.ua` — сайт власника цього проєкту (той самий, що `kor.rozklad.in.ua`) | власні дані, без обмежень |
| Координати зупинок (`osm/stops.json`) | OpenStreetMap через Overpass | © OpenStreetMap contributors, ODbL 1.0 |
| Координати зупинок, яких немає в OSM (`google/stop-geocode.json`) | Google Places Text Search | зберігаємо на підставі договору власника з Google (рішення власника 2026-11-17, `Docs/dovede-roadmap.md`) |
| Звірка маршрутів (`google/checks.json`, `REPORT.md`) | Google Routes, TRANSIT | те саме |

Оновлення — `npm run zhytomyr:snapshot` у `backend/` (прапорці — у шапці `backend/src/scripts/zhytomyr-snapshot.ts`).
`routes.json`, `stops.json`, `REPORT.md` і `backend/src/dovede/zhytomyr-own-data.ts` згенеровано — руками не редагувати;
ручні координати зупинок — у `stops.hints.json` (`{ "<id зупинки>": { "lat": …, "lng": … } }`).

На сайті зараз лише автобуси (19 маршрутів); трамвая й тролейбусів у списку немає.
