# SEO stop articles — living plan (Malyn)

Goal: short unique pages per stop at `/transport/stop/{st_id}` with lead paragraph + live departures.

## Pilot (18)

| id | Stop | Article |
|----|------|---------|
| st_0019 | Залізничний вокзал | [ ] |
| st_0072 | Поліклініка | [ ] |
| st_0062 | Огієнка 65 (БАМ) | [ ] |
| st_0056 | маркет "Соборний" | [ ] |
| st_0054 | Малинівський круг | [ ] |
| st_0089 | Хлібзавод | [ ] |
| st_0070 | пл. Соборна (біля РБК) | [ ] |
| st_0063 | Огієнка 65 (БАМ) (навпроти) | [ ] |
| st_0060 | Молокозавод | [ ] |
| st_0034 | Ливарний завод (а/стоянка) | [ ] |
| st_0033 | Ливарний завод | [ ] |
| st_0080 | РЕМ | [ ] |
| st_0023 | ЗОШ № 3 (навпроти) | [ ] |
| st_0020 | ЗОШ " 3 | [ ] |
| st_0001 | 10 ОГШБ (навпр.РЕМу) | [ ] |
| st_0035 | Лікарня | [ ] |
| st_0098 | Шевченка 22 | [ ] |
| st_0065 | Перемоги 15-17 | [ ] |

## Infra

- Content: `frontend/src/content/stops/`
- UI: «Про зупинку» on `LocalTransportStopBoardPage`
- Sitemap: `/transport/route/{id}` and `/transport/stop/st_*` on build (no `?dir=`)
- `/support/site` already in public sitemap

## After pilot

Remaining ~96 stops with the same one-commit-per-stop pipeline.
