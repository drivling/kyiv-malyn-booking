# Local Transport → GTFS: architectural review & refactoring plan

**Status:** approved roadmap  
**Created:** 2026-08-06  
**Scope:** city transport Malyn (`/localtransport`), not intercity booking (`Schedule` / Prisma)

---

## 1. Verdict

The product idea is sound: a **local trips site** (Jakdojade-style planner + stop board + route map) with a **git-backed JSON CMS** and a map admin that already edits coordinates and stop order well.

The data is **GTFS-inspired in naming only**. It is not Google Transit–ready yet: there is no `stop_times`, no proper `calendar`/`agency`, `block_id` is overloaded (vehicle plate **or** departure time), shapes are polylines through stops, and the same JSON is duplicated in three places.

**Target:** keep the admin UX and the site, make the **storage contract GTFS-compatible**, and add an **exportable GTFS feed**. Do **not** move city transport into PostgreSQL in this refactor (booking DB stays separate). Google publication remains an organizational step (city / licensed operator → Transit Partners); engineering delivers a valid feed and a clean internal model.

---

## 2. Current architecture (as-is)

### 2.1 Two transport domains (do not conflate)

| Domain | Purpose | Storage | UI |
|--------|---------|---------|-----|
| Intercity marshrutky | Seat booking | Prisma `Schedule` / `Booking` | `/booking`, `/mizhgorodski`, admin «Графіки» |
| City transport Malyn | Schedule, map, planner | JSON files | `/localtransport`, admin «Редактор карти», Android |

This plan covers **city transport only**.

### 2.2 Runtime data files

| File | Role |
|------|------|
| `malyn_transport.json` | Trips (`records`) + `supplement` (routes meta, stops catalog, order) |
| `stops_coords.json` | `center` + `stops[st_XXXX] = [lat, lng]` |
| `segmentDurations.json` | Per-route segment seconds between consecutive stops |

Copies today:

- `frontend/public/data/` — site static
- `backend/localtransport-data/` — `GET /localtransport/data` (Android)
- `frontend/src/pages/LocalTransportPage/segmentDurations.json` — bundled in JS

### 2.3 Logical model

```
Route (route_id)
  ├── supplement.routes[id]     # from/to, streets, human schedule text
  ├── records[]                 # trips (trip_id, direction_id, block_id?, …)
  └── stops_by_route[id][]      # order_there / order_back, map_only, id→catalog

Stop
  ├── stops_catalog[id].name
  └── stops_coords.stops[id]

Trip timing at stop i (runtime, not stored):
  base = parseTime(block_id)   # only when block_id looks like HH:MM
  + Σ segmentDurations along ordered stops
```

### 2.4 Admin workflow (keep)

1. Map Editor loads static JSON.
2. Edits markers / order / `map_only` in memory.
3. Downloads JSON; human replaces files in repo; optional `calculate_segment_durations.js`.
4. Deploy: site ← static; Android ← API bundle.

**Preserve:** coordinate drag, direction order editor, technical (`map_only`) points, download-based save.  
**Improve later (optional):** write API / single canonical path so download is not the only sync path — not a blocker for GTFS.

### 2.5 Consumers

- Web: `/data/*.json` + imported segment durations
- Android: `GET /localtransport/data` → `{ transport, coords, segments }`
- No public GTFS zip today

---

## 3. GTFS gap analysis

### Strengths (reuse)

- Stable `st_XXXX` ≈ `stop_id`
- `route_id`, `trip_id`, `direction_id`, `trip_headsign`
- Ordered stops per direction ≈ `stop_sequence`
- Segment durations ≈ engine to **synthesize** `stop_times`
- Verified routes (2,3,5,7,8,9,11,12) already usable for timing

### Gaps (must fix for Google-compatible feed)

| Gap | Impact |
|-----|--------|
| No `stop_times.txt` | Google / validators require arrival/departure per stop |
| `block_id` dual meaning | Time vs vehicle plate; breaks GTFS semantics and our parsers |
| No `agency.txt` | Required |
| `service_id` is a Ukrainian weekday string | Need `calendar.txt` (+ optional `calendar_dates`) |
| No `routes.txt` fields (`route_type`, `route_short_name`) | Required; marshrutka → usually `route_type=3` |
| No `shapes.txt` | Optional for Google but improves map; `map_only` points are shape material |
| Duplicate JSON trees | Drift risk between web and API |
| Incomplete timed routes (1, 6, 10) | Feed should omit or mark frequency-only; do not invent times |

### Non-engineering for Google Maps live

Registration via **Google Transit Partners** needs official organizer / licensed carrier. Engineering delivers a validated GTFS zip and docs; city/operator submits.

---

## 4. Target architecture (to-be)

### 4.1 Principles

1. **Site-first product** — planner/stop board remain primary UX; GTFS is an export + interchange format.
2. **Canonical runtime dataset** — one directory; sync to frontend/backend copies.
3. **GTFS-aligned internal fields** — same ids and semantics as export where possible.
4. **Admin stays JSON-friendly** — no forced Prisma migration for city data in this program.
5. **Honest feed** — only trips with real departure times enter `stop_times`; others stay in app supplement only or future `frequencies.txt`.

### 4.2 Target storage layout

```
data/malyn-transport/runtime/          # CANONICAL
  malyn_transport.json
  stops_coords.json
  segmentDurations.json
  agency.json                          # agency meta for export

data/malyn-transport/gtfs/             # GENERATED (optional commit of zip)
  agency.txt, stops.txt, routes.txt, trips.txt,
  stop_times.txt, calendar.txt, [shapes.txt]
  malyn-gtfs.zip

frontend/public/data/                  # synced copy for static site
backend/localtransport-data/           # synced copy for API
```

