# Testing guide (Apple-grade pyramid)

## Principles

- Pyramid: many fast unit tests → fewer integration tests → thin e2e (3–4 smoke flows).
- Test behaviour and contracts, not layout snapshots.
- Every production bug should become a regression test.
- Coverage gates only on critical modules (not decorative UI).
- No flaky tests: fake timers, mocks; never hit live Telegram / Viber / TikTok in CI.

## Commands

From repo root:

```bash
npm test                 # backend + frontend Vitest
npm run test:backend
npm run test:frontend
npm run test:coverage    # both packages with thresholds
npm run test:e2e         # Playwright (frontend; skeleton skip until iter 2)
```

Backend only:

```bash
cd backend
npm test
npm run test:watch
npm run test:coverage
npm run test:integration-db   # needs DATABASE_URL / INTEGRATION_DATABASE_URL
```

Frontend only:

```bash
cd frontend
npm test
npm run test:watch
npm run test:coverage
npm run test:e2e
```

Pre-commit (husky) runs `npm test` (unit only, no Playwright).

CI also runs Playwright e2e (mocked API, Vite on port 4177).

## Stack

| Layer | Tooling |
|-------|---------|
| Backend unit/integration | Vitest (`node`), `supertest`, Prisma stubs / DI hooks |
| Frontend unit/integration | Vitest (`jsdom`), Testing Library, MSW handlers in `frontend/src/test/msw/` |
| E2E | Playwright (`frontend/e2e/`), against `vite preview` |

## Backend test helpers

- `vitest.setup.ts` strips `TELEGRAM_BOT_TOKEN` so imports do not start bot polling.
- DI for tests: `setTelegramPrismaForTests`, `setTelegramBotForTests`, `setSpawnForTests` (and matching `reset*`) in `telegram.ts`.
- HTTP apps: `createApp({ prisma, adminPassword })` + `supertest` (no `listen`).
- Stubs: `http-test-prisma-stub.ts`, `integration-prisma-mock.ts`.

## Frontend test helpers

- `src/test/setup.ts` — jest-dom matchers, clear storage.
- `src/test/utils.tsx` — `renderWithProviders` (`MemoryRouter`).
- `src/test/msw/handlers.ts` — stubs for `/api/admin/login`, `/api/admin/check`, `/api/transport/dataset`.

## P0 coverage (iteration 2)

- Admin auth: `ProtectedRoute`, `LoginPage` admin mode, `apiClient` token helpers (Vitest + MSW).
- Admin HTTP: login/check (existing), transport dataset (existing), viber listings POST (existing), `GET /admin/referrals/report`.
- Transport smoke: `stopCatalog`, `tripDeparture`, `LocalTransportSubNav`, `useTransportDataset`.
- Transport UX (planner, route page, stop board, scheme): `LocalTransportPage.planner.test.tsx`, `LocalTransportPage.detail.test.tsx`, `LocalTransportStopBoardPage.test.tsx`, `LocalTransportSchemePage.test.tsx`, `LocalTransportSchemeMini.test.tsx`, `LocalTransportMapOverlay.test.tsx`, `DateTimeControls.test.tsx`; pure helpers `routeGeometry`, `nearestTrip`, `schemeStops`, `schemeMini`, `stopDepartures` (RouteMap/Leaflet mocked, dataset via MSW).
- Admin map editor: `stopRename` (pure rename, propagation to route termini/headsigns, change count) + `MapEditorTab.test.tsx` (react-leaflet mocked, MSW `PUT /transport/dataset` captured).
- Stop stickers (`/admin/stickers`): `stopSticker/stickerModel.test.ts` (lines per direction, sides by travel bearing, short-turn trips, hidden/map-only routes, side headings), `stickerSvg.test.ts` (A5/A4 mm sheet, strip vs compact rows, QR path, escaping, text fitting), `stickerSheets.test.ts` (split/single sheets, QR URL on the primary domain with utm, print HTML with `@page`), `StopStickerTab.test.tsx` (`?stop=`, moving a line between sides, single sticker, print mocked, stop picker writes `?stop=`).
- Lunch history endpoint: `backend/src/admin-lunch-history-http.test.ts`.
- Lunch admin (per-person reparse, «who wrote today» from Dzhura, order cancel, synonym single-owner): `backend/src/admin-lunch-people-http.test.ts`, `backend/src/lunch-synonyms.test.ts`, `frontend/.../LunchTab.test.tsx`.
- Dzhura (chat capture, phases 0–1): `backend/src/dzhura.test.ts` (Kyiv day range → UTC incl. DST, date validation, export payload with BigInt → string, messages query/cursor, queue stats/retry), `backend/src/admin-dzhura-http.test.ts` (auth, lunch-group lock, jobs validation/409, export headers, messages endpoint, queue retry), `frontend/.../DzhuraTab.test.tsx` (flags PATCH, backfill polling, JSON download via Blob, listener status, private-chat toggle + chat search, messages panel with search/cursor, queue retry).
- Intercity trips: `schedule-trip` util, schedules/trip-points/trip-routes HTTP, `mizhUtils` train filter + listing dual-read, Telegram elektrichka helpers, gold `TripRoute` identity (see `Docs/gold-route-model-smoke.md`).
- Poputky OD scale: `TripPoint.appearInPoputky`, listing/booking `fromPointId`/`toPointId`, exact OD match + dual-read (`poputky-od.test.ts`, `mizhUtils`); smoke: `Docs/poputky-od-city-scale-smoke.md`.
- Playwright: `e2e/auth.spec.ts`, `e2e/transport.spec.ts`, `e2e/booking.spec.ts`, `e2e/train.spec.ts` (API mocked via `page.route`).

## Out of CI

- Live Telegram / Viber / OCR / user-account smoke scripts under `backend/telegram-user/`.
- Python `viberparser/`: only the pure helpers (batching, state cleanup) have unit tests — `python3 -m unittest viberparser/test_parser.py` (not part of `npm test`); the Viber SQLite reading is covered by manual smoke only.
- Python parsers/formatters without a runner in CI: `python3 -m lunch.test_parsers` (matcher incl. generic-word/ambiguity regressions), `python3 -m lunch.test_golden` (regression on hand-verified real orders in `lunch/golden/`: 2026-10-02 plus 208 reviewed cases of 2026-08-26…10-02 incl. chat that must not become an order — no wrong dish, no false order; `python3 -m lunch.golden_eval <file> --baseline <git-ref> [--no-synonyms]` scores the matcher on any golden file, `lunch.golden_from_history` builds one from `GET /admin/lunch/history`, `lunch.golden_from_dzhura` builds a review draft from history + the Dzhura export of the lunch group), `python3 -m lunch.test_reparse_person` (per-person reparse, day-reparse skip reasons, catch-up — fake DB/Telegram, needs `pip install asyncpg`), `python3 -m dzhura.test_relay` (run manually from `backend/telegram-user/`; Dzhura manual checklist in `Docs/dzhura-phase-0-smoke.md`).
- Manual checklists in `Docs/*-smoke.md`.
