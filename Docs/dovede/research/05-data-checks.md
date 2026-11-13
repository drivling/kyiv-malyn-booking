# «Доведе» — data checks (2026-11-13)

Facts checked directly in the data while planning phases 0–1. Sources: production API
(`https://kyiv-malyn-booking-production.up.railway.app`, read-only GETs), swrailway.gov.ua through the project's own
parser `backend/dist/swrailway-eltrain.js`, and a snapshot of the production transport dataset (363 stops,
11 routes, 257 trips).

## 1. Production intercity schedules — `GET /poputky/search`, Saturday 2026-11-14

Already filtered to the date by the API. Marshrutky have no `arrivalTime` / `durationMinutes`; elektrichky have both.

**Kyiv → Malyn (16)**

| Dep | Arr | Min | Type | Route | Boarding → alighting | Train |
|-----|-----|-----|------|-------|----------------------|-------|
| 05:35 | 08:01 | 146 | elektrichka | Kyiv-Malyn | Київ-Пас. (Приміський) → Малин | 6601 |
| 08:50 | 11:11 | 141 | elektrichka | Kyiv-Malyn | Київ-Пас. (Приміський) → Малин | 6605 |
| 14:51 | 17:11 | 140 | elektrichka | Kyiv-Malyn | Київ-Пас. (Приміський) → Малин | 6613 |
| 18:51 | 20:48 | 117 | elektrichka | Kyiv-Malyn | з.п. Борщагівка → Малин (сб, нд) | 6621 |
| 08:00, 15:00 | — | — | marshrutka | Kyiv-Malyn-Bucha | м. Святошино | — |
| 09:00, 10:00, 11:00, 12:00, 13:00, 16:00, 17:00, 18:00*, 19:00, 20:00 | — | — | marshrutka | Kyiv-Malyn-Irpin | м. Академмістечко | — |

\* 18:00 runs Mon, Fri, Sat, Sun. Weekday-only trains (855 09:20, 859 17:30, 6621 18:59 from Святошин) are absent on
Saturday.

**Malyn → Kyiv (17)**

| Dep | Arr | Min | Type | Route | Boarding → alighting | Train |
|-----|-----|-----|------|-------|----------------------|-------|
| 05:45 | 07:42 | 117 | elektrichka | Malyn-Kyiv | Малин → Київ-Пас. (Приміський) | 856 |
| 06:58 | 09:06 | 128 | elektrichka | Malyn-Kyiv | Малин → Борщагівка | 6610 |
| 09:48 | 11:47 | 119 | elektrichka | Malyn-Kyiv | Малин → Святошин | 6614 |
| 11:47 | 13:42 | 115 | elektrichka | Malyn-Kyiv | Малин → Святошин | 6616 |
| 19:32 | 22:11 | 159 | elektrichka | Malyn-Kyiv | Малин → Київ-Пас. (Приміський) | 6626 |
| 05:00, 06:00, 10:30, 16:30 | — | — | marshrutka | Malyn-Kyiv-Bucha | Автостанція Малин → м. Святошино | — |
| 05:30, 07:30, 08:30, 12:30, 13:30*, 14:30, 15:30*, 17:30 | — | — | marshrutka | Malyn-Kyiv-Irpin | Автостанція Малин | — |

\* 13:30 runs Fri–Sun; 15:30 Mon, Fri–Sun.

## 2. Elektrichky — swrailway.gov.ua (the admin's sync source)

Pages: `https://swrailway.gov.ua/timetable/eltrain/?gid=1&rid=68&reverse=1&half=1&count=4` (to Malyn) and
`…reverse=2…` (from Malyn).

| Train | Київ-Пас. | Святошин | Малин | Days |
|-------|-----------|----------|-------|------|
| 6601 | 05:35 | 06:00 | 08:01 | daily |
| 6605 | 08:50 | 09:16 | 11:11 | daily |
| 855 | 09:20 | 09:52 | 11:30 | Mon–Fri |
| 6613 | 14:51 | 15:17 | 17:11 | daily |
| 859 | 17:30 | 17:53 | 19:28 | except Sat |
| 6621 | — | 18:59 (Sat, Sun from Борщагівка 18:51) | 20:48 | daily |

| Train | Малин | Святошин | Київ-Пас. | Days |
|-------|-------|----------|-----------|------|
| 6606 | 05:18 | 07:18 | 07:42 | Sun |
| 856 | 05:45 | 07:20 | 07:42 | except Sun |
| 6610 | 06:58 | 09:00 | Борщагівка 09:06 | except Sun |
| 6614 | 09:48 | 11:50 | 12:17 | daily |
| 860 | 14:20 | 16:01 | 16:23 | Mon–Fri |
| — | 14:55 | 16:55 (terminus) | — | daily ⚠️ |
| 6626 | 19:32 | 21:45 | 22:11 | daily |

- Святошин ↔ Малин: 1 h 35 (fast 855 / 859) … 2 h 03. Київ-Пас. → Святошин: 23–32 min; → Борщагівка ≈ 17 min.
  Used as `TRAIN_POS` in `DovedePage/data/kyiv.ts` (Київ-Пас. 0, Борщагівка 17, Святошин 25).
- ⚠️ **Discrepancy:** the daily Малин 14:55 → Святошин 16:55 train is on swrailway but not in the site's schedule
  snapshot. Worth checking in the admin.
