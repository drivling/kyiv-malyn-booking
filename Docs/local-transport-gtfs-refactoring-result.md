# Local Transport → GTFS: refactoring result

**Date:** 2026-08-06  
**Plan:** [local-transport-gtfs-refactoring-plan.md](./local-transport-gtfs-refactoring-plan.md)  
**Feed howto:** [local-transport-gtfs-feed.md](./local-transport-gtfs-feed.md)

---

## Summary

City transport Malyn stays a **JSON-backed trips site** with the existing map admin. Storage is now **GTFS-aligned**, and a **static GTFS zip** can be built in one command for validation and official Google Transit onboarding.

Intercity booking (Prisma `Schedule`) was not changed.

---

## What shipped

| Stage | Commit theme | Outcome |
|-------|----------------|---------|
| 0 | Plan | Architecture review + roadmap in Docs |
| 1 | Canonical runtime + sync | `data/malyn-transport/runtime/` → site + API via `sync-localtransport-data.mjs` |
| 2 | `departure_time` vs `block_id` | 184 timed trips use `departure_time`; 12 plate-only trips keep vehicle `block_id`; UI reads the new field |
| 3 | GTFS export | Required static files + `malyn-gtfs.zip` (8 routes, 184 trips, 3301 stop_times, 117 stops) |
| 4 | App readers | `tripDeparture.ts` shared helper (done with stage 2 to avoid breaking the site) |

### Commands

```bash
node scripts/sync-localtransport-data.mjs
node scripts/migrate-departure-time.mjs   # idempotent if already migrated
node scripts/export-malyn-gtfs.mjs
```

### Feed snapshot (export at completion)

- **Routes:** 2, 3, 5, 7, 8, 9, 11, 12 (`route_type=3`)
- **Omitted from feed:** 1, 6, 10 (no clock times)
- **Zip:** `data/malyn-transport/gtfs/malyn-gtfs.zip`

---

## Architecture after refactor

```
Admin Map Editor (download JSON)
        ↓ drop into runtime/
data/malyn-transport/runtime/     ← canonical
        ↓ sync-localtransport-data.mjs
   ├── frontend/public/data/      ← website
   ├── backend/localtransport-data/ ← Android API
   └── segmentDurations bundle
        ↓ export-malyn-gtfs.mjs
data/malyn-transport/gtfs/*.txt + malyn-gtfs.zip
```

**Preserved:** coordinate drag, direction order editor, `map_only` technical points, download-based CMS.

**Improved:** one source of truth; honest time semantics; Google-compatible export path.

---

## Google Maps status

| Ready | Not ready / external |
|-------|----------------------|
| Validatable GTFS Static zip | Transit Partners registration (city / licensed carrier) |
| Agency + calendar + stop_times | Official sign-off on schedule accuracy |
| Docs for handoff | Live publication timeline (weeks after approval) |

Engineering cannot publish to Google Maps without the operator. Contact on the open dataset: ekonomika.malin@ukr.net.

---

## Backlog (plan stages 6–8)

1. **`shapes.txt`** — polylines including `map_only` / optional OSRM geometry  
2. **Admin write API** — optional; download + sync remains fine  
3. **`frequencies.txt` / app-only** for routes 1, 6, 10 — do not invent fake stop times  
4. **Android** — already receives JSON; can prefer `departure_time` explicitly if needed  
5. **External GTFS Validator CI** — MobilityData validator in CI on export  

---

## Files to know

| Path                                            | Role                              |
| ----------------------------------------------- | --------------------------------- |
| `Docs/local-transport-gtfs-refactoring-plan.md` | Full review + roadmap             |
| `Docs/local-transport-gtfs-feed.md`             | Build / validate / Google handoff |
| `data/malyn-transport/runtime/`                 | Canonical dataset + `agency.json` |
| `scripts/sync-localtransport-data.mjs`          | Copy runtime → consumers          |
| `scripts/migrate-departure-time.mjs`            | Time field normalization          |
| `scripts/export-malyn-gtfs.mjs`                 | GTFS generator                    |
| `frontend/.../tripDeparture.ts`                 | Site departure helper             |

---

## Verdict

The product remains a **local trips website** with a usable map admin. The storage contract is now **Google-compatible enough to export a real GTFS feed**; remaining work is shapes polish, incomplete routes policy, and the **organizational** Transit Partners submission—not another storage rewrite.
