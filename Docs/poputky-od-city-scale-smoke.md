# Poputky OD city scale — smoke

## Baseline (CP0)

- Marshrutka booking identity is already `scheduleId → TripRoute` (gold model).
- Poputky previously: corridor string + hardcoded 6 pairs; Irpin/Bucha not selectable in poputky UI (`appearInFromTo=false`).
- Parser still writes corridor slugs only (unchanged in this phase).

## Model

- `TripPoint.appearInPoputky` — city participates in rideshare (bot + site).
- `ViberListing.fromPointId` / `toPointId` — OD identity; `route` remains snapshot.
- Matching:
  - **exact OD** (same from/to or legacy `route`), or
  - **along-route**: passenger OD is an ordered subset of the **driver** `TripRoute` stops (`tripRouteId` → corridor or variant).
- Seed: Kyiv, Malyn, Zhytomyr, Korosten, Irpin, Bucha → `appearInPoputky=true`.

## Checks after migrate

```sql
SELECT code, "appearInPoputky", "appearInFromTo" FROM "TripPoint" ORDER BY "sortOrder";
SELECT count(*) FILTER (WHERE "fromPointId" IS NULL) AS listing_od_null FROM "ViberListing";
SELECT count(*) FILTER (WHERE source='viber_match' AND "fromPointId" IS NULL) AS booking_od_null FROM "Booking";
```

Expect: Irpin/Bucha have `appearInPoputky=true` and `appearInFromTo=false`; listing/booking OD null ≈ 0 for known corridor slugs.

## Manual smoke

1. Admin: Trip points — column «У попутках» toggles.
2. `GET /trip-points?appearInPoputky=true` returns 6 cities including Irpin/Bucha.
3. Site `/mizhgorodski` and `/poputky`: announce from/to includes Irpin; publish Irpin→Malyn draft.
4. Bot `/adddriverride`: Звідки → Куди (dynamic); create Irpin→Malyn; exact match only same OD unless driver has variant with Irpin.
5. Parser import: still creates corridor listing; points filled via resolve/backfill; dual-read match works.
6. Along-route: driver Kyiv→Malyn pinned to variant `Kyiv-Malyn-Irpin` matches passenger Irpin→Malyn (same date); corridor-only does not.

## Along-route ops instruction (how to run this)

1. **Cities** — Admin → trip points → enable **«У попутках»** (`appearInPoputky`). Otherwise the city never appears in bot/site selects.

2. **Variant with via** — Need a `TripRoute` variant with ordered stops, e.g. Kyiv → Irpin → Malyn (`Kyiv-Malyn-Irpin`). Plain corridor `Kyiv-Malyn` (two terminals only) will **not** match Irpin passengers.

3. **Pin driver listing** — Admin → **Viber** → Edit → **TripRoute (corridor / variant)** → pick the variant → Save. Table column shows label + `v`.

4. **When match fires** — Passenger OD points both sit on the driver’s itinerary in the same direction; same date; time bands unchanged (exact / approximate / same_day). Exact OD still matches without a variant.

5. **When it does not** — Driver has corridor-only / empty `tripRouteId`; reverse direction; missing stop; parser listings without manual variant pin stay exact-only.

6. **Verify** — Driver Kyiv→Malyn + variant via Irpin; passenger Irpin→Malyn same date → bot notifications (+ «по дорозі») and `/mizhgorodski` filter. Control: corridor-only must not match Irpin.

7. **Rollback** — Clear TripRoute on the listing or switch to corridor without via → along-route off for that ride; exact OD remains.

## Admin cities + home city (follow-up)

- Admin → schedules tab → **Міста / точки маршруту**: add / edit / delete cities; flags; **Швидкі напрямки** (`quickDirectPointIds`).
- Site `/mizhgorodski`: cookie `malin_home_city` (default Malyn); chips from home’s quick-direct list.
- Bot marshrutka book: **звідки → куди → дата → час** (schedules whose TripRoute stops contain OD); no via text on buttons.
- `TripRouteStop.departureOffsetMinutes`: boarding time = schedule start + offset; editable in schedule modal.
## Deferred (explicitly not in this ship)

1. **Viber parser → new cities** — keep corridor whitelist until a dedicated change. Before expanding cities: run `cd backend && npm test -- --run src/viber-parser.test.ts` and `npx ts-node scripts/eval-viber-parser.ts` (golden `testdata/viber-golden.json`). Baseline after this work: **route 821/821 (100%)**, unit suite green. Do not expand cities without re-running golden and fixing regressions.

2. **Drop legacy `route` string in one step** — **not OK as a single cutover**. Keep dual-read (`fromPointId`/`toPointId` + `route` snapshot) until listings/bookings/parser/admin clients all write points. Big-bang removal would break parser imports and old rows.

3. **Auto-detect home city (geo/IP)** — later. Cookie + manual select is enough for launch; detect can write the same `malin_home_city` cookie when ready.

## Non-goals (still)

- Matching against passenger’s `tripRouteId` (itinerary is always the driver’s).
