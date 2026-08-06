# SEO stop articles — living plan (Malyn)

Goal: short unique pages per stop at `/transport/stop/{st_id}` with lead paragraph + live departures.

## Pilot (18)

| id | Stop | Article |
|----|------|---------|
| st_0019 | Залізничний вокзал | [x] |
| st_0072 | Поліклініка | [x] |
| st_0062 | Огієнка 65 (БАМ) | [x] |
| st_0056 | маркет "Соборний" | [x] |
| st_0054 | Малинівський круг | [x] |
| st_0089 | Хлібзавод | [x] |
| st_0070 | пл. Соборна (біля РБК) | [x] |
| st_0063 | Огієнка 65 (БАМ) (навпроти) | [x] |
| st_0060 | Молокозавод | [x] |
| st_0034 | Ливарний завод (а/стоянка) | [x] |
| st_0033 | Ливарний завод | [x] |
| st_0080 | РЕМ | [x] |
| st_0023 | ЗОШ № 3 (навпроти) | [x] |
| st_0020 | ЗОШ " 3 | [x] |
| st_0001 | 10 ОГШБ (навпр.РЕМу) | [x] |
| st_0035 | Лікарня | [x] |
| st_0098 | Шевченка 22 | [x] |
| st_0065 | Перемоги 15-17 | [x] |

## Infra

- Content: `frontend/src/content/stops/`
- UI: «Про зупинку» on `LocalTransportStopBoardPage`
- Sitemap: `/transport/route/{id}` and `/transport/stop/st_*` on build (no `?dir=`)
- `/support/site` already in public sitemap

## After pilot

Remaining ~96 stops with the same one-commit-per-stop pipeline.

### Після пілоту (2026-08-07)

**Що зробили:** шаблон `frontend/src/content/stops/` + блок «Про зупинку»; 18 статей окремими комітами; `/support/*` через `usePageSeo` (canonical); prerender підхоплює `lead` з `.ts`.

**Що побачили:** абзаци базуються на назві + маршрутах + координатах (без вигаданої «історії»). Пари «навпроти» різняться формулюванням сторони вулиці — ок для окремого URL. Build: 114 stop pages, 18 with articles; sitemap routes без `?dir=`.

**Далі:** решта ~96 тим самим пайплайном; після deploy — GSC на 5 пілотних URL.
