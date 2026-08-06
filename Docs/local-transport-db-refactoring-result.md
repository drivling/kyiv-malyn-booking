# Local Transport: JSON → PostgreSQL — result

**Date:** 2026-08-06  
**Plan:** [local-transport-db-refactoring-plan.md](./local-transport-db-refactoring-plan.md)  
**GTFS howto:** [local-transport-gtfs-feed.md](./local-transport-gtfs-feed.md)

## Summary

City transport Malyn now lives in **PostgreSQL** (GTFS-aligned tables). The public site uses a new Jakdojade-style planner at **`/transport`**. The admin Map Editor loads/saves via API instead of downloading JSON. Android app support and static JSON copies for the site were removed.

Intercity booking (Prisma `Schedule` / `Booking`) was not changed.

## What shipped

| Stage | Outcome |
|-------|---------|
| 1 | Removed `android-malyn-transport`, `GET /localtransport/data`, `backend/localtransport-data` |
| 2 | Models `Transport*`; migration; `npm run seed:transport` from `data/malyn-transport/runtime/` |
| 3 | `GET` / `PUT` `/transport/dataset` (+ tests) |
| 4 | `npm run export:gtfs` reads DB (same feed shape as before) |
| 5 | Map Editor: «Зберегти в базу» / «Завантажити з бази» |
| 6 | New `/transport` UI; deleted `LocalTransportPage` and `/localtransport*` routes |
| 7 | Removed static public JSON + obsolete sync/export scripts; docs updated |

### Commands

```bash
cd backend && npm run seed:transport
cd backend && npm run export:gtfs
```

### Feed snapshot after DB export

- Routes: 2, 3, 5, 7, 8, 9, 11, 12
- Trips: 184 · stop_times: 3301 · stops: 89 · shapes: 16 (339 points)

## Architecture after refactor

```
Admin MapEditorTab
        │ PUT /transport/dataset (requireAdmin)
        ▼
PostgreSQL Transport* tables
        │ GET /transport/dataset (public, cache 300s)
        ▼
Site /transport (planner, routes, stop board)

runtime/*.json  ──seed──▶  DB   ──export:gtfs──▶  data/malyn-transport/gtfs/
```

**Preserved:** coordinate drag, direction order editor, `mapOnly` technical points, GTFS shapes/feed_info logic.

**Removed:** Android API, file-download CMS, static `frontend/public/data` transport JSON, `/localtransport` URLs (no redirects).

## Deploy notes

1. `npm start` already runs `prisma migrate deploy`.
2. Run **once** on production after deploy: `cd backend && npm run seed:transport`.
3. Site must call API (`VITE_API_URL` / same origin) for `/transport/dataset`.

## Backlog

1. OSRM shape refinement for `shapes.txt`.
2. Optional `frequencies.txt` for routes 1, 6, 10 (do not invent stop times).
3. GTFS validator in CI.

## Segment recalculation (done)

`npm run calculate:segments` / `node scripts/calculate_segment_durations.js` reads the DB and writes OSRM-based `TransportSegment` rows after Map Editor changes.

## Verdict

Storage contract is DB-backed and admin-editable; the public product is a map-first planner at `/transport`; GTFS export continues from the same normalized model.
