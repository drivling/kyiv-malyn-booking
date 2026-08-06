# SEO stop articles — living plan (Malyn)

Goal: short unique pages per stop at `/transport/stop/{st_id}` with structured «Про зупинку» + live departures.

## Template (2026-08-07)

Structured fields (not a wall-of-text `lead`):

- `place` — роль / орієнтир у місті
- `routeIds` — чипи-посилання на маршрути
- `coords` — моноширинний блок + OSM
- техблок howto — дрібний, у пунктирній рамці (табло / планер «З → До»)

UI: `LocalTransportStopBoardPage` + `.lt-stop-article*`.

## Coverage

- **117 / 118** stops have articles (`frontend/src/content/stops/st_*.ts`)
- Missing coords in runtime: `st_0118` (№9 т.3) — skipped
- 4 stops with empty `routeIds` in `stops_by_route` (orphan / inactive): `st_0006`, `st_0008`, `st_0018`, `st_0046`

### Pilot (18) — human place text

| id | Stop |
|----|------|
| st_0019 | Залізничний вокзал |
| st_0072 | Поліклініка |
| st_0062 | Огієнка 65 (БАМ) |
| st_0056 | маркет "Соборний" |
| st_0054 | Малинівський круг |
| st_0089 | Хлібзавод |
| st_0070 | пл. Соборна (біля РБК) |
| st_0063 | Огієнка 65 (БАМ) (навпроти) |
| st_0060 | Молокозавод |
| st_0034 | Ливарний завод (а/стоянка) |
| st_0033 | Ливарний завод |
| st_0080 | РЕМ |
| st_0023 | ЗОШ № 3 (навпроти) |
| st_0020 | ЗОШ " 3 |
| st_0001 | 10 ОГШБ (навпр.РЕМу) |
| st_0035 | Лікарня |
| st_0098 | Шевченка 22 |
| st_0065 | Перемоги 15-17 |

### Rest (99)

Generated from catalog + `stops_by_route` + `stops_coords.json` with name-based `place` templates (same UI).

## Infra

- Content: `frontend/src/content/stops/` (+ `index.ts`)
- UI: «Про зупинку» on `LocalTransportStopBoardPage`
- Sitemap / prerender: `/transport/stop/st_*` on build

## Next

- Optionally hand-polish high-traffic auto `place` strings
- Add `st_0118` when coords appear
- Deploy + GSC smoke on pilot URLs
