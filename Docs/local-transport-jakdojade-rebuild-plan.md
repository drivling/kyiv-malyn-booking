# Rebuild /transport on LocalTransport + Jakdojade

**Status:** complete (local commits, no push)  
**Created:** 2026-08-06  

## Goal

Replace the thin `TransportPage` skeleton with the restored **LocalTransportPage** UX (planner, RouteMap, stop board, mobile sheet), fed only by `GET /transport/dataset`. Layout: Jakdojade panel + map. Colors: site BBC cyan (not wtk-red).

## Data

Admin MapEditor → `PUT /transport/dataset` → PostgreSQL → `GET /transport/dataset` → public `/transport*` UI.

Segments from `dataset.segments` / `meta.defaultSec`.

## Commits checklist

- [x] **0** — This plan + fix broken `App.tsx` (imports + NavBar)
- [x] **1** — `TransportDataset` → Local view-model adapter + tests
- [x] **2** — Public page loads only via API hook
- [x] **3** — Mount Local UX under `/transport*`; drop `/localtransport` + thin UI
- [x] **4** — RouteMap 1:1 with coords from dataset
- [x] **5** — Planner panel+map, connecting routes, geo, mobile sheet
- [x] **6** — Route detail: bar, direction, tablica, timeline, print
- [x] **7** — Stop board + SubNav on dataset
- [x] **8** — Theme aligned to site cyan; update `JAKDOJADE_UX.md`
- [x] **9** — QR/deep-links on `/transport`
- [x] **10** — Remove dead duplicates; no static JSON
- [x] **11** — Smoke checklist (`Docs/local-transport-jakdojade-smoke.md`)
- [ ] **12** — Result report `Docs/local-transport-jakdojade-rebuild-result.md`

## Rules

- One checklist item → one English git commit.
- No `git push`.
- UX conflicts → LocalTransport code wins; visual conflicts → Jakdojade panel/map + site brand colors.
- Admin / Prisma / OSRM recalculate stay intact.
