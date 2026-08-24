# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Booking system for a shuttle/minibus service between Kyiv and Malyn (Ukraine), plus a growing set of
adjacent products sharing the same backend/DB: local Malyn public transport (GTFS-style schedules and
map), intercity train/elektrichka info, a "poputky" (rideshare) board sourced from a Viber group, a
referral program, and an internal lunch-ordering bot. UI copy and code comments are largely Ukrainian —
match that when editing existing files.

Three deployables:
- `backend/` — Node/Express/TypeScript API + Prisma/PostgreSQL, deployed to Railway.
- `frontend/` — React 18 + TypeScript + Vite SPA, deployed to Railway.
- `viberparser/` — standalone Python service (not deployed with the two above) that scrapes/parses a
  Viber chat and posts parsed rides to the backend's admin API.

There's also `backend/telegram-user/` (Python/Telethon scripts for one-off "userbot" actions: promo
DMs, fetching messages, lunch OCR listener) and `backend/opendatabot-fop-parser/` /
`backend/internet-phone-search/` (Python phone-lookup helpers invoked by the backend via `spawn`).

## Commands

Root (runs both packages):
```bash
npm test              # backend + frontend Vitest
npm run test:backend
npm run test:frontend
npm run test:coverage # both, with coverage thresholds
npm run test:e2e      # Playwright (frontend)
```
Husky `pre-commit` runs `npm test` — keep unit tests fast and non-flaky.

Backend (`cd backend`):
```bash
npm run dev                    # ts-node-dev src/index.ts
npm run build                  # rm -rf dist && prisma generate && tsc
npm start                      # prisma migrate deploy && seed-local-transport (if empty) && node dist/index.js
npm test                       # vitest run
npm run test:watch
npm run test:coverage
npm run test:integration-db    # needs DATABASE_URL/INTEGRATION_DATABASE_URL, hits a real DB
npx vitest run src/telegram.test.ts        # single file
npx vitest run -t "some test name"         # single test by name
npm run prisma:migrate                     # prisma migrate dev (local schema changes)
npm run prisma:migrate:deploy              # apply migrations (prod)
```

Frontend (`cd frontend`):
```bash
npm run dev            # vite dev server
npm run build           # tsc && vite build && prerender-corridors + prerender-transport-stops scripts
npm run lint             # eslint, max-warnings 0
npm test                 # vitest run
npm run test:watch
npm run test:coverage
npm run test:e2e         # playwright test (mocked API via page.route, no live backend)
npx vitest run src/pages/AdminPage/AdminPage.test.tsx   # single file
npx playwright test e2e/booking.spec.ts                  # single e2e spec
```

## Critical: backend/dist is committed and must stay in sync

Production runs `node dist/index.js` (see `backend/package.json` `start`), and compiled JS under
`backend/dist/` is **committed to git**. Editing `backend/src/**/*.ts` alone does not change deploy
behavior — `dist/` must be rebuilt and committed in the same change.

After touching `backend/src`:
```bash
cd backend && npx tsc --noEmit && npm run build && git status --short dist/
```
If `dist/` has diffs, stage and commit them together with the source change. Never leave `src` ahead
of `dist` in a commit.

## Backend architecture

- `src/index.ts` — process entry point only: builds `PrismaClient`, calls `createApp`, starts the
  Telegram lunch listener, wires graceful shutdown. Almost no logic lives here.
- `src/create-app.ts` — the real composition root. Builds the Express app, configures CORS/JSON
  middleware, and mounts one router per feature area from `src/routes/`. This is the map of "what
  features exist" — read it first when orienting.
- `src/routes/*.ts` — one Express router per feature (bookings, trip points/routes, transport,
  referrals, viber listings, lunch admin, telegram, user profile, etc). Each exports a
  `createXRouter({ prisma, ... })` factory taking dependencies as params (no module-level singletons),
  which is what makes `createApp({ prisma })` swappable in tests.
- `src/middleware/require-admin.ts` — shared admin-auth guard used by admin routers. Admin auth is a
  simple shared token/password (`ADMIN_PASSWORD` env var, dev fallback `admin123`), not per-user JWTs.
- Large standalone domain modules at `src/` top level, each usually paired with its own `*.test.ts`:
  `telegram.ts` (very large — bot commands, notifications, DI hooks), `referral.ts`, `viber-parser.ts`,
  `lunch.ts` / `lunch-listener.ts` / `lunch-reparse.ts` / `lunch-telegram.ts`, `local-transport.ts`,
  `schedule-price.ts`, `schedule-trip.ts`, `schedule-timetable-sync.ts`, `swrailway-eltrain.ts`
  (elektrichka/train lookups), `phone-lookup.ts` / `phonecheck.ts` (spawns Python helpers), `telegram-parser.ts`.
- `src/validation/` — small pure validators (e.g. phone, departure time, poputky draft) shared across
  routes and tests.
- `src/scripts/` — standalone scripts run via `npm run` (seed local transport, export GTFS, calculate
  segment durations), compiled to `dist/scripts/*.js` and invoked directly by `npm start`/`npm run seed:*`.
