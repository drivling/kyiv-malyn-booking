# Gold route model smoke (CP10)

## Automated

```bash
npm test
cd frontend && npm run test:e2e -- --grep 'booking|elektrichka|train'
```

## SQL asserts (Railway after migrate)

```sql
SELECT 'sched_null' AS a, COUNT(*) FROM "Schedule" WHERE "tripRouteId" IS NULL
UNION ALL SELECT 'book_sched_null', COUNT(*) FROM "Booking" WHERE source='schedule' AND "scheduleId" IS NULL
UNION ALL SELECT 'viber_null', COUNT(*) FROM "ViberListing" WHERE "tripRouteId" IS NULL
UNION ALL SELECT 'book_orphan', COUNT(*) FROM "Booking" b
  LEFT JOIN "Schedule" s ON s.id=b."scheduleId"
  WHERE b."scheduleId" IS NOT NULL AND s.id IS NULL
UNION ALL SELECT 'viber_non_corridor', COUNT(*) FROM "ViberListing" v
  JOIN "TripRoute" tr ON tr.id=v."tripRouteId"
  WHERE tr."corridorTripRouteId" IS NOT NULL;
-- Expect all counts = 0
```

## Manual

1. `/mizhgorodski?from=Kyiv&to=Malyn` — tabs Усі / Попутки / Маршрутки / Електрички
2. Book marshrutka → success; DB row has `scheduleId`
3. Elektrichka → disclaimer + ticket URL (no Booking)
4. Admin: edit schedule points; create Viber listing → `tripRouteId` set
5. Add variant later: new TripPoint + TripRoute + Schedule — no Booking migration

Parser / Viber regex: **not changed**.
