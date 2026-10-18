# Malyn local transport — GTFS feed

How to build and validate a Google-compatible **GTFS Static** feed from PostgreSQL.

## Public feed (since stage 3, 2026-10)

The same generator (`backend/src/gtfs-feed.ts`) serves the feed from the live database:

- `GET https://malin.kiev.ua/transport/gtfs.zip` (302 to the backend, `curl -L`) — full feed, `Cache-Control: public, max-age=300`, `ETag: "<revision>"`;
- `GET …/transport/gtfs/feed_info.txt` (or any other feed file) — one file as text, same headers.

`feed_version` = dataset `revision` (`TransportMeta.updatedAt`, ISO). License and attribution: `LICENSE.txt`
inside the zip. For people: `Docs/transport-open-data.md`; decisions: `Docs/transport-open-data-2026-10.md`.

## Build (files on disk)

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
  LICENSE.txt
  malyn-gtfs.zip
```

The zip is written by `backend/src/zip.ts` (no system `zip` needed); file timestamps inside it equal the revision, so
the same revision always gives the same bytes.

Agency metadata lives in `TransportMeta.payload.agency` (seeded from `runtime/agency.json`).

## What is exported

| Included | Notes |
| -------- | ----- |
| Trips with `departureTime` | Verified timed routes (2, 3, 5, 7, 8, 9, 11, 12) |
| Passenger stops | Only stops referenced by `stop_times`; `mapOnly` points excluded from `stops.txt` |
| `route_type=3` | Bus / marshrutka |
| Synthetic `stop_times` | First stop = departure; later = Σ segment seconds along full chain (incl. technical points); trip timepoints (sheet times) are exact and marked `timepoint=1` |
| Route variants | A trip with `variantId` follows its variant chain (`Docs/route-variants-2026-10.md`) |
| `shapes.txt` | One polyline per route+direction (and per variant: `shp_<route>_<dir>_<variant>`) from ordered points incl. `mapOnly`; trips carry `shape_id` |
| `feed_info.txt` | Publisher, contact, validity dates (shared with `calendar.txt`), `feed_version` = dataset `revision` (export date only when the DB has no revision) |
| `LICENSE.txt` | Data license (`OPEN_DATA_LICENSE` in `gtfs-feed.ts`), attribution, feed version |

| Omitted | Why |
| ------- | --- |
| Routes 1, 10 (ex-№6), 10-old | No clock times (vehicle plates only) |
| Routes flagged `unreliable` in admin («Ненадійний — приховати») | Hidden from the site/SEO, so omitted from the feed too |
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
