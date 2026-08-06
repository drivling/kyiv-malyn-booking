# Malyn local transport — GTFS feed

How to build and validate a Google-compatible **GTFS Static** feed from the site’s runtime JSON.

## Build

```bash
# optional: keep copies in sync first
node scripts/sync-localtransport-data.mjs

node scripts/export-malyn-gtfs.mjs
```

Output:

```
data/malyn-transport/gtfs/
  agency.txt
  stops.txt
  routes.txt
  trips.txt
  stop_times.txt
  calendar.txt
  malyn-gtfs.zip
```

Agency metadata: `data/malyn-transport/runtime/agency.json`.

## What is exported

| Included | Notes |
|----------|--------|
| Trips with `departure_time` | Verified timed routes (2, 3, 5, 7, 8, 9, 11, 12) |
| Passenger stops | `map_only` points excluded from `stop_times` |
| `route_type=3` | Bus / marshrutka |
| Synthetic `stop_times` | First stop = `departure_time`; later stops = Σ `segmentDurations` along the full chain (incl. technical points) |

| Omitted | Why |
|---------|-----|
| Routes 1, 6, 10 | Only vehicle plates in `block_id`, no clock times |
| `shapes.txt` | Planned later (polyline / OSRM) |
| GTFS-Realtime | Not in scope |

## Validation

1. [MobilityData GTFS Validator](https://github.com/MobilityData/gtfs-validator) on `malyn-gtfs.zip`
2. Or load the zip in a GTFS viewer / OpenTripPlanner for a smoke test

Expect warnings about estimated (non-timepoint) intermediate stops — that is intentional until official stop times exist.

## Google Maps publication

Engineering delivers a valid zip. Live Google Transit listing requires an **official organizer** (city transport department or licensed carrier) via [Google Transit Partners](https://maps.google.com/transitpartners/). Dataset contact on data.gov.ua: ekonomika.malin@ukr.net.

See also: `Docs/local-transport-gtfs-refactoring-plan.md`.
