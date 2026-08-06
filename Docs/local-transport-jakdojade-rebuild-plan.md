# Rebuild /transport on LocalTransport + Jakdojade

**Status:** in progress  
**Created:** 2026-08-06  
**Push:** none (local commits only)

## Goal

Replace the thin `TransportPage` skeleton with the restored **LocalTransportPage** UX (planner, RouteMap, stop board, mobile sheet), fed only by `GET /transport/dataset`. Visual target: Jakdojade (left panel + full-bleed map; wtk-red `#E30613`).

## Data

Admin MapEditor → `PUT /transport/dataset` → PostgreSQL → `GET /transport/dataset` → public `/transport*` UI.

Segments from `dataset.segments` / `meta.defaultSec` — not from static JSON files.

## Commits checklist

- [ ] **0** — This plan + fix broken `App.tsx` (imports + NavBar)
- [ ] **1** — `TransportDataset` → Local view-model adapter + tests
- [ ] **2** — Public page loads only via API hook
- [ ] **3** — Mount Local UX under `/transport*`; drop `/localtransport` + thin UI
- [ ] **4** — RouteMap 1:1 with coords from dataset
- [ ] **5** — Planner panel+map, connecting routes, geo, mobile sheet
- [ ] **6** — Route detail: bar, direction, tablica, timeline, print
- [ ] **7** — Stop board + SubNav on dataset
- [ ] **8** — Jakdojade wtk-red theme; update `JAKDOJADE_UX.md`
- [ ] **9** — QR/deep-links on `/transport`
- [ ] **10** — Remove dead duplicates; no static JSON
- [ ] **11** — Smoke checklist + regressions
- [ ] **12** — Result report `Docs/local-transport-jakdojade-rebuild-result.md`

## Rules

- One checklist item → one English git commit.
- No `git push`.
- UX conflicts → LocalTransport code wins; visual conflicts → Jakdojade red + panel/map layout.
- Admin / Prisma / OSRM recalculate stay intact.
