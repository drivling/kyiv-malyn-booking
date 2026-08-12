# Poputky OD city scale — smoke

## Baseline (CP0)

- Marshrutka booking identity is already `scheduleId → TripRoute` (gold model).
- Poputky previously: corridor string + hardcoded 6 pairs; Irpin/Bucha not selectable in poputky UI (`appearInFromTo=false`).
- Parser still writes corridor slugs only (unchanged in this phase).

## Model

- `TripPoint.appearInPoputky` — city participates in rideshare (bot + site).
- `ViberListing.fromPointId` / `toPointId` — OD identity; `route` remains snapshot.
- Matching: exact OD with dual-read fallback on `route` when points are null.
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
4. Bot `/adddriverride`: Звідки → Куди (dynamic); create Irpin→Malyn; match only same OD (not Kyiv→Malyn).
5. Parser import: still creates corridor listing; points filled via resolve/backfill; dual-read match works.

## Non-goals

- Viber parser city expansion
- Along-corridor matching (driver Kyiv→Malyn vs passenger Irpin→Malyn) — **not auto**; admin can pin `tripRouteId` to a **variant** (e.g. `Kyiv-Malyn-Irpin`) on the Viber tab for curation/display. Match logic still exact OD until a dedicated graph phase.
