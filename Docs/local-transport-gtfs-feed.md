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
  shapes.txt
  feed_info.txt
  malyn-gtfs.zip
```

Agency metadata: `data/malyn-transport/runtime/agency.json`.

## What is exported

| Included                    | Notes                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Trips with `departure_time` | Verified timed routes (2, 3, 5, 7, 8, 9, 11, 12)                                                                |
| Passenger stops             | Only stops referenced by `stop_times`; `map_only` points and stops without trips excluded from `stops.txt`      |
| `route_type=3`              | Bus / marshrutka                                                                                                |
| Synthetic `stop_times`      | First stop = `departure_time`; later stops = Σ `segmentDurations` along the full chain (incl. technical points) |
| `shapes.txt`                | One polyline per route+direction from ordered points incl. `map_only`; trips carry `shape_id`                   |
| `feed_info.txt`             | Publisher, contact, validity dates (shared with `calendar.txt`), `feed_version` = export date                   |

| Omitted         | Why                                               |
| --------------- | ------------------------------------------------- |
| Routes 1, 6, 10 | Only vehicle plates in `block_id`, no clock times |
| OSRM shape refinement | Optional backlog (straight lines between points for now) |
| GTFS-Realtime   | Not in scope                                      |

## Validation

1. [MobilityData GTFS Validator](https://github.com/MobilityData/gtfs-validator) on `malyn-gtfs.zip`:

```bash
docker run --rm -v "$PWD/data/malyn-transport:/work" ghcr.io/mobilitydata/gtfs-validator:latest \
  -i /work/gtfs/malyn-gtfs.zip -o /work/validation
```

Reports land in `data/malyn-transport/validation/` (generated, not committed).

2. Or load the zip in a GTFS viewer / OpenTripPlanner for a smoke test.

Status 2026-08-06: zero errors; remaining warnings are `mixed_case_recommended_field` on abbreviated stop names («ЗОШ», «ОМБ») — accepted as-is.

## Google Maps publication

Engineering delivers a valid zip. Live Google Transit listing requires an **official organizer** (city transport department or licensed carrier) via [Google Transit Partners](https://maps.google.com/transitpartners/). Dataset contact on data.gov.ua: ekonomika.malin@ukr.net.

See also: `Docs/local-transport-gtfs-refactoring-plan.md`.