### 4.3 Normalized trip record

```ts
interface TransportRecord {
  route_id: string;
  service_id: string;          // e.g. "everyday" → calendar.txt
  trip_id: string;
  trip_headsign: string;
  direction_id: "0" | "1";
  /** GTFS departure from first stop (HH:MM:SS or HH:MM). Preferred time source. */
  departure_time?: string;
  /** GTFS block_id = vehicle/block only (plate). Never store clock time here. */
  block_id?: string;
  shape_id?: string;
  wheelchair_accessible?: string;
  bikes_allowed?: string;
}
```

Migration rule:

- If `block_id` matches time → copy to `departure_time`, clear time from `block_id`.
- If `block_id` looks like plate → keep as `block_id`, leave `departure_time` empty.

### 4.4 GTFS mapping

| GTFS file | Source |
|-----------|--------|
| `agency.txt` | `agency.json` / supplement.contacts |
| `stops.txt` | catalog + coords; exclude pure shape waypoints or export as non-boarding if needed |
| `routes.txt` | route_id, short_name=id, long_name=from–to, route_type=3 |
| `trips.txt` | records with usable `departure_time` |
| `stop_times.txt` | ordered passenger stops + cumulative segment durations |
| `calendar.txt` | map service_id → mon–sun flags |
| `shapes.txt` (phase later) | ordered coords including `map_only` |

Passenger stops for `stop_times`: `map_only !== true` and `order_* > 0`.  
Shape points may include `map_only` in a later phase.

### 4.5 Runtime timing (app)

```
departure_at_stop ≈ parse(departure_time ?? legacy block_id time) + Σ segments
```

One helper module; stop using ad-hoc `block_id` time parsing in multiple files.

---

## 5. Refactoring stages

Each stage: small PR-sized change → **commit + push**. Admin UX must keep working.

### Stage 0 — Plan (this document)

- [x] Architectural review + roadmap in `Docs/`

### Stage 1 — Single source of truth + sync

**Goal:** eliminate silent drift between web and API copies.

- [x] Create `data/malyn-transport/runtime/` as canonical.
- [x] Script `scripts/sync-localtransport-data.mjs`
- [x] Document + update segment calculator paths

**Done when:** one command refreshes all consumers; MD5 of the three trees match after sync.

### Stage 2 — Normalize `departure_time` / `block_id`

- [x] Add `departure_time` to types and records
- [x] Migration script + parser update
- [x] UI dual-read helper (`tripDeparture.ts`)

### Stage 3 — GTFS export (required files)

- [x] `scripts/export-malyn-gtfs.mjs` → `data/malyn-transport/gtfs/`
- [x] Feed docs: `Docs/local-transport-gtfs-feed.md`

### Stage 4 — App reads `departure_time`

- [x] Shared helper; LocalTransport pages updated (shipped with stage 2)

### Stage 5 — Calendar / agency polish + feed docs

- [x] `agency.json`, `calendar.txt` (everyday / weekdays), feed docs

### Closing report

- [x] `Docs/local-transport-gtfs-refactoring-result.md`

### Stage 6 — Optional shapes (backlog)

- Export `shapes.txt` / `shape_id` from ordered coords + `map_only`
- Optional OSRM geometry refinement

### Stage 7 — Optional admin persist (backlog)

- Authenticated `PUT` to write runtime JSON (or PR bot)
- Keep download as fallback

### Stage 8 — Frequencies / incomplete routes (backlog)

- Routes 1, 6, 10: human schedule / intervals → `frequencies.txt` or stay app-only
- Do not invent fake `stop_times`

---

## 6. Explicit non-goals (this program)

- Migrating city transport into Prisma/PostgreSQL
- Unifying with intercity `Schedule` booking
- Live GPS / GTFS-Realtime (future product)
- Submitting the feed to Google on behalf of the city (needs legal operator)
- Redesigning Map Editor UX (preserve; only data contract)

---

## 7. Success criteria

| Criterion | Measure |
|-----------|---------|
| Canonical data | Sync script; no intentional divergent copies |
| Time semantics | `departure_time` vs vehicle `block_id` separated |
| GTFS static feed | Required txt files + zip from one command |
| Site parity | Planner/map/stop board unchanged for verified routes |
| Admin | Map Editor still edits coords/order and downloads JSON |
| Google path | Feed valid locally; docs describe Transit Partners handoff |

---

## 8. Suggested execution order (commits)

1. Plan document (this file)
2. Stage 1 — runtime + sync
3. Stage 2 — departure_time migration
4. Stage 3 — GTFS exporter
5. Stage 4 — frontend helper adoption
6. Stage 5 — agency/calendar docs
7. Closing report: `Docs/local-transport-gtfs-refactoring-result.md`

Stages 6–8 remain backlog after the closing report unless pulled forward.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Breaking time display | Dual-read `departure_time` then legacy `block_id` |
| Admin download overwrites wrong path | Docs: drop into `runtime/`, run sync |
| Invalid GTFS from map_only | Exclude from stop_times; keep for shapes later |
| Incomplete routes in feed | Export only timed trips; document gaps |
| Android lag | Additive JSON field; old clients ignore unknown keys |

---

## 10. References

- [GTFS Static Reference](https://gtfs.org/schedule/reference/)
- [Google Transit Partners](https://maps.google.com/transitpartners/) (operator onboarding)
- Internal: `data/malyn-transport/README.md`, `LOCAL_TRANSPORT_ANDROID_APP.md`
- Contact on open data set: ekonomika.malin@ukr.net (city dataset owner)
