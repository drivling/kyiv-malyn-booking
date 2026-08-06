# Malyn local transport — GTFS feed

How to build and validate a Google-compatible **GTFS Static** feed from PostgreSQL.

## Build

```bash
# ensure DB is seeded
cd backend && npm run seed:transport   # first time / reset from runtime JSON

cd backend && npm run export:gtfs
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
  shapes.txt
  feed_info.txt
  malyn-gtfs.zip
```

Agency metadata lives in `TransportMeta.payload.agency` (seeded from `runtime/agency.json`).

## What is exported

| Included | Notes |
| -------- | ----- |
| Trips with `departureTime` | Verified timed routes (2, 3, 5, 7, 8, 9, 11, 12) |
| Passenger stops | Only stops referenced by `stop_times`; `mapOnly` points excluded from `stops.txt` |
| `route_type=3` | Bus / marshrutka |
| Synthetic `stop_times` | First stop = departure; later = Σ segment seconds along full chain (incl. technical points) |
| `shapes.txt` | One polyline per route+direction from ordered points incl. `mapOnly`; trips carry `shape_id` |
| `feed_info.txt` | Publisher, contact, validity dates (shared with `calendar.txt`), `feed_version` = export date |

| Omitted | Why |
| ------- | --- |
| Routes 1, 6, 10 | No clock times (vehicle plates only) |
| OSRM shape refinement | Optional backlog |
| GTFS-Realtime | Not in scope |

## Validation

```bash
docker run --rm -v "$PWD/data/malyn-transport:/work" ghcr.io/mobilitydata/gtfs-validator:latest \
  -i /work/gtfs/malyn-gtfs.zip -o /work/validation
```

Reports land in `data/malyn-transport/validation/` (generated, not committed).

Status 2026-08-06: zero errors; remaining warnings are `mixed_case_recommended_field` on abbreviated stop names («ЗОШ», «ОМБ») — accepted as-is.

## Google Maps publication

Engineering delivers a valid zip. Live Google Transit listing requires an **official organizer** via [Google Transit Partners](https://maps.google.com/transitpartners/). Dataset contact: ekonomika.malin@ukr.net.

See also: `Docs/local-transport-db-refactoring-result.md`.
