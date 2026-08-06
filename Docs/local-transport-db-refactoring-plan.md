# Local Transport: JSON → PostgreSQL + Jakdojade-style page

**Status:** done  
**Created:** 2026-08-06  
**Scope:** city transport Malyn; intercity booking is untouched.

Deep refactor of the local transport pipeline:

- move data from JSON files into PostgreSQL (normalized GTFS-aligned tables);
- admin Map Editor saves to DB via API instead of downloading files (plus a "load from DB" revert button);
- remove Android app support from the backend;
- new public page copying the Jakdojade UX; old `/localtransport` page and URLs are removed.

## Target architecture

```
Admin MapEditorTab ──PUT /transport/dataset (admin auth)──▶ Express API ──▶ PostgreSQL (Transport* tables)
Site /transport    ◀─GET /transport/dataset (public)────── Express API ◀── PostgreSQL
GTFS export        ◀─backend script via Prisma ─────────── PostgreSQL
Seed (one-time)    ── data/malyn-transport/runtime/*.json ─▶ PostgreSQL
```

## Tasks

### Stage 0 — Plan

- [x] This document, committed.

### Stage 1 — Remove Android support

- [x] Commit the already-staged deletion of `android-malyn-transport/` (44 files).
- [x] Remove `GET /localtransport/data` from `backend/src/routes/public-routes.ts` + its smoke test.
- [x] Delete `backend/localtransport-data/`, `LOCAL_TRANSPORT_ANDROID_APP.md`.
- [x] Drop the backend target from `scripts/sync-localtransport-data.mjs`.
- [x] Rebuild `backend/dist`, commit.

### Stage 2 — Prisma schema + seed

- [x] Models: `TransportStop`, `TransportRoute`, `TransportRouteStop`, `TransportTrip`, `TransportSegment`, `TransportMeta` (singleton JSONB).
- [x] `prisma migrate dev` migration.
- [x] Idempotent seed `backend/src/scripts/seed-local-transport.ts` reading `data/malyn-transport/runtime/*.json`.
- [x] Commit.

### Stage 3 — Backend API

- [x] `GET /transport/dataset` (public, cached) — full normalized dataset.
- [x] `PUT /transport/dataset` (requireAdmin) — transactional replace with validation.
- [x] Router `backend/src/routes/transport.ts`, mounted in `create-app.ts`; tests.
- [x] Commit.

### Stage 4 — GTFS export from DB

- [x] Port `scripts/export-malyn-gtfs.mjs` to `backend/src/scripts/export-gtfs.ts` (Prisma reads, same txt/zip output).
- [x] npm script; delete old exporter in Stage 7.
- [x] Commit.

### Stage 5 — Admin saves to DB

- [x] `MapEditorTab` loads via `apiClient` from `GET /transport/dataset`.
- [x] "Зберегти в базу" → `PUT /transport/dataset` (with confirmation).
- [x] "Завантажити з бази" → re-GET, discard unsaved edits.
- [x] Remove file-download buttons. Commit.

### Stage 6 — New Jakdojade-style page

- [x] `frontend/src/pages/TransportPage/`: planner over full-screen map, stop autocomplete, departures.
- [x] Routes: `/transport`, `/transport/routes`, `/transport/route/:routeId`, `/transport/stop/:stopId`.
- [x] Data via `GET /transport/dataset`; timing helpers ported.
- [x] Delete `LocalTransportPage/`, old routes; NavBar link → `/transport`. Commit.

### Stage 7 — Cleanup + docs

- [x] Delete `frontend/public/data/*.json`, bundled `segmentDurations.json`, `sync-localtransport-data.mjs`, `migrate-departure-time.mjs`, `scripts/export-malyn-gtfs.mjs`.
- [x] Update `data/malyn-transport/README.md`, `Docs/local-transport-gtfs-feed.md`.
- [x] Result report `Docs/local-transport-db-refactoring-result.md`.
- [x] Final: tests, GTFS validation, commit, **push**.

## Notes / risks

- `backend/dist` and the Prisma client are committed: after schema changes run `prisma generate` and rebuild dist before committing (pre-commit hook runs tests).
- Production `npm start` runs `prisma migrate deploy`; run the seed once on prod after deploy.
- OSRM segment recalculation (`calculate_segment_durations.js`) stays file-based → backlog to rework against DB; `defaultSec` fallback covers new segments meanwhile.
- No legacy URL redirects for `/localtransport*` (agreed).