- `backend/prisma/schema.prisma` — single Postgres schema backing everything: booking/schedule/trip
  models, `Person`/referral models, `ViberListing`/`ViberRideEvent` (rideshare + analytics from the
  Viber parser), local-transport GTFS-like models (`TransportStop/Route/Trip/Segment`), and the
  `Lunch*` models for the internal lunch bot. Changing a model requires a Prisma migration
  (`npm run prisma:migrate`), committing the generated migration under `backend/prisma/migrations/`,
  and usually updating the corresponding route + frontend type.

### Testability pattern

Business logic takes its dependencies (Prisma client, admin password, etc.) as explicit parameters
rather than reading module-level singletons, so tests can inject stubs/mocks. Key hooks:
- `createApp({ prisma, adminPassword })` + `supertest` for HTTP-level tests, no `app.listen()`.
- `telegram.ts` exposes `setTelegramPrismaForTests` / `setTelegramBotForTests` / `setSpawnForTests`
  (and matching `reset*`) to avoid hitting real Telegram/Postgres/child processes in unit tests.
- `vitest.setup.ts` deletes `TELEGRAM_BOT_TOKEN` before any module loads, so importing `telegram.ts`
  in tests never starts real bot polling.
- `http-test-prisma-stub.ts` / `integration-prisma-mock.ts` — reusable Prisma stand-ins for HTTP tests.
- Coverage thresholds (`vitest.config.mts`) are gated only on select modules (`viber-parser.ts`,
  `validation/**`, `local-transport.ts`, `schedule-price.ts`, `telegram-bot-blocked.ts`), not the
  whole codebase.

### External integrations invoked from the backend

- Telegram Bot API via `node-telegram-bot-api` (`TELEGRAM_BOT_TOKEN`) for the booking/lunch bot.
- A separate Telethon "userbot" session (`backend/telegram-user/`, Python) for one-off actions the bot
  API can't do (DMing users who haven't started the bot) — invoked from Node via `spawn`, queued
  through a single-flight exclusive-session lock in `telegram.ts` that also pauses the lunch listener
  while it runs.
- OCR-based lunch order parsing (`LUNCH_OCR_MODEL`, `OPENAI_API_KEY`) via the Python lunch listener.
- Python phone-lookup scripts under `backend/opendatabot-fop-parser/` and
  `backend/internet-phone-search/`, invoked from `phone-lookup.ts`/`phonecheck.ts`.

## Frontend architecture

- `src/pages/*` — route-level pages (BookingPage, AdminPage, LocalTransportPage, MizhgorodskiPage
  [intercity trains], PoputkyPage [rideshare board], TransportPage, UserPage, LoginPage, SupportPage,
  CompanyLegalPage), matching top-level app routes in `App.tsx`.
- `src/api/client.ts` — single typed API client wrapping all backend calls; add new endpoints here
  rather than calling `fetch` ad hoc from components. `API_URL` comes from `VITE_API_URL`
  (`src/utils/constants.ts`), proxied to `http://localhost:3000` in dev (`vite.config.ts`).
  `frontend/legacy/admin.html` is an old static admin page kept for reference, not part of the SPA build.
- `src/types/index.ts` — shared TypeScript types mirroring backend response shapes; keep in sync when
  backend routes/Prisma models change.
- `src/hooks/` — shared data-fetching/state hooks (announce draft, rideshare requests, telegram
  scenarios, page SEO).
- `src/components/` — small reusable UI primitives (Button, Input, Select, Combobox, Alert, etc.) plus
  a few cross-page pieces (TelegramLoginButton, ProtectedRoute for admin-only routes, legal/cookie
  footers).
- `src/content/stops/` — static content data for local-transport stop pages.
- Build (`npm run build`) runs `tsc && vite build` then two prerender scripts
  (`scripts/prerender-corridors.mjs`, `scripts/prerender-transport-stops.mjs`) that statically render
  SEO landing pages after the Vite build — don't skip them when validating a production build.
- `npm run preview`/`npm start` serve via `scripts/serve-dist.mjs`, not Vite's built-in preview.

### Frontend testing

- Vitest + `jsdom` + Testing Library; MSW handlers for admin login/check and transport dataset live in
  `src/test/msw/`.
- Playwright specs in `frontend/e2e/` run against `vite --port 4177` with the backend fully mocked via
  `page.route` (no live backend needed) — see `playwright.config.ts`.

## Cross-cutting notes

- Git commit messages must be written in English (project convention, from `.cursor/rules`).
- The Python `viberparser/` service has no automated test suite (out of CI) — see `Docs/TESTING.md`
  "Out of CI" section for what's covered by manual smoke checklists instead
  (`Docs/*-smoke.md`), e.g. `Docs/gold-route-model-smoke.md`, `Docs/poputky-od-city-scale-smoke.md`.
- Root `.env`/`backend/.env`/`frontend/.env`/`viberparser/.env` are git-ignored; use the matching
  `.env.example` files as the source of truth for required variables.
- Deploy target is Railway (see `DEPLOYMENT.md`, `RAILWAY_SETUP.md`); both `backend/` and `frontend/`
  are separate Railway services each with their own `railway.json`, deploying automatically on push to
  `main`.