- Small drift: 6614 at Святошин is 11:47 in our DB, 11:50 on swrailway.
- The first draft of the prototype had 6613 at Святошин ≈15:04 → Малин ≈17:00 and 6621 arriving ≈21:05 — both wrong;
  fixed to 15:17 → 17:11 and 20:48.

## 3. Owner facts (2026-11-13)

- The Kyiv marshrutka enters Malyn at **ПТУ** — in our data the stop «ПТЛ» `st_0079` (opposite: «м-н "Продукти"
  навпроти ПТЛ» `st_0048`), runs along **вул. Бандери** (former Кримського) to the **centre**; main stop
  «м-н "Промінь"» `st_0049` (the scheme legend calls it «Центр (ТЦ «Промінь»)»).
- Travel time Kyiv ↔ Malyn by marshrutka: usually **1 h 30**, at most **1 h 37**, Friday evening out of Kyiv up to
  **1 h 40** (traffic in the city). The site FAQ says «1,5–2 години».
- Boarding the Kyiv marshrutka: be at the stop **≥ 10 min** before.
- Kyiv part: short Google-style transit tables + Google Maps link.
- Poputky: from Malyn to Kyiv all leave from the **centre**; conditions sometimes in the listing note; back they run
  like the marshrutky.
- Admin entry to `/dovede`: bookmark only.

## 4. Malyn city transport — what the stories rely on

**Scheme nodes** (`LocalTransportPage/scheme/malyn-scheme-nodes.ts`): Лікарня · Поліклініка (st_0035, st_0036,
st_0072); Центр · Базарна площа (st_0070, st_0056, st_0049, st_0044); Малинівський круг (st_0054, st_0082); Залізничний
вокзал (st_0019); Лісотехнікум (st_0038); Шевченка, 119 (st_0097, st_0067); Паперова фабрика (st_0064); Барміна
(st_0007); вул. Олекси Тихого (st_0009); Автостанція (st_0004, st_0005); Укр. Повстанців (st_0088); Грушевського
(st_0013, st_0042); з-д «Прожектор» (st_0015, st_0046); Царське село (st_0090); Малинівка (st_0053); Юрівка (st_0099);
ПТЛ (st_0079, st_0059); Городище · 14 ОМБ (st_0002, st_0003); вул. Миру (st_0057); Івана Мазепи (st_0024, st_0043);
Приходька (st_0075); Чорновола, 53 (st_0094, st_0093).

**Route colours** (scheme legend, `malyn-scheme-routes.ts`): №7 `#F08A1C` / black text; №8 `#7E3FC2` / white;
№9 `#E3368C` / black; №10 `#C99700` / black.

**Times at key stops** (departure from the first stop + segment seconds):

| Route / direction | Stop | Times |
|---|---|---|
| №7 back | ПТЛ → вокзал (+5 min) | 07:51, 08:31, 09:21, 10:01, 10:51, 11:46, 13:31, 14:21, 15:06, **16:41**, 17:31, 18:17, 19:01, 19:56, 21:29 |
| №8 back | ПТЛ → вокзал (+2 min) | 06:04, 07:14, 08:09, 08:54, 09:44, 10:24, 11:14, 12:14, 13:14, 14:59, 15:34, 16:24, **17:24**, 18:14 |
| №8 back | «Промінь» → вокзал (+10 min) | 05:56, 07:06, 08:01, 08:46, 09:36, 10:16, 11:06, 12:06, 13:06, 14:51, 15:26, 16:16, 17:16, 18:06 |
| №9 back | Царське село → «Промінь» (+7 min) | **07:09**, 08:34, 09:24, 10:24, 11:24, 12:24, 13:24, 15:24, 16:24, 17:44 |
| №9 there | Царське село | 07:29, 09:04, 09:54, 10:54, 11:54, 12:54, 13:54, 15:54, 16:54, **18:04** (last) |
| №10 back | «Автостанція (навпроти)» → вокзал (+9 min) | from the first-stop departures 06:15 … 18:25 (+12 min) |

- №8 back runs «Промінь» → С.Бандери 36 → перехр. Горбатюка-Бандери → … → ПТЛ in ≈ 8 min — the source of the
  ПТЛ offset (−8 min from the centre).
- Centre → вокзал: №3, 5, 7, 8, 11/1, 12. Автостанція → вокзал: №10.
- In the planner run on production (night of 13.11), «Святошин → вокзал» picked marshrutka 08:00 → ПТЛ ≈09:22 →
  №8 09:39 → вокзал 09:45 (the planner's own times, slightly different from this table).

**Straight-line distances** (planner walk = × 1.5 at 1.2 m/s):

| From → to | Metres |
|---|---|
| ПТЛ → Залізничний вокзал | 1866 |
| ПТЛ → «Промінь» | 2863 |
| ПТЛ → Царське село | 1571 |
| «Промінь» → пл. Соборна | 117 |
| «Промінь» → Автостанція | 876 |
| Царське село → «Промінь» | 1691 |
| Царське село → Автостанція | 2112 |
| Царське село → вокзал | 2096 |
| Автостанція → вокзал | 4107 |

## 5. Golden set and the local parser

- `frontend/src/pages/DovedePage/eval/golden.json`: 54 cases (km ×10, mk ×12, t ×8, m ×6, l ×6, i ×4, o ×5, n ×3),
  48 in MVP scope; reference «now» Friday 2026-11-13 14:20 Kyiv.
- Phase 1 `parseLocal`: 100% of graded slots in MVP scope (written while looking at the set — a ceiling, not a real
  accuracy; phase 2 must measure on new phrasings).
