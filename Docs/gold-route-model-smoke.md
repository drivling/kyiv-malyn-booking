# Gold route model smoke (CP10 + non-hub OD)

## Automated

```bash
npm test
cd frontend && npm run test:e2e -- --grep 'booking|elektrichka|train'
```

## SQL asserts (Railway after migrate)

```sql
SELECT 'sched_null' AS a, COUNT(*) FROM "Schedule" WHERE "tripRouteId" IS NULL
UNION ALL SELECT 'book_sched_null', COUNT(*) FROM "Booking" WHERE source='schedule' AND "scheduleId" IS NULL
UNION ALL SELECT 'book_tr_null', COUNT(*) FROM "Booking" WHERE source='schedule' AND "tripRouteId" IS NULL
UNION ALL SELECT 'viber_null', COUNT(*) FROM "ViberListing" WHERE "tripRouteId" IS NULL
UNION ALL SELECT 'book_orphan', COUNT(*) FROM "Booking" b
  LEFT JOIN "Schedule" s ON s.id=b."scheduleId"
  WHERE b."scheduleId" IS NOT NULL AND s.id IS NULL
UNION ALL SELECT 'viber_non_corridor', COUNT(*) FROM "ViberListing" v
  JOIN "TripRoute" tr ON tr.id=v."tripRouteId"
  WHERE tr."corridorTripRouteId" IS NOT NULL;
-- Expect all counts = 0 (viber_non_corridor may be >0 if variants pinned intentionally)
```

Confirm Schedule unique SoT is tripRouteId+time (no unique on route string):

```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'Schedule' AND indexname LIKE '%route%departure%';
-- Expect Schedule_tripRouteId_departureTime_key (+ optional non-unique Schedule_route_departureTime_idx)
```

## Manual

1. `GET /od-pairs` — after admin creates `Kyiv-Korosten-Malyn`, pairs include Київ↔Коростень (+ along-stops)
2. `/mizhgorodski?from=Kyiv&to=Korosten` — chips / results without hardcoding Malyn-only
3. SEO `/mizhgorodski/kyiv-korosten` — human slug landing
4. Book marshrutka with `scheduleId` → success; DB row has `scheduleId` + `tripRouteId`
5. `GET /schedules/by-id/:id/availability?date=` — preferred; legacy `/schedules/:route/:time/availability` still works
6. `GET /viber-listings/search?fromCode=&toCode=&date=` — OD filter (not only `route=`)
7. Telegram `/book` — time buttons `book_sched_${id}_…`; old `book_time_*` → «Оновіть меню»
8. Elektrichka → disclaimer + ticket URL (no Booking)

Parser / Viber regex auto-detect of long-haul slugs: **out of scope**.
