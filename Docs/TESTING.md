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
- Intercity trips: `schedule-trip` util, schedules/trip-points HTTP, `mizhUtils` train filter, Telegram elektrichka helpers.
- Playwright: `e2e/auth.spec.ts`, `e2e/transport.spec.ts`, `e2e/booking.spec.ts`, `e2e/train.spec.ts` (API mocked via `page.route`).

## Out of CI

- Live Telegram / Viber / OCR / user-account smoke scripts under `backend/telegram-user/`.
- Python `viberparser/` (no automated suite yet).
- Manual checklists in `Docs/*-smoke.md`.
