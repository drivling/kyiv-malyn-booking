# Local transport Jakdojade rebuild — result

**Date:** 2026-08-06  
**Push:** none (local commits only)

## Verdict

Public `/transport*` again uses the full **LocalTransport** planner / RouteMap / stop-board UX, fed only by **`GET /transport/dataset`**. The thin TransportPage skeleton is gone. Layout stays Jakdojade (panel + map, mobile sheet). Brand colors follow the main site (BBC cyan), not wtk-red.

## Ported from Local

- Planner: З / ⇄ / До, date/time, connecting routes only, next departure at from-stop, verified pills
- RouteMap: verified polyline, map_only filtering, radial pick, frequent destinations, mobile sheet + `invalidateSize`
- Route detail: direction rematch by coordinates, tablica Відправлення|Прибуття, stop timeline, print
- Stop board: countdown cards, full-day toggle, deep-links into detail
- SubNav between planner and stop board
- Geo nearest stops from dataset coords
- QR helper `buildStopRouteQrUrl` → `/transport/route/...?stop&dir` (nearest trip without `time`)

## Aligned with Jakdojade / site

| Area | Decision |
|------|----------|
| URLs | `/transport`, `/transport/:from/:to`, `/transport/route/:id`, `/transport/stop/:id` |
| Legacy | `/localtransport*` → `/transport*` redirect |
| Data | API dataset only; segments via `configureSegmentDurations` |
| Theme | Site cyan `#00aff5` / text `#054752` (see `JAKDOJADE_UX.md`) |
| NavBar | Single «Транспорт Малина» → `/transport` |

## Intentionally not done

- Arrival-mode («прибуття о»)
- Transfers, live GPS, embed widget
- Pixel-perfect Jakdojade measurements / wtk-red `#E30613`

## Key paths

| Path | Role |
|------|------|
| `frontend/src/pages/LocalTransportPage/` | Public UI |
| `frontend/src/pages/TransportPage/datasetAdapter.ts` | Dataset → Local view-model |
| `frontend/src/pages/TransportPage/useTransportDataset.ts` | Cached API loader |
| `Docs/local-transport-jakdojade-smoke.md` | Manual smoke checklist |

## Commits (this rebuild)

See `git log` from plan commit through this result; checklist in `Docs/local-transport-jakdojade-rebuild-plan.md`.
