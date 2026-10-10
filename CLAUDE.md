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
npm run lint          # eslint (frontend, max-warnings 0)
npm run typecheck     # tsc --noEmit for both packages

npm run setup:local   # Docker Postgres + migrations + backend build + transport seed
npm run db:up / db:down / db:reset / db:psql
npm run dev:backend / dev:frontend
```
Husky `pre-commit` runs `npm test` — keep unit tests fast and non-flaky.
Full local loop (both domains, admin, checks): `Docs/local-dev.md`.

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
npm run build           # tsc && vite build && prerender-corridors + prerender-transport-stops + prerender-spa + seo-smoke (SEO_SMOKE_STRICT=1)
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
  The token `POST /admin/login` returns is `HMAC-SHA256(ADMIN_PASSWORD, 'admin-session-v1')`
  (`adminAuthToken`; `createApp` binds it via `setAdminPassword(app, …)` → `app.locals`). External
  automation (cron-job.org jobs, the Viber parser's `VIBER_ADMIN_TOKEN`) sends the same static value,
  so changing the password means updating them too (`RAILWAY_CRON_REMINDERS.md`, step 2). Backend tests take
  the header from `adminAuthToken(<test password>)` — never hardcode a token.
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
  Viber parser), local-transport GTFS-like models (`TransportStop/Route/Trip/Segment`), the
  `Lunch*` models for the internal lunch bot and the `Dzhura*` models (chat capture). Changing a
  model requires a Prisma migration (`npm run prisma:migrate`), committing the generated migration
  under `backend/prisma/migrations/`, and usually updating the corresponding route + frontend type.
- «Джура» (personal secretary, phase 0 — `Docs/dzhura-roadmap.md`): the owner's Telethon userbot
  captures selected chats into `Dzhura*` tables. Python lives in `backend/telegram-user/dzhura/`
  and is attached **inside** `lunch.listener` (one Telethon session per account, never a second
  process); Node only reads/flags via `src/dzhura.ts` + `routes/admin-dzhura.ts` (`/admin/dzhura`).
  The lunch admin tab reads the captured lunch-group messages too (`src/lunch-people.ts`: «who wrote today»
  → per-person reparse job). Invariants: never call `send_read_acknowledge`/`mark_read`, typing or online status; never write
  into a captured chat. The only Telegram output is the shared `LunchOutboundMessage` queue, whose
  `target` column routes rows to the lunch group (`lunch`, markdown) or the owner's Saved Messages
  (`saved`, HTML).

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
- The same listener process hosts «Джура» chat capture (`DZHURA_ENABLED`, default on) — see above.
- Python phone-lookup scripts under `backend/opendatabot-fop-parser/` and
  `backend/internet-phone-search/`, invoked from `phone-lookup.ts`/`phonecheck.ts`.

## Frontend architecture

- `src/pages/*` — route-level pages, matching the routes in `App.tsx`. The public menu has four
  entries and they are the whole public surface:
  - `MizhgorodskiPage` → `/` and `/mizhgorodski` — the intercity board (rideshares, marshrutky,
    elektrichky) plus the home-city picker. The same directory renders `CorridorLandingPage`
    (`/mizhgorodski/:corridorSlug` SEO landings), `ZubastykPage` (`/zubastyk`) and
    `AvtostantsiyaPage` (`/avtostantsiya-malyn`).
  - `LocalTransportPage` → `/transport*` — city transit (planner, route detail, stop board via
    `LocalTransportStopBoardPage`, scheme via `LocalTransportSchemePage`, `LocalTransportSoon` stub).
    The transport dataset loader/adapter and `tripTiming.ts` live in `LocalTransportPage/dataset/`;
    the admin tabs and `AvtostantsiyaPage` import them from there too.
  - `CompanyLegalPage` → `/about` — company details, privacy policy, terms, referral rules.
  - `SupportPage` → `/support` — help centre (`SupportHub` + `SupportArticle`).

  Plus non-menu routes: `AdminPage` (`/admin/:tab?`), `StickerWallPage` (`/admin/wall`),
  `LoginPage` (`/login`), `UserPage` (`/user`). `/booking` and `/poputky` redirect to `/mizhgorodski`;
  the old BookingPage and PoputkyPage components were removed in #38 (recover them from git history
  if a booking page is ever needed again).
- `src/api/client.ts` — single typed API client wrapping all backend calls; add new endpoints here
  rather than calling `fetch` ad hoc from components. `API_URL` comes from `VITE_API_URL`
  (`src/utils/constants.ts`), proxied to `http://localhost:3000` in dev (`vite.config.ts`).
  `frontend/legacy/admin.html` is an old static admin page kept for reference, not part of the SPA build.
- Public map tiles (`src/pages/LocalTransportPage/RouteMap.tsx`) default to OpenStreetMap;
  `VITE_MAP_TILES_URL` / `VITE_MAP_TILES_ATTRIBUTION` switch the provider. CARTO basemaps need an API
  key — without one every tile reads "API KEY REQUIRED". `mapTiles.ts` accepts a percent-encoded
  template (`%7Bz%7D`, as copied from an address bar); the muted tile filter (`.lt-map-container--osm`)
  applies only to the default OSM tiles. The admin map editor uses OSM tiles directly.
- GA4 events on `/transport*` go through `gaTrackEvent` (`src/analytics/googleAnalytics.ts`): parameters
  are ids and categories only, never stop names. Every event is listed in `Docs/transport-analytics.md`;
  add new ones there and cover them with the `window.gtag = vi.fn()` test pattern.
- Stop stickers (`/admin/stickers?stop=<id>`, `src/pages/AdminPage/StopStickerTab.tsx` +
  `stopSticker/`): printable A5/A4 SVG in the scheme's style with a QR to the stop board. The dataset
  often models both sides of a road as one stop, so lines are split into sides by travel bearing
  (`splitSides`) and the admin can move them; the QR always targets the primary domain with
  `utm_source=sticker&utm_medium=qr&utm_campaign=<stopId>-<a|b|s>`. The board counts each opening
  once per session (`stickerScan.ts` → GA4 `transport_sticker_open` + `POST /transport/sticker-scans`
  → `StickerScan` table, `backend/src/sticker-scans.ts`), then rewrites `utm_source=sticker` to
  `utm_source=reload` (router replace with state `{ gaSkip: true }`, which `GoogleAnalyticsTracker` doesn't
  count as a page_view) so a tab the browser restores later is not a new scan but a `reload / qr` source in GA.
  Scans carry an anonymous browser id (`src/analytics/visitorId.ts`, also used by «Факт прибуття»); the
  browser remembers the first sticker and, when that person opens the site again after ≥ 30 min,
  `stickerReturn.ts` posts `POST /transport/sticker-returns` (`StickerReturn`, `via: reload | tab | direct`) —
  «people from stickers who came back» tiles on the tab. The tab lists every stop with its counts,
  daily / hourly charts (Kyiv time) and prints recorded in `StickerPrint` on print/SVG download
  (`GET /admin/transport/sticker-scans?days=1|7|30|90`, 1 = today since Kyiv midnight; `POST /admin/transport/sticker-prints`).
  Wall widget `/admin/wall?key=…` (`src/pages/StickerWallPage/`, rendered without NavBar): a phone in
  landscape polls `GET /transport/sticker-wall?key=&after=<id>` every 30 s and celebrates each new scan
  (colour of the stop's line, Web Audio chime); the key is read-only, `HMAC(ADMIN_PASSWORD)` from
  `backend/src/sticker-wall.ts`, issued by `GET /admin/transport/sticker-wall-key`.
  Workflow in `Docs/stop-stickers.md`.
- «Факт прибуття»: a long press (or right click / `contextmenu`) on a departure chip of `/transport/route/:id`
  or a card of the stop board opens `ArrivalReportSheet` («автобус тут» now / N min ago, or «автобуса не
  було» + how long they waited) → `POST /transport/arrival-reports` → `TransportArrivalReport` (no FK — the
  dataset is replaced wholesale; route/stop/scheduled time are stored as text). Actual time is the server's
  Kyiv clock, windows are ±90 min (arrived) / −5…+180 min (missed), today only. Statistics only for now:
  admin tab `/admin/arrivals` (`ArrivalReportsTab`). Logic in `backend/src/arrival-reports.ts`,
  `useLongPress.ts`, `arrivalReport.ts`. Facebook post for users: `Docs/arrivals-facebook-post.md`.
- Stale tabs update themselves (`src/site/freshBuild.ts`, `useFreshBuild` in `App.tsx`): when a tab becomes
  visible again (at most every 10 min) it fetches `/` uncached and compares the `/assets/index-<hash>.js` it
  references with the loaded one. New build + tab away ≥ 30 min + no `aria-modal` dialog / focused field →
  reload at once; otherwise the next page change is a full load. Never on `/admin*`; one try per build per
  session. Dev and prerender have no `/assets/index-*` script, so it is off there.
- `src/types/index.ts` — shared TypeScript types mirroring backend response shapes; keep in sync when
  backend routes/Prisma models change.
- `src/hooks/` — shared data-fetching/state hooks (announce draft, rideshare requests, telegram
  scenarios, page SEO).
- `src/components/` — small reusable UI primitives (Button, Input, Select, Combobox, Alert, etc.) plus
  a few cross-page pieces (TelegramLoginButton, ProtectedRoute for admin-only routes, legal/cookie
  footers).
- `src/content/stops/` — static content data for local-transport stop pages.
- Stop names are string foreign keys: `TransportRoute.fromName/toName` and `TransportTrip.headsign`
  hold stop names as text and the public site resolves termini back to ids by name
  (`invertNameToId`). Rename stops only through the admin map editor (`/admin/map-editor`,
  `src/pages/AdminPage/stopRename.ts` replaces exact matches on save); the static articles in
  `src/content/stops/<id>.ts` carry their own `name` that must be updated by hand.
- Build-time scripts (`scripts/prerender-*.mjs`, `scripts/seo-smoke.mjs`) call the backend at the
  address hard-coded in `scripts/api-base.mjs` (Railway URL, https, no `/api` prefix; `/health`
  must return JSON). If a build fails with "API is not answering", check whether the backend moved
  before anything else — see `Docs/seo-aeo-plan-2026-09.md` "Правило API". Corridor pages must
  never ship a placeholder timetable (rule D10): live API → committed snapshot → build fails.
- Build (`npm run build`) runs `tsc && vite build` then four post-steps: `scripts/prerender-corridors.mjs`
  and `scripts/prerender-transport-stops.mjs` (static SEO landing pages from their own templates),
  `scripts/prerender-spa.mjs` (renders `/transport`, `/transport/scheme` and every `/transport/route/:id`
  from the sitemap through the real SPA in jsdom — route-page code must run without a browser) and
  `SEO_SMOKE_STRICT=1 scripts/seo-smoke.mjs` (title/h1/canonical/placeholder checks on `dist/`) — don't
  skip them when validating a production build.
- `npm run preview`/`npm start` serve via `scripts/serve-dist.mjs`, not Vite's built-in preview.

### Frontend testing

- Vitest + `jsdom` + Testing Library; MSW handlers for admin login/check and transport dataset live in
  `src/test/msw/`.
- Playwright specs in `frontend/e2e/` run against `vite --port 4177` with the backend fully mocked via
  `page.route` (no live backend needed) — see `playwright.config.ts`.

## Two public domains (malin.kiev.ua + korosten.kiev.ua)

One Railway frontend service serves both domains; the DB, backend and Telegram bot are shared.
The domain map lives in `frontend/scripts/site-hosts.mjs` (plain ESM — imported by both the Node
host `scripts/serve-dist.mjs` and the SPA via `frontend/src/site/siteConfig.ts`).

- Switching «Рідне місто» to a city that owns a domain navigates to that domain with the same path
  and query (`?city=<code>` carries the choice; cookies do not cross domains) — `buildCitySwitchUrl`
  + `useHomeCityHandoff`. A secondary domain pins its own home city.
- `/admin`, `/login`, `/user` exist only on the primary domain: 301 in `serve-dist.mjs` for the first
  hit, `DomainGuard` for SPA navigation (the Telegram Login widget is bound to one bot domain).
- korosten.kiev.ua is `noindex` for now (`X-Robots-Tag`, synthetic `robots.txt`, 404 sitemap in
  `serve-dist.mjs`); all canonicals keep pointing at malin.kiev.ua.
- Local transport is gated per city by `TripPoint.hasLocalTransport` (checkbox in the admin
  «Маршрути» tab) — `LocalTransportGate` renders a «скоро» stub where it is off. The transport
  dataset itself is still single-tenant Malyn.
- A city route can be flagged `TransportRoute.unreliable` («Ненадійний — приховати» checkbox on
  `/admin/route-schedule`). The public API still returns it; hiding happens in consumers:
  `publicTransportDataset()` (SPA view-model, so every public page / JSON-LD), the stop-article
  chips, `prerender-transport-stops.mjs` (static stop pages + sitemap) and the GTFS export. Static
  pages and the sitemap are built at deploy time — after flipping the flag, redeploy the frontend.
  Route numbers are primary keys; renumbering is done in a migration (see the 6 → 10 one).
- **Route id ≠ the number people see.** `TransportRoute.id` («11») is the key: `/transport/route/<id>`, trip ids,
  segments, scheme colours `--lts-r<id>` / `data-route`, stop articles' `routeIds`, GTFS `route_id`, GA4 params.
  The displayed number is `TransportRoute.shortName` («11/1», «5А»; empty → id), edited as «Номер для показу» on
  `/admin/route-schedule`. Print it only through `routeNo(id)` (`src/utils/routeNames.ts`, filled by
  `apiClient.getTransportDataset()`); static stop pages use `routeShortNames()` (`scripts/transport-stop-routes.mjs`);
  the scheme generator reads it from the dataset, so regenerate the scheme and poster after changing it. A `PUT` without
  the key keeps the stored value. Prefer `shortName` over renumbering when only the label changes.
- Per-trip `startStopId` / `endStopId` / `arrivalTime` (short-turn trips, fixed arrival that
  compresses that trip's segment durations) are computed on the fly by one pure helper kept
  byte-identical in `frontend/src/pages/LocalTransportPage/dataset/tripTiming.ts` and
  `backend/src/trip-timing.ts` (a frontend test diffs them). Public pages go through
  `recordTiming()` in `routeTiming.ts`, the admin grid through `computeTripTimes()`, GTFS through
  `backend/src/gtfs-stop-times.ts`. Headsign is display-only; the served stop range comes from
  start/end. A trip is never a "departure" at its own end stop on the stop board.
- Locally both sites run off one dev server: `localhost:5173` and `korosten.localhost:5173`
  (or `?site=korosten`).
- Shared pages that name the service (`/about`) read the current domain via
  `currentSiteDomain()` and list every domain via `siteDomainsLabel()` (`src/legal/sitePublic.ts`);
  their canonical points at the primary domain. Never hardcode a domain in page copy or links —
  use a relative path so a link works on every site.
- Notifications follow the ride: `backend/src/site-domains.ts` maps a route slug to the site that
  owns it (`Korosten-Kyiv` → korosten.kiev.ua), and the ride-specific messages — the publication
  confirmation (Telegram + userbot), its SMS twin, the match-found SMS, the trip-reminder SMS and
  the behaviour promos — link that domain instead of the primary one. Generic bot UI (menus,
  welcome, help, broadcasts) keeps the primary domain: there is one bot for all sites.

**Adding a domain for another city** (Zhytomyr is already stubbed): buy it, add it to the Railway
frontend service, then flip `active: true` on its entry in **both** maps —
`frontend/scripts/site-hosts.mjs` and `backend/src/site-domains.ts`. Everything else — redirects,
home-city pinning, noindex, the transport stub, the legal wording on `/about` and the domain in
notifications — is derived from them. Keep the two maps in sync.

## Cross-cutting notes

- Git commit messages must be written in English (project convention, from `.cursor/rules`).
- «Зубастик» (Kyiv ↔ Malyn marshrutkas) is **phone-only for now**: the online flow (site modal, bot
  `/book`) still writes the booking and keeps the old «технічний режим» warnings. Warn **only where people
  book**: search results (banner, card note, call button; the notes are left out of the static prerender
  via `isPrerendering()`, `src/utils/prerender.ts`), the booking modal, bot booking steps and
  «Мої бронювання», confirmations, reminders, SMS, the admin message and `POST /bookings` (`phoneOnly` +
  `notice`). Ads, SEO and AEO copy (landings, FAQ / JSON-LD, meta, `llms.txt`, promos, bot welcome/help)
  keep promising online booking — at most the soft `ZUBASTYK_TEMP_NOTE` («тимчасово… за телефоном»),
  never «не працює». One rule, kept identical in `backend/src/phone-booking.ts` and
  `frontend/src/pages/MizhgorodskiPage/phoneOnlyBooking.ts`; the phones mirror `ZUBASTYK_PHONES` in
  `zubastykContent.ts`. Restoring online booking = reverting that change.
- The Python `viberparser/` service has no automated test suite (out of CI) — see `Docs/TESTING.md`
  "Out of CI" section for what's covered by manual smoke checklists instead
  (`Docs/*-smoke.md`), e.g. `Docs/gold-route-model-smoke.md`, `Docs/poputky-od-city-scale-smoke.md`.
- Root `.env`/`backend/.env`/`frontend/.env`/`viberparser/.env` are git-ignored; use the matching
  `.env.example` files as the source of truth for required variables.
- Deploy target is Railway (see `DEPLOYMENT.md`, `RAILWAY_SETUP.md`); both `backend/` and `frontend/`
  are separate Railway services each with their own `railway.json`, deploying automatically on push to
  `main`.
