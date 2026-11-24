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
  automation (any remaining external callers, the Viber parser's `VIBER_ADMIN_TOKEN`) sends the same static value,
  so changing the password means updating them too (`RAILWAY_CRON_REMINDERS.md`, step 2). The old cron-job.org
  jobs are gone — see "In-process scheduled jobs" below. Backend tests take
  the header from `adminAuthToken(<test password>)` — never hardcode a token.
  The server cannot revoke one device's session (every device holds the same token). To log every browser out
  without changing the password or the token, rename `ADMIN_TOKEN_STORAGE_KEY` in
  `frontend/src/utils/adminTokenStorage.ts`: the next page load wipes tokens stored under older names
  (`purgeStaleAdminTokens`). A copied token stays valid; only a password change revokes it.
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
  `Lunch*` models for the internal lunch bot, the `Dzhura*` models (chat capture) and `DovedeQuery`
  («Доведе» understanding log). Changing a
  model requires a Prisma migration (`npm run prisma:migrate`), committing the generated migration
  under `backend/prisma/migrations/`, and usually updating the corresponding route + frontend type.
- «Джура» (personal secretary, phase 0 — `Docs/dzhura-roadmap.md`): the owner's Telethon userbot
  captures selected chats into `Dzhura*` tables. Python lives in `backend/telegram-user/dzhura/`
  and is attached **inside** `lunch.listener` (one Telethon session per account, never a second
  process); Node only reads/flags via `src/dzhura.ts` + `routes/admin-dzhura.ts` (`/admin/dzhura`).
  The lunch admin tab reads the captured lunch-group messages too (`src/lunch-people.ts`: «who wrote today»
  → per-person reparse job). That tab («Столова», `AdminPage/LunchTab.tsx` on the shared admin kit, pure helpers in
  `AdminPage/lunch/lunchText.ts`) has sections `/admin/lunch` (day, orders with `?only=problems|debt`, who wrote, payments),
  `menu`, `dishes`, `models`. Invariants: never call `send_read_acknowledge`/`mark_read`, typing or online status; never write
  into a captured chat. The only Telegram output is the shared `LunchOutboundMessage` queue, whose
  `target` column routes rows to the lunch group (`lunch`, markdown) or the owner's Saved Messages
  (`saved`, HTML).
  **One deliberate exception — auto-reply** (`dzhura/responder.py` + `autoreply.py`, experiment): a *private* chat with
  `DzhuraChat.autoReplyEnabled` gets an answer written by Claude in the owner's style when the owner has not replied
  within `autoReplyDelaySec` (default 80, per chat; timer from the last incoming message, cancelled by any reply of
  the owner). Only there, and only at that moment, the listener marks the chat read, shows «typing» and sends 1–3
  messages directly; they are stored with `DzhuraMessage.isAutoReply` and reported to Saved Messages. Style comes from
  the last 120 stored messages of that chat (the owner's own replies are the examples) plus the optional
  `autoReplyNote`; the prompt forbids invented facts, promises of money/meetings and claiming to be human (a sincere
  «are you a bot?» → silence, the owner answers). `DzhuraJob` type `autoreply_preview` runs the same request without
  sending anything. Env: `ANTHROPIC_API_KEY` (shared with the menu OCR), `DZHURA_AUTOREPLY_ENABLED`,
  `DZHURA_AUTOREPLY_MODEL`, `DZHURA_AUTOREPLY_DAILY_CAP`. Never log message texts of private chats.
  **Second exception — history restore** (one-off, `Docs/dzhura-history-restore.md`): `DzhuraJob` type `post_items`
  (`dzhura/restore.py`) posts, as the owner, exactly the posts a job carries (HTML text / JPEG base64, ≤ 10 per job,
  `batch` + `seq` unique, a failed part stops the rest) into the group / supergroup the job names — never the lunch
  group or a private chat; type `avatars` returns small profile photos of a chat's authors; type `import_history`
  runs Telegram's own history import (a WhatsApp-format file, admin rights in a supergroup, `dryRun` only checks;
  many pictures go in stages `init` → `media`… → `start`, `importId` as a string); type `scan_ids` lists the message ids
  Telegram still has in a chat (what survived a clearing). The
  pictures and the import file are made locally from the chat export by `frontend/scripts/dzhura-history/render.mjs`
  (Chromium) and queued by `post.mjs` / `import.mjs`.

- «Доведе» admin settings (`/admin/dovede/settings`, `dovede/DovedeSettingsSection.tsx` + `kit/SettingRow.tsx`): one
  registry `DOVEDE_SETTINGS` in `backend/src/dovede/settings.ts` (key, group, label, limits, default from an env var or
  code) and the table `DovedeSetting` (key → JSON; `null` = default), read through a one-minute cache by one
  `createDovedeSettings` instance per process (`index.ts` → `createApp` → router and `cityRoutes`):
  `ai.enabled` / `ai.dailyCap` (Claude), `city.enabled`, `city.dailyCap`, `city.freshDays`, `city.own`,
  `drive.dailyCap`, `google.backoffMin`, `learn.refresh`, `learn.sharePct`, `learn.batch`, `learn.retryDays`.
  A switch whose env var says off (`DOVEDE_ENABLED=0`, `DOVEDE_CITY_ROUTES=off`, `DOVEDE_CITY_OWN=0`,
  `DOVEDE_CITY_REFRESH=0`) cannot be switched on from the admin (`lockedBy`). `GET` / `PUT /admin/dovede/settings`
  (`{ key, value }`, `null` resets); the old `PUT /admin/dovede/city/settings` writes the same keys. `DovedeCitySettings`
  is no longer read (its values were copied by migration `20261119300000_dovede_settings`). New setting = a registry
  entry + where it is read; never a key or password.
- «Доведе» (`/dovede`, hidden page with no site header — `Docs/dovede-roadmap.md` is the recovery file; the admin tab
  redesign and server-side learning runs are planned in `Docs/dovede-admin-roadmap.md` (plan of plans, read it first); what
  comes next in learning — Korosten, sources besides Google, a better algorithm — in `Docs/dovede-learning-roadmap.md`;
  voice input (plan of plans in `Docs/dovede-voice-roadmap.md`: phase 1 is browser-only — a mic button in
  `QueryField` on the Web Speech API (`DovedePage/voice/`: `useVoiceInput`, `webSpeech.ts`, `heardFixes.ts` — spoken numbers →
  digits and known mishearings, shown to everyone the page is open to — guests' password, admin token or `DOVEDE_PUBLIC`,
  the search is mounted only after access (owner, 2026-11-22) — when the browser has Web Speech;
  recognised text goes into the field and searches at once), plus a lab at `/admin/dovede/voice` (`AdminPage/dovede/voice/`)
  that scores Web Speech on the owner's 41 phrases and keeps each take's audio in IndexedDB for the later cloud comparison;
  Whisper in the browser lost badly (21–31 % vs Web Speech 77 %) and was removed with `@huggingface/transformers` —
  its `onnxruntime-node` downloaded ~200 MB from nuget.org on every `npm ci` and broke CI once; phase 2 is cloud
  speech-to-text, for comparison and for browsers without Web Speech); «from where I am now» (plan of plans `Docs/dovede-geo-roadmap.md`, same rule as the mic,
  `DovedePage/geo/`): a question without «звідки» starts from the browser's location — the dynamic place `here` with a
  point (Malyn, Korosten; Kyiv / Zhytomyr city-level, elsewhere `far` = ignored), asked together with the mic; the same
  location picks Malyn or Korosten for a question that names no city; coordinates stay in tab memory and never go to
  Claude, Google or the URL (`f=here` and the Korosten `fd=` marker are never written); research in
  `Docs/dovede/research/`; first visit per browser = an unskippable intro video before the password, then a punched ticket
  opens the page — `DovedePage/intro/`, flag `dovede-intro:v2`, file `public/dovede/intro-<hash>.mp4` from
  `npm run dovede:intro`; `serve-dist.mjs` answers `Range` with 206, which iPhone Safari needs, and sends
  `X-Robots-Tag: noindex…` on `/dovede` and everything under it — `robotsHeadersFor`; never list it in `robots.txt`; the tab icon
  and the link preview (Telegram, Viber) are the logo from the video — names and texts in `scripts/dovede-brand.mjs`, PNGs in
  `public/dovede/` from `npm run dovede:icons`, and the build step `scripts/dovede-html.mjs` (right after `sri.mjs`) writes
  `dist/dovede/index.html`, the shell with Dovede's head, because messengers do not run JS; the page itself swaps the tab
  icon on SPA navigation (`useDovedeIcons`), `usePageSeo({ ogImage })` sets the card; a new drawing = new `-v2` names; the same full-screen ad
  mechanics in `frontend/src/ads/` play an 8-second teaser once before the stop board for sticker scans — `stickerAd.ts`,
  flag `dovede-hint:v1`; the teaser carries the company
  credit (mark + «ТОВ «Технології»», fades in from second 5) laid over the clean render by `npm run dovede:teaser -- credit
  --base <clean.mp4>` (`frontend/scripts/teaser/`: `scene.html` is a pure function of the frame number, Playwright's Chromium
  shoots the frames, ffmpeg assembles; local only, output in `out/`, then `dovede:intro --slot hint`; mode `welcome` makes the
  «Вітаємо в Малині» greeting with the same dot, timing and sound; `lockup.py` draws the Ukrainian
  logo as outlines); on the railway stations of `WELCOME_STOPS` in `stickerAd.ts` (keyed by the site's city: Malyn
  `st_0019`, Korosten `st_1001`) the city's greeting plays **instead of** the dot teaser — Malyn's
  `public/ads/welcome-<hash>.mp4` (`dovede:intro --slot welcome` → `src/ads/welcomeMedia.ts`), Korosten's «Вітаємо в
  Коростені» `public/ads/welcome-korosten-<hash>.mp4` (`--slot welcomeKorosten` → `welcomeKorostenMedia.ts`); passenger
  № 1000 of its city (number from the scan reply) sees «Тисяча крапок» once instead (`PASSENGER_VIDEOS`,
  `public/ads/thousand-<hash>.mp4`, `--slot thousand`; made by `npm run dovede:teaser -- thousand --v dots` —
  `scripts/teaser/thousand.html`, its own synthesized sound, variants `zeros` / `counter` kept; the reply arrives while the
  teaser is already on screen, so the board swaps the video — `onPassengerReply` in `stickerScan.ts`; a known passport
  number picks it at once); four videos, four once-per-browser flags named after the video (`AD_SEEN_KEYS`:
  `dovede-hint:v1`, `malyn-welcome:v1`, `korosten-welcome:v1`, `thousand-passenger:v1`), so no video cancels another and
  the dot is never shown at a station (storage is per domain anyway); a new greeting text or size = re-measure the dot
  point in `StickerAdIntro.tsx` (centre of the blue pixels of the last frame; `dovede:teaser -- thousand` prints its own);
  both stop videos start without a touch: when the browser refuses sound (after a QR scan it nearly always does) they play
  muted with an «Увімкнути звук» button (`useAdVideo(…, { silentStart: true })`, `AdSoundButton`), and «▶ Дивитися» is
  left for a browser that will not play even muted — the /dovede intro still waits for «▶ Дивитися»; in Playwright any
  `evaluate` / locator poll before the video starts counts as a user gesture and lets sound through; views and `/dovede` visits with access go to `AdEvent` via `POST /ads/events`, the wall
  widget's «Реклама» tab reads `GET /ads/wall`): a person asks in plain words and gets a story of cards built in the browser
  (`frontend/src/pages/DovedePage/`: `nlu/parseLocal` dictionary parse → `compose/` with `/poputky/search`, anchors
  and the Malyn RAPTOR planner → template text). **AI only understands the text, it never names a time, route or
  price.** Access is decided by the server (`src/dovede/access.ts`, page side `DovedePage/access.ts`): until
  `DOVEDE_PUBLIC=ON` the query field asks for the invitees' password `DOVEDE_PASSWORD` (separate from
  `ADMIN_PASSWORD`, button «Hasło»); `POST /dovede/login` returns `HMAC-SHA256(DOVEDE_PASSWORD, 'dovede-access-v1')`,
  kept in `localStorage['dovede-token:v1']` and sent as `X-Dovede-Token` (only on Dovede requests — other GETs stay
  preflight-free); the admin token opens it too; `GET /dovede/access` → `{ open, allowed }`. Changing the password
  revokes guest tokens; 20 wrong passwords per 15 min → 429. `POST /dovede/understand` (`routes/admin-dovede.ts`,
  `src/dovede/`) turns the text into a
  `TripIntent` with Claude (`@anthropic-ai/sdk`, structured output, cached system prompt built from the gazetteer;
  `DOVEDE_ENABLED`, `DOVEDE_MODEL`, `DOVEDE_DAILY_CAP`, key = `ANTHROPIC_API_KEY`). Every way Claude can fail answers
  `{ fallback: 'local' }` (503 / 429) and the page falls back to the dictionary parse; a confident dictionary parse
  answers at once and Claude only checks it in the background. `validateIntent` moves place ids outside the gazetteer
  to `unknown`. `src/dovede/gazetteer.ts` is a byte-identical copy of the frontend `nlu/gazetteer.ts` (a frontend
  test diffs them) — edit both. Calls are logged in `DovedeQuery`; the admin tab `/admin/dovede` is split into sections
  with their own addresses (route `/admin/:tab?/:section?`; shell `AdminPage/dovede/DovedeTab.tsx`, lazy chunk; plan and
  next steps in `Docs/dovede-admin-roadmap.md`): Огляд (no segment — today's tiles, Claude / Google N of cap, «Потребує
  уваги» linking to the fix), `questions` (`AdminPage/DovedeLogTab.tsx`; `GET /admin/dovede/queries`, pure
  `src/dovede/log.ts`: summary, words nobody recognised, the latest questions with both parses; period and filter — one
  toolbar above the list, in `?days=&only=`; in each row the unrecognised words link to «Словник» and «відкрити як
  людина» opens the page's answer from the stored parse — `questionLink` in `dovedeLogText.ts`, ids + `q=`, no Claude
  call), `dictionary` (synonyms, `?word=` fills the form; drivers' pickup notes), `city` (city in `?misto=Kyiv|Zhytomyr`, default Kyiv: tiles, «Що питають» from
  `GET /admin/dovede/city/demand?city=&only=unanswered`, «Місця» in pages of 30 with each place's roads from
  `GET /admin/dovede/city/place/routes?city=&key=`, whole-base actions in a folded «Небезпечна зона»), `learning`
  (learning campaigns, see below) and `settings`; an unknown section redirects to Огляд. Shared admin pieces (section nav, header, stat tiles, status pill, empty state, setting row, `ChipGroup` for filters
  and periods; used by «Доведе», «Факт прибуття», «Графіки» (`AdminPage/SchedulesTab.tsx`: trips grouped by direction, one
  dense row per trip), «Маршрути» (`AdminPage/RoutesTab.tsx`: each corridor with its «через …» variants under it,
  missing route points / car time as flags; cities with their flags and route count), «Сповіщення»
  (`AdminPage/NotificationSettingsTab.tsx`, see «Personal account and SMS» below), «Наклейки зупинок»
  (`AdminPage/StopStickerTab.tsx`, see «Stop stickers» below) and «Реферали» (`AdminPage/referrals/`: sections
  `/admin/referrals` = payouts with the budget, `photos`, `suspicious`, `invites`, the same `/admin/:tab?/:section?` route
  as «Доведе»; pure helpers in `referralText.ts`). Other admin tabs move to it one PR at
  a time; **the map editor tab (`MapEditorTab`) is not to be
  touched** (owner's decision), `kit.css` on the
  `--pb-*` variables) live in `AdminPage/kit/`; below 640 px tables with `dovede-log-table--cards` become cards from
  `data-label` (CSS only). The same tab teaches synonyms without a deploy
  (`DovedeSynonym`, `DovedeSynonymsPanel.tsx`, `/admin/dovede/synonyms`): the page reads `GET /dovede/synonyms` on open
  (`nlu/synonyms.ts`, matched before every other dictionary), and Claude gets the list in the user message, so the
  cached system prompt never changes with them. Tests never reach the API: `vitest.setup.ts`
  drops `ANTHROPIC_API_KEY`, `createApp({ dovedeUnderstand })` takes a stub; the real-model run over
  `eval/golden.json` is manual (`DOVEDE_EVAL=1`, `src/dovede/eval.test.ts`). Page UX (`DovedePage/ui/`):
  `QueryField` highlights recognised words in a layer under the transparent textarea and suggests gazetteer places
  for the word at the caret (`suggest.ts` — every inserted form must parse back to its place, a test checks it);
  `SlotSheet` edits one slot of the «Розумію…» row; the answer is built from ids in the URL (`url.ts`, `?f=&t=&fd=&td=&d=&h=&a=&p=&m=&r=&x=`);
  the question's words always ride along in `q=` in full (owner's decision: a reload or a shared link shows the same
  highlighted phrase and the same answer; the house number is read back from those words). Opening a link never calls
  Claude. The tab also keeps its question in sessionStorage (`rememberQuestion` / `recallQuestion`) as a fallback. Slot edits and id links do not call Claude.
  Three more question kinds answer from site data only: rides («чи є попутка…» → `poputky`: driver listings of the day
  from the same `/poputky/search`, drawn as a pinboard of paper notes in `ui/RideBoard.tsx`; the phone comes only after
  «Відірвати номер» — a tear-off strip that calls the board's `GET /viber-listings/:id/contact`), price (`Schedule.priceUah` + `meta.fare`) and
  contacts (`ZUBASTYK_PHONES`) — `ui/InfoCards.tsx` (prices as a printed receipt, phones as a pinned notice with tabs). New card classes must not reuse `.dv-note` (the yellow hint).
  Every city stop is a place: the curated gazetteer covers districts and synonyms, the rest come from the dataset
  (`nlu/stopPlaces.ts` + `normalize.ts`, byte-identical in `backend/src/dovede/`; ids `st_XXXX`, phrase matching).
  The browser registers them with `setStopPlaces` (look places up with `resolvePlace`, not `placeById`); the
  endpoint reads the city's stops from the DB (5 min cache) into the system prompt, so a stop added in the admin
  reaches Claude without a deploy. City bus routes work the same way: `nlu/routes.ts` finds «№5», «9-ка», «сімкою»
  by the displayed number and puts route **ids** into `TripIntent.routes` («№N» right after a place noun — «садок №8»,
  «ЗОШ №5», «Нова пошта №2» — is that place's number, `PLACE_BEFORE_NO`); a route named without a from–to pair is
  intent `route` and answers with `ui/RouteCard.tsx` (`DayPlanner.routeDepartures`; several named routes share one
  card), «крім сімки» goes to `TripIntent.avoidRoutes` (URL `x=`; the composer drops journeys on that bus and says so
  when there is no other way), and the endpoint lists the
  city's routes (no `unreliable`) in the prompt. Golden questions have scopes `mvp` / `stops` / `routes` / `streets` / `landmarks` with the
  snapshots `eval/malyn-stops.json` and `eval/malyn-routes.json`. Streets and house addresses are places without
  stops: `nlu/streets.ts` + `data/malyn-streets.json` (generated from the OSM snapshot by
  `data/malyn-transport/dovede-streets/build.py`, never edited by hand; backend copy of the names in
  `src/dovede/streets.ts`). Such a place carries `latLng`, its id is `street.<slug>` or `street.<slug>:<house>`, and
  the composer hands the planner a point (`Spot`). The house number never goes into the URL, no geocoder is called
  at answer time, and an address missing from the data is answered as «приблизно». Houses come in two lists:
  `houses` (street tagged in OSM, exact) and `near` (street assigned by geometry — nearest street, ~95 % right, shown
  as «знайшов за розташуванням»). Google coordinates are never stored for this (its terms forbid building a database).
  Landmarks without a stop (shops, pharmacies, offices, factories) work the same way: `nlu/landmarks.ts` +
  `data/malyn-landmarks.json` (generated by `data/malyn-transport/dovede-landmarks/build.py` from its own OSM snapshot
  `osm/places.json`, refreshed by `fetch_osm.py`, and
  the manual `config.json` — aliases, exclusions; backend copy `src/dovede/landmarks.ts`), ids `lm.<slug>`, matched only
  after a preposition, and a stop, curated place or address of the same name wins. Same-named places carry `twins`
  and the answer says which one is shown. New landmark or alias = edit `config.json`, rerun the generator, bump
  `PROMPT_VERSION`.
  Kyiv metro: all 52 stations are places (`nlu/kyivMetroData.ts`, byte-identical copy in `backend/src/dovede/`, ids
  `kyiv.m.<slug>`; eight older ids such as `kyiv.akadem` and `kyiv.pas` = «Вокзальна» are kept). `nlu/kyivMetro.ts`
  matches names by phrase (`strict` names — Дніпро, Університет, Харківська… — only after «метро / м. / ст.»; a name
  that resembles a Malyn place is a station only once the person has said «з Малина», a verbatim Malyn name stays
  Malyn's) and finds the path with transfers. When the person asks for another Kyiv point than the one the trip
  reaches, the story ends at the requested point with metro minutes added (`metroTrip` in `data/kyiv.ts`: 2 min per
  hop + 5 per transfer + 5), and a trip from Kyiv starts earlier by the same. The metro part is a story step of its own
  (`kind: 'metro'`, `kyivStep` in the composer, card `ui/MetroCard.tsx`): `metroTrip(from, to, at)` in `data/kyiv.ts` times it
  from our own `data/kyivMetroService.ts` (hours 05:30–23:00, fare, average hop per line, headways by time of day) and
  marks it `closed` outside working hours. `METRO_SHUTTLE_DEFAULT` there records the stretch where a bus runs instead of
  trains (green line beyond «Видубичі», bus 318 — inferred from Google on 2026-11-17); what applies is `metroShuttle()`.
  The owner changes it — and the metro hours and fare — in the admin without a deploy («Налаштування» → «Дані сторінки»,
  `AdminPage/dovede/PageDataSection.tsx`; switched off = trains run everywhere): `backend/src/dovede/page-data.ts` keeps
  only what was changed (`DovedeSetting` keys `page.<key>`, value `{ v }`, so «changed to null» ≠ «default»;
  `GET` / `PUT /admin/dovede/page-data`), the page reads `GET /dovede/page-data` once per open
  (`DovedePage/data/pageData.ts` → `applyMetroData`) and an answer waits for it at most 1.5 s. New page data = a
  registry entry with its check + where the page applies it (now: `metro.shuttle`, `metro.service`, `ring.extra`, `examples` — the «Спитайте, наприклад» buttons of Malyn and
  Korosten, `data/examples.ts`; the page re-renders once the data arrives). A metro step that is only that bus is never worded as metro: `metroPhrase` in
  `compose/narrate.ts` says «автобус №318 замість метро до…», and `MetroCard` opens with «Поїзди метро тут не ходять» and
  drops the token, turnstile and train-headway lines. Golden sets: `eval/kyiv-metro.json`
  (questions, driver notes, station pairs — no AI, `nlu/kyivMetro.test.ts`) and 40 `scope: kyiv` cases in
  `eval/golden.json` for the real-model run.
  Kyiv city train (Kyiv City Express, the ring): `npm run dovede:ring [-- --fetch]` (frontend,
  `scripts/kyiv-ring-snapshot.mjs` + pure `kyiv-ring-parser.mjs`) keeps `data/kyiv-city-express/source/trains.json` (the
  carrier's timetable pages: 20 stations, trains «А» clockwise, «Б» counter-clockwise, «Д» extra half-ring Почайна —
  Дарниця — Видубичі) and, with the manual `config.json` (`extra`: dates the «Д» trains run — 17–20 Nov 2026, they
  disappear from answers by themselves after `to`; the owner extends or cancels them in the admin without a deploy —
  page data `ring.extra`, `applyRingData` / `ringTrainWindow` in `data/kyivRing.ts`; `arrivals`: arrival at Дарниця), writes
  `DovedePage/data/kyivRingTimetable.json` — never edit it by hand, a test keeps it equal to the generator. Stations:
  `nlu/kyivRingData.ts` (byte-identical copy in `backend/src/dovede/`, ids `kyiv.e.<slug>`, `kyiv.borshch` kept): the
  seven next to a metro station (`metro`, `walkMin`) stay metro places in a question, the other 13 are places of their
  own (`nlu/kyivRing.ts`; «Дарниця» alone is the metro, the railway station needs «вокзал Дарниця»). `data/kyivRing.ts`
  finds a ride between two stations either way round the ring; `data/kyivTrip.ts` (`kyivWay`) picks metro, the train or
  both by arrival time (the train must win by ≥ 5 min and gets extra slack after an approximate arrival), and the
  composer's `kyivStep` turns it into story steps — `kind: 'ring'` has an exact time, card `ui/RingCard.tsx` (a station
  clock whose dial is the ring; extra trains are navy). Both ends inside Kyiv on known stations is shape `kyiv`
  (`Story.mode: 'kyiv'`): metro for comparison plus the next two trains. **Owner's rule (2026-11-17): the data is his —
  no disclaimers and no source credit on the page.** Golden sets: `eval/kyiv-ring.json` (no AI,
  `data/kyivRing.test.ts`) and `scope: ring` in `eval/golden.json`; new station or wording = edit both copies of the data
  and bump `PROMPT_VERSION`.
  Second corridor, Zhytomyr ↔ Malyn (city to city only): `FarCity` in `data/anchors.ts`, `intercityTrips(…, far)` and the
  `to_malyn` / `from_malyn` shapes. Malyn anchors: the bus station (`st_0004`, confirmed), pl. Soborna by RBK (`st_0070`) and
  the southern entry over the Irsha on vul. Chornovola (`st_0092` in, `st_0091` out) — the last two are «зазвичай»; on equal
  arrival the composer prefers the anchor with fewer city-bus rides. The Zhytomyr end is «Автовокзал Житомир-1» plus a
  Google Maps link. Schedules from Malyn carry no arrival time or price, so the arrival is an
  estimate by the path in the route slug (via Потіївка / Радомишль / through routes) and always «≈»; through routes to
  Базар read the Malyn time from the boarding text. No elektrichka there; rides use `defaultCarMinutes(far)`.
  City transport in Kyiv and Zhytomyr (stage 3а): a place inside the far city named in words («в Житомир на Польову 12»,
  «до Києва до Охматдиту») is `PlaceRef.detail` — only together with `city.Kyiv` / `city.Zhytomyr` (dictionary:
  `farDetails` in `nlu/parseLocal.ts`, words right after the city name, put into the nominative; Claude: the `detail`
  field of the schema; URL `fd=` / `td=`). The composer adds a story step `kind: 'city'` (`cityStep`: from the point
  where the intercity trip arrives, or to the boarding point with a 7-minute buffer) and the page asks the server for
  what is missing in up to three rounds (`cityAsks` → `GET /dovede/city-route` → compose again); no answer = the old
  Google Maps button. Card `ui/CityLegCard.tsx`. A trip inside one far city with a place in words at either end
  («Київ, з Предславинської 28 на Севастопольську площу», `f=city.Kyiv&t=city.Kyiv&fd=…&td=…`; also metro / station id
  at one end) is shape `city` (`insideCity` in `classify`, `cityOutcome`): one story `mode: 'city'` made of that single
  step, asked with the person's words at both ends (an id only where the server knows it — metro, `kyiv.pas`,
  `kyiv.borshch`); when the server has no answer the outcome is `city_link` — a panel with the Google Maps link, never a
  story with zero minutes. Two known Kyiv stations stay shape `kyiv` (own data); a city named without a place stays
  `outside`. The dictionary reads in-city questions itself (`inCityTrip` in `nlu/parseLocal.ts`): the city named as
  «where» — «у Києві / в Житомирі», «по Києву», «Києвом» or the bare name first («Київ предславинська 28
  севастопільська площа»: split at the house number) — with no other city in the question; «з …» / «на / до …»
  phrases become `detail` of that city on each side, a known point (metro «з метро Хрещатик», «з вокзалу») stays itself,
  and «з Києва з … до Києва на …» still goes through `farDetails`. Golden `ct-19…25` (tag `incity`) must all pass. Every answered city step is split by mode (`compose/cityTransit.ts`, `splitCityRoute`, called by `cityLeg`):
  walks become `walk` legs; Kyiv metro becomes our own `metro` leg (Google's boarding / alighting stations found in
  `METRO_STATIONS` by name, `metroTrip`; two trains with a short walk between = one ride with a transfer); Kyiv City
  Express (`HEAVY_RAIL`, line «Kyiv City Express» / headsign «E1/E2 (…)») becomes our `ring` leg from the timetable
  (`nextRingRide` — always ours, the wait at the platform counts; Google names: Latin «i», «Північна» = «Вокзальна»);
  everything else is a `cityRide` leg drawn by `ui/CityRideCard.tsx` per mode (`rideLook`: bus, minibus = `SHARE_TAXI`,
  trolleybus — wires over the card, tram — rails, speed tram — stops named «станція "…"» or `LIGHT_RAIL`, own station
  line, funicular — a slope with our station names from `FUNICULARS`, rail — suburban trains), with «перевірено N днів
  тому» and the map link only on the last Google ride. Waiting Google does not itemise (its total is longer than the
  steps) goes before the first Google ride and, from `WAIT_SHOWN_MIN` (3) minutes, is a `wait` leg «Чекати ≈ N хв на
  зупинці «…»» (also in the share text). Cards are per mode, not per city. Real answers for each mode are test
  fixtures in `compose/fixtures/kyiv-city-modes.json` (from our DB, with the `ask` that produced them); the same pairs
  are `MODE_PAIRS` in `backend/src/dovede/city-route.ts`, part of `SEED_PAIRS`, so background learning keeps them
  fresh (a backend test keeps the two lists equal). Server `backend/src/dovede/city-route.ts`: a stored answer of the same
  pair, day type and hour ± 1 not older than the fresh window (30 days by default, setting `city.freshDays`) is
  served from `DovedeCityRoute` (`source: 'stored'`), otherwise
  Google Routes TRANSIT is asked (`GOOGLE_MAPS_API_KEY`; daily cap — setting `city.dailyCap` 0 – 1 000 000, above
  20 000 only after a warning: registry `warnAbove`, the admin row shows it and «Зберегти все одно», the PUT needs
  `confirm: true` or answers 409 (owner, 2026-11-22; `drive.dailyCap` the same), else
  `DOVEDE_CITY_DAILY_CAP`, else 150; the count of the Kyiv day, the
  people / learning split, people refused, the pause after Google's 429 / 401 / 403 and its last error text live in
  `DovedeCityGoogleDay`, shared by every container — one `cityRoutes` instance per process is created in `index.ts` and
  passed to `createApp`, so people and background learning share it too) and the route, its lines
  (`DovedeCityLine`), stops (`DovedeCityStop`) and the demand (`DovedeCityDemand`) are written to the DB. **Owner's
  decisions (2026-11-17):** Google answers are stored under his own contract with Google (switch `DOVEDE_CITY_STORE=0`,
  `DOVEDE_CITY_ROUTES=off`); the card never credits Google — every answer shows «перевірено N днів тому» (see below); **these tables are never deleted from — only archived** (`archivedAt`,
  `POST /admin/dovede/city/archive { action: archive | restore }`; archived rows are neither served nor refreshed).
  One place whose Google answer is wrong (Google matched the words to another spot) is archived on its own: list «Місця»
  in the admin block (`AdminPage/DovedeCityPlaces.tsx`, `GET /admin/dovede/city/places`,
  `POST /admin/dovede/city/place/archive { city, key, action }`) → `archivePlace` puts the place into `DovedeCityPlace`
  and archives its routes. Unlike the bulk archive, a person's question does not bring it back: while the place is
  archived the server neither serves stored rows nor asks Google about it (`reason: 'archived'`, the page shows the
  Google Maps button, no demand is counted), learning skips it, and the bulk «Відновити з архіву» leaves it archived —
  only «Повернути» next to the place restores it. Known point ids (boarding points, metro) cannot be archived.
  Background learning: `startIntervalJob('dovede-city-learn')` (`DOVEDE_CITY_LEARN_INTERVAL_MIN`, default 60) refreshes
  the most asked pairs and `SEED_PAIRS` within half of the daily cap, then re-asks stored Google answers that have
  expired or will within `refreshLeadDays` (2 days) — on the row's own day type and hour, most served first
  (`DOVEDE_CITY_REFRESH=0` switches it off). A row whose refresh failed gets `refreshFailedAt` and is left alone for
  `REFRESH_RETRY_DAYS` (7); archived rows are never refreshed. The same pause applies to a demand pair the learning
  asked Google about without success (`DovedeCityDemand.learnFailedAt`) and to a failed seed pair (in memory) — a few
  dead pairs must not eat every tick. A person's own question is never held back by these marks. Only «no route» is
  the pair's fault (also Google's 400 / 404). Google's own quota (HTTP 429) answers `reason: 'cap'` and a refused key / disabled API / billing (401, 403)
  `reason: 'denied'`: neither is counted in our cap, both block further calls for `QUOTA_BACKOFF_MS` (10 min), and
  Google's own error text is kept in memory and shown in the admin block and at the end of a crawl run
  (`googleError: { at, status, message }`). A 429, a 403, our cap or a Google failure stops the learning tick and marks
  nothing; the crawl never journals such failures, so the question stays in its queue. Admin block «Місто: що вже знаємо»
  (`AdminPage/DovedeCityPanel.tsx`, `GET /admin/dovede/city`). Golden `scope: city`.
  **Learning cities** are one registry, `backend/src/dovede/learn-cities.ts` (code, name, genitive, place id, arrival
  points, default origins, depth): `CityCode` / `CrawlCity`, `CITY_NAME`, `ARRIVAL_POINTS`, preset cities and every `city`
  check in the router derive from it, and the admin reads `GET /admin/dovede/city/cities` (`dovede/useLearnCities.ts`).
  A new city = an entry there plus its points in `KNOWN_POINTS` / `POINT_LABEL` and its list in `learn-places.ts`.
  Korosten is the third city (arrival point `korosten.vokzal`; starter list `korosten-learn-places.ts` is generated by
  `data/korosten-transport/dovede-learn/build.py` from an OSM / Nominatim snapshot — only what the page cannot answer
  itself: no dataset stops, streets or landmarks; a frontend test runs every line through the page's own parse — edit
  `config.json` there, never the generated file): its own
  dataset stays the main source and the server is asked only about places without a stop. **A city with `ownDataset`
  (Korosten; analysis 2026-11-23 in `Docs/dovede-learning-roadmap.md`): Google teaches only «which of our stops is
  near this place and how far to walk», the bus comes from our timetable** — on the page `ownCityLegs` in
  `compose/composeStories.ts` turns a server answer into a walk + our planner's journey + a walk (Google's stop names →
  ours by `korostenStopForName` in `korostenPlaces.ts`, byte-identical in the backend; no match, e.g. «Агромаш», or a
  walk-only answer → Google's answer as is); the server serves a stored answer of the pair at any hour and day
  (`findStored`, `peekMany`), prefers one with a ride over walk-only; campaigns drop our own stops from their seeds
  (except `check` and `custom`), never walk deeper (depth 0), and the `refill-*` presets are not offered there. A Google
  answer the page could not move onto our timetable is still checked against it (`googleOffTimetable`: a train inside
  the city, or a line with no trip of ours within −60…+30 min → the Google Maps button, never shown as a ride); the
  quality report of such a city (`own-timetable.ts`, `findSuspicious(…, own)`) adds `line_not_running` / `rail_in_city`,
  skips our own stops and counts walk-only / asymmetric only within the city's service hours; and the «Час у дорозі за
  GPS» card shows each pair of the latest `check` campaign with our minutes, GPS (the main source) and Google
  (`transport-time-check.ts` → `timeCheck` of `GET /admin/transport/gps/run-times`: recalc / gps / google_only / ok). A passenger stop of a city's
  dataset (`st_…`) is a known point with coordinates (`resolvePoint` in `city-route.ts`, technical points refused), and a
  point with coordinates goes to Google as `location.latLng` (`waypoint`), not as an address string.
  On the Malyn page «у Коростені …» with Korosten not an end of the trip, no other city and no Malyn-only place is a
  question about the city Korosten, not the corridor (`asksInsideKorosten`); in Korosten mode the city itself is never
  an end («у Коростені з вокзалу до Агромашу» → the place in words), an adjective («Коростенська міська рада») is part
  of a name, and an initial before a street («вулиця Г. Сковороди») is skipped by `korostenSpot`.
  On the page, Korosten mode (`c=Korosten`) turns an end the dictionary does not know into «place in words»
  (`saidPlaces` / `withKorostenWords` in `korosten/korostenCity.ts` → `city.Korosten` + `detail`), `korostenShape` answers
  shape `city` (the stop goes to the server by its `st_…` id) and the same `cityOutcome` as for Kyiv draws it; two stops
  still use the browser planner. In the Malyn ↔ Korosten corridor `cityDetail.ts` reads the words right after «в Коростень / з Коростеня» as `detail`
  (never a Malyn street; «на вокзал» is no place); `combineCorridor` prefers a dataset stop of that name, and for a place
  without a stop `korostenLeg` answers `city` — a server step from / to `korosten.vokzal` (the point «Навчити місто»
  learns from). Korosten streets and houses (`data/korosten-streets.json`, a lazy chunk; generator
  `data/korosten-transport/dovede-streets/build.py` shares `build()` with Malyn's, snapshot by `fetch_osm.py` from the
  official OSM API tiles) answer an address without the server: `korostenSpot(words)` in `korosten/korostenStreets.ts`
  gives a place with a point (ids `kstreet.…`, registered through `setExtraStreets`), so Korosten mode becomes `intra`
  and `korostenLeg` plans from / to the station (`farSpot`); the intent and URL keep `city.Korosten` + words.
  Korosten landmarks work the same way (`data/korosten-landmarks.json`, same chunk; `data/korosten-transport/dovede-landmarks/`:
  snapshot `osm/places.json` written by the streets' `fetch_osm.py`, manual `config.json`, generator shared with Malyn's
  `build()`): `korostenSpot` tries the address first, then a landmark whose name covers all the words (ids `klm.…`,
  `setExtraLandmarks`).
  `siteForm` uses `detailForm` for Korosten too, so every name of the starter list must read back
  unchanged (a test checks it; fix names in the generator's `config.json`).
  **Learning campaigns** (admin plan step 6, `Docs/dovede-admin-roadmap.md` «Крок 6»; `src/dovede/city-campaign.ts`): the
  owner picks a preset («Навчити місто», «Дообучити: вечір / вихідні / ранок», «Питання людей без відповіді», «Види
  транспорту», «Свій список»), sees the estimate (`POST /admin/dovede/city/campaigns/preview`: level 0 exactly from the DB via
  `cityRoutes.peekMany`, deeper levels as a low–high range) and approves or changes the number of **Google requests**
  (`budget`, `dailyBudget`; `POST /admin/dovede/city/campaigns`). The job `dovede-city-campaign`
  (`DOVEDE_CITY_CAMPAIGN_INTERVAL_MIN`, default 1, `0` = off) walks breadth-first like the crawl (`crawl-core.ts`
  `candidates` → places one level deeper, up to `maxDepth`; extra hours only for places that got an answer), up to 20
  asks per minute, asking through `cityRoutes.campaignAsk` (background: no demand count; returns `googleCalled`, which
  is what the budget counts — stored and own answers are free but still feed the walk). Google is asked only while
  today's calls are below the cap minus `reserveFor(cap)` (a fifth, at least 50) — the rest is for people. Our cap /
  Google 429 / 403 / switched off → `waiting` with `waitReason` (the ask goes back to the queue); own daily share spent →
  wait until Kyiv midnight (the card's «На добу» field sends `extend` with a new `dailyBudget`; raising it above what was
  spent today resumes a campaign that waits for `daily` at once, other wait reasons stay); budget spent → `done` /
  `budget` (`extend` reopens it). One container at a time leads a
  campaign (`leaseUntil`, 2 min); an ask left `asking` by a vanished container returns to the queue after 5 min. The server
  leads one campaign at a time — the oldest that may run now (`leaderOf`, shared by `tick` and the views); the others in
  `running` carry `queuedBehind` and the admin shows «У черзі після …», not «Іде». Tables
  `DovedeCityCampaign` / `…Place` / `…Ask` are never deleted from; `POST …/campaigns/:id/action { pause | resume |
  cancel | extend | archive }` (archive = hide a finished one). Admin section «Навчання» (`/admin/dovede/learning`,
  `AdminPage/dovede/DovedeLearnSection.tsx` + `dovede/learn/`; desktop-first, ~1440 px): campaigns with status, Google
  spent of budget, pause / resume / cancel / add budget / hide and the latest answers; «Нова кампанія» — city, preset,
  points, directions, hours as a day × hour grid (`learn/hours.ts` ↔ `weekday@09`), depth → «Оцінити» → the approved
  budget and daily share → «Почати» (only what was estimated; any change clears the estimate); «Крок зараз» of the
  background learning. Огляд shows the learning pill and tile and, under «Потребує уваги», a campaign out of budget, the
  last finished run and the count of suspicious roads.
  **Quality report** (step 8, `src/dovede/city-quality.ts`, pure `findSuspicious`): Google answers (not archived) of
  «arrival point ↔ place in words» pairs flagged as `next_to_point` (≤ 5 min), `near_far_points` (Kyiv: from the west
  metro points and from the station together < 20 min), `asymmetric` (there and back on one day type ≥ 2× and ≥ 20 min
  apart) and `walk_only` (no ride, ≥ 25 min). `GET /admin/dovede/city/quality?city=`; «Нормально»
  (`POST /admin/dovede/city/place/ok { city, key, ok }`) sets `DovedeCityPlace.okAt`, which hides the place from the
  report and archives nothing; «В архів» is the per-place archive. Block «Якість» at the bottom of «Навчання» (`#quality`,
  `learn/QualityPanel.tsx`; «Відкрити як людина» = `humanLink` in `learn/campaignText.ts`: Kyiv — the point id plus the
  place in words, Zhytomyr — a trip from `malyn.avtostantsiya`, so the page asks exactly the stored pair). A finished
  campaign's `report` adds the no-route share, the names the walk dropped as rubbish (`rejectedNames` in `crawl-core.ts`,
  stored per ask in `DovedeCityCampaignAsk.filtered`) and the city's suspicious count; the owner gets an admin-chat
  message when a campaign finishes or runs out of budget, and once (`alertedReason`, reset by the next answered Google
  ask) when Google refuses access (403). Preset «Освіжити застаріле» (`refresh`) re-asks Google answers older than
  `city.freshDays` on their own day type and hour (`CampaignSeed.slots`, `plan.ownSlots`), no new places.
  Preset «Звірити свій розклад з Google» (`check`, only cities with `ownDataset` in the registry — Korosten): pairs of
  stops of the city's own dataset (pure `dovede/city-check.ts`: `checkPairs` — start → end, start → middle, middle → end
  of every route direction, our minutes from the segments, the hour of a trip near 10:00; `checkVerdict` — same /
  Google faster / ours faster / other line / walk only / no route). The pair's names and our minutes live in the plan
  (`CampaignSeed.check`), the report in `report.check` (shown while the campaign runs too, card block «Звірка»). It
  never changes the dataset.
  The same block has «Скинути лічильник попиту» (`POST /admin/dovede/city/demand/reset`): it sets `asked = 0` and
  deletes nothing; a row with `asked = 0` is in neither the list nor the learning queue until a person asks again.
  `GET /dovede/city-route?…&learn=1` with the admin token is the learning mode (`find(q, true)`): same answer, same
  write to the DB, but no demand count and no `hits`; when it finds a road for a pair people asked, the pair is marked
  answered. Without the admin token the flag changes nothing. Stats also return `unanswered` (pairs with keys).
  Local crawl without AI: `npm run dovede:crawl -- "з Малина до Києва на вулицю Ентузіастів 7" --from святошин`
  (frontend; `scripts/dovede-crawl.mjs`) parses the phrase with the page's own `parseLocal` (bundled by esbuild), asks
  `GET /dovede/city-route` like the page does and walks breadth-first over the places found in the answers (transfer /
  alighting stops and line termini; metro and rail are skipped as own data). The pure crawl logic is shared with the
  server: `backend/src/dovede/crawl-core.ts` (test next to it; the CLI bundles it with esbuild; it owns `normalizeKey` /
  `dayTypeOf`, which `city-route.ts` re-exports). A place is asked in the page's own form — `detailForm(city, name)` in
  `nlu/cityDetail.ts` (`farDetails`, `nominative`, the preposition sets; imported by `parseLocal`), byte-identical in
  `backend/src/dovede/` together with `kyivMetro.ts` / `kyivRing.ts`; `nlu/cityDetail.test.ts` diffs the copies and
  checks `detailForm` against the full `parseLocal` over the place lists, the city-modes fixture and Zhytomyr stops.
  It never calls `/dovede/understand`. The journal `data/dovede-crawl/journal-<host>.jsonl` (gitignored) keeps what was
  asked, so nothing is asked twice within the fresh window (read from the admin stats, `--fresh-days` overrides) and a
  run without a phrase resumes — and asks again whatever has expired (`--status` says how much). The Google cap is
  shared with people: `--budget` (default 40 new answers per run) and, with the admin token in the environment,
  `--reserve` (default 50 of the daily cap left untouched). With the admin token it sends `learn=1`, so demand is not
  counted (`--as-person` switches that off); with only the guests' password every ask counts like a person's.
  `--both` adds the way back (place → boarding point), `--reverse` asks only that way — with an evening `--when` it
  is the trip home from the city.
  `--unanswered` starts from people's questions the server could not answer; `--places kyiv | zhytomyr | <file>` from a
  list — the walk skips stop names a city has many of («Супермаркет», «Авторинок» — `GENERIC` in the core) and names
  the page's parser cut off at a conjunction, because Google would match them to some other spot;
  starter lists are `backend/src/dovede/learn-places.ts` (`--places zhytomyr` also picks the city; `learn-places.test.ts`
  keeps every line a «place in words» for the page: no metro, no leading «Київський», no «імені», which the page's
  `nominative` turns into «іменя»).
  Zhytomyr from the owner's own site (stage 3б): `npm run zhytomyr:snapshot` (backend; flags in the script header) keeps
  `data/zhytomyr-transport/` — pages of `zt.rozklad.in.ua` (the site refuses requests without a browser `User-Agent`)
  parsed by `zhytomyr-site-parser.ts` into `routes.json`, stop coordinates from an OSM snapshot plus Google for names
  OSM lacks (`zhytomyr-stops.ts`, `stops.json`; manual `stops.hints.json`), and the check of every direction against
  Google Routes (`zhytomyr-google-check.ts` → `google/checks.json`, `REPORT.md`: three large spans decide `checked`, then
  every hop; resumable, Google's quota stops it early). The server has no `data/` directory, so the script also writes
  `backend/src/dovede/zhytomyr-own-data.ts`; tests keep all generated files equal to the generators — never edit them
  by hand, rerun the script. **Owner's decisions (2026-11-17):** the site's timetable is over a year old and «Google
  knows better», so the snapshot gives routes, stop order and stop names, while minutes between stops are corrected by
  Google (`buildZhytomyrOwnData`: a span whose minutes really differ is stretched to Google's time; a direction is
  `checked` when all three large spans agree or were corrected). `dovede/zhytomyr-own.ts` answers a **direct** trip
  from that data (`source: 'own'`, before the DB and Google, `DOVEDE_CITY_OWN=0` switches it off): only `checked`
  directions, only when both ends are the bus station or a place named like one of our stops, and **never an exact
  departure time** — only «кожні ≈ N хв» from neighbouring departures, waiting counted as half of it. Stop names that
  differ between the site and Google are not decided in favour of either: `REPORT.md` lists each pair with what
  OpenStreetMap calls the stops nearby (`nameChecks`). **No Google credit anywhere on the page** («це мої дані
  тепер»): the city card says only «перевірено N днів тому», whatever the source; do not add «за даними Google» back.
  Background learning also seeds the bus station → every route terminus (`SEED_PAIRS` from `ZT_OWN`).
  Kyiv surface transport from the owner's own GTFS of КП «Київпастранс» (learning step 8, `Docs/dovede-learning-roadmap.md`;
  owner's data like the metro — no source credit): `data/kyiv-transport/kpt-gtfs/gtfs_static.zip` → `npm run kyiv:kpt`
  (backend; pure `dovede/kyiv-kpt.ts`, `readZip` in `zip.ts`) → `backend/src/dovede/kyiv-kpt-data.ts` (`KYIV_KPT`:
  directions with 2–8 control points, weekday / weekend departures, minutes between points by departure hour) and
  `REPORT.md`; a test keeps both equal to the generator. Shapes are not used (65 % are straight 2–3-point lines);
  marshrutkas and suburban buses are not in the feed, so Google stays for them. `--fetch` takes the export address from
  `KPT_GTFS_URL` — never commit it; it is unreachable from the cloud sandbox. Kyiv marshrutkas come from the city's own
  list (data.kyivcity.gov.ua, CKAN datastore; snapshot `data/kyiv-transport/taxi/routes.json`, `--fetch-taxi`) →
  `kyiv-taxi-data.ts` (`KYIV_TAXI`: number, termini, route minutes, departures every A–B min). Step 8б: every Kyiv answer
  (fresh Google or stored) passes `withKyivOwnLines` (`dovede/kyiv-own-lines.ts`, called from `ownLines` in
  `city-route.ts`, switch `city.own`): a KPT line (mode + number, Latin look-alikes = Cyrillic) takes our headway; with
  stop coordinates (Google's answer or `DovedeCityStop`) within 500 m of its control-point line in order, also our ride
  minutes, «останній о …», «перший о …» and «сьогодні вже не ходить» (`lastDeparts` / `firstDeparts` / `gone`); a
  marshrutka from the list takes `headwayMin`–`headwayMax`. Such steps carry `own: true`; the DB keeps Google's answer
  as is. Cards: `headwayText` / `serviceText` in `DovedePage/ui/format.ts`. Step 8б-2: before Google, a new Kyiv pair is answered
  from «halves» of stored Google answers — the boarding stop near the start (roads from it anywhere) and the alighting
  stop near the place (roads to it from anywhere), walks ≤ 15 min, coordinates from `DovedeCityStop` — joined by one main
  KPT direction passing ≤ 300 m from both in order (`dovede/kyiv-own-trip.ts`, `ownKyiv` in `city-route.ts`, switch
  `city.own`): `source: 'own'`, never stored, no exact departure time (half the headway as the wait).
  Korosten city questions (stage 1, `DovedePage/korosten/korostenCity.ts`): the page holds a city (`Malyn` / `Korosten`,
  URL `c=Korosten`) and remounts the search per city (one planner on screen); Korosten words in a question switch it.
  Places are `StopPlace` entries of Korosten stops plus folk names (`KOROSTEN_ALIASES`), answers are `intra` /
  `route_info` on the Korosten planner. Stage 2: `POST /dovede/understand` takes `city: 'Korosten'` — its own system prompt
  (`backend/src/dovede/korosten-prompt.ts`, `KOROSTEN_PROMPT_VERSION`; the Malyn prompt is unchanged) built from the
  Korosten stops / routes in the DB; Korosten places and folk names are one file `korosten/korostenPlaces.ts`, byte-identical
  in `backend/src/dovede/` (a frontend test diffs them); golden `eval/korosten-golden.json` (`DOVEDE_EVAL_CITY=Korosten`).
  Korosten ↔ Malyn door to door (stage 3): anchor = Korosten railway station for elektrichka and marshrutka (owner,
  2026-11-18; `KOROSTEN_STATION` st_1001, `FarCity 'Korosten'`); only elektrichkas are in the timetable. The Malyn page
  loads the Korosten dataset as a second, passive planner (`usePlannerModel(city | null, { passive })` — keeps the page's
  route numbers / colours and its own segment durations; `routeNoIn` / `routeColorStyleIn` print another city's route),
  `combineCorridor` merges the Malyn and Korosten parses into `city.Korosten` + `detail` = Korosten stop name, and the
  composer plans the Korosten part with `farPlanner` (`korostenLeg`); Korosten bus legs carry `city` and link to
  korosten.kiev.ua. No Claude call for the corridor. A second planner builds its day timetable with its own city's segment
  durations **and** verified-route list (`verifiedRoutesCity`), then restores the page's — otherwise Korosten routes outside
  Malyn's verified list ran 2 min per chain hop. Planner vs Google: manual `journey/google.oracle.test.ts`
  (`GOOGLE_ORACLE=1`, report `data/korosten-transport/google/planner-check.md`).
  Rides among the variants: when no transport is named (or «попутка» is named together with another), driver
  listings with a time become stories `mode: 'poputka'` next to marshrutka and elektrichka (`rideStories`, leg kind
  `ride`, up to three; «попутка» alone stays the board). Arrival = driver's departure + car time, always «≈». Car time:
  `GET /dovede/drive-time` (Dovede access) → `backend/src/drive-time.ts` — Google Routes with traffic
  (`GOOGLE_MAPS_API_KEY`, 15-min memory cache, `DRIVE_TIME_DAILY_CAP` 200, nothing stored), else the route's
  `TripRoute.carDurationMinutes` («Авто в дорозі, хв» in the admin «Маршрути» form), else 95. Pickup / drop-off come from
  the driver's note (`nlu/notePlaces.ts`, needs the listing's direction: streets are ignored, a bare «вокзал» is Malyn's
  only with the preposition of its own end, «заберу по місту» = no city leg; Kyiv points via `kyivNotePoint`); no Malyn
  place named → centre «Промінь» marked as an assumption, and the city leg to it is planned like for a marshrutka; no
  Kyiv point named → «зазвичай метро «Академмістечко»»; a ride Malyn → Korosten with a named place is counted from the
  Korosten station as an assumption and continues with the same `korostenLeg` as after the train (drivers' notes name
  no Korosten places). `/admin/dovede` has «Звідки забирають попутки»
  (`GET /admin/dovede/pickups`: notes only, links / nicknames / phones stripped by `pickupNote`; parsed in the browser by `dovedePickups.ts`).

### In-process scheduled jobs (no external cron)

`src/index.ts` starts these timers via `startIntervalJob` (`src/interval-job.ts`: single-flight, errors only
logged); each interval env var accepts `0` to switch the job off. The matching admin `POST` endpoints stay for
manual runs. Details and rules: `RAILWAY_CRON_REMINDERS.md`.

| Job | Env (default, min) | Code |
|-----|--------------------|------|
| Telegram group import (PoDoroguem etc.) read from `DzhuraMessage`, cursor `TelegramFetchState` | `TELEGRAM_IMPORT_INTERVAL_MIN` (10) | `telegram-dzhura-source.ts`, `fetchAndImportTelegramGroupMessages` |
| Deactivate expired poputky listings + expire pending `RideShareRequest` | `VIBER_CLEANUP_INTERVAL_MIN` (5) | `viber-listing-expiry.ts` |
| Archive old listings (`ViberRideEvent` import, delete inactive > 90 d) | `VIBER_ARCHIVE_INTERVAL_MIN` (1440) | `viber-listing-archive.ts` |
| Trip reminders: 20:00 day before, 08:00, one pre-departure (2 h / 30 min) | `BOOKING_REMINDERS_INTERVAL_MIN` (1) | `booking-reminders.ts` |
| Watch external timetable sources (Korosten council page, data.gov.ua sets) → admin-chat alert on change | `TRANSPORT_SOURCE_WATCH_INTERVAL_MIN` (360) | `transport-source-watch.ts` |
| Record city-transport GPS tracks from the Korosten council feed into `TransportVehiclePosition` (30-day retention; admin-only `GET /admin/transport/gps`; run times between stops from those tracks against our segments — pure `transport-gps-times.ts`, `GET /admin/transport/gps/run-times?city=&days=`, card «Час у дорозі за GPS» on `/admin/route-schedule`, read-only) | `TRANSPORT_GPS_INTERVAL_MIN` (1), `TRANSPORT_GPS_RETENTION_DAYS` (30) | `transport-gps.ts` |
| Elektrichkas from the SW Railway timetable (swrailway.gov.ua, line Kyiv – Teteriv – Korosten): one `Schedule` row per train per city pair (Kyiv ↔ Malyn / Korosten, Malyn ↔ Korosten) — adds, updates, removes its own rows, changes → admin chat; manual `POST /schedules/eltrain-sync` (`dryRun`, `force`, `pages`) | `ELTRAIN_SYNC_INTERVAL_MIN` (360) | `eltrain-sync.ts` |
| «Доведе» step 8г: Kyiv KPT live vehicle positions (GTFS-RT, `KYIV_GTFS_RT_URL` — Railway only, never committed; own protobuf reader `gtfs-rt.ts`, no plates) → visits near the route's control points (`dovede/kyiv-kpt-passes.ts`, ≤ 150 m, arrival / departure) in `KyivKptPass` (no raw points); report «GPS vs our timetable» between control points (`kyiv-kpt-gps-times.ts`) and the last tick at `GET /admin/dovede/kyiv/gps?days=` | `KYIV_GPS_INTERVAL_MIN` (1), `KYIV_GPS_RETENTION_DAYS` (30) | `dovede/kyiv-kpt-gps.ts` |
| «Доведе» city learning: demand pairs, `SEED_PAIRS`, refresh of stale answers (within `learn.sharePct` of the Google cap) | `DOVEDE_CITY_LEARN_INTERVAL_MIN` (60) | `dovede/city-route.ts` `learnTick` |
| «Доведе» learning campaigns started from the admin (≤ 20 asks per tick, approved Google budget, reserve for people) | `DOVEDE_CITY_CAMPAIGN_INTERVAL_MIN` (1) | `dovede/city-campaign.ts` `tick` |

- A listing is visible until `endsAt + 1 h`. `endsAt` = trip day + end of `departureTime` **in Kyiv time** stored as
  UTC (`getListingEndsAt`; Railway runs TZ=UTC). Public reads (`/viber-listings`, `/search`, `/:id/contact`,
  `searchPoputky`) filter with `notExpiredWhere()` themselves, so the site does not depend on the sweeper.
- Reminders are at-most-once: `BookingReminder(bookingId, kind)` is claimed before sending (timer, manual POSTs and
  overlapping containers share it). Stale reminders (server down) are skipped.
- Telegram-group messages reach the parser as text `Name|@username: body` (`formatSenderLine`,
  `fetch_telegram_messages.py`). The name may contain anything except newline/`|`; the parser anchors on
  `|@username:` (`telegram-parser.ts`). A username without a phone becomes a `Person` with a technical phone
  `380010000000+` (`findOrCreatePersonByTelegramUsername`).
- Authors with neither a phone nor a `@username` (hidden in Telegram) are still reachable: the Dzhura capture keeps the
  sender's numeric id and Telethon `access_hash` (`DzhuraPerson.accessHash`), the import creates a `Person` keyed by
  `telegramUserId` with a technical phone (`findOrCreatePersonByTelegramUserId`), and `sendMessageViaUserAccount`
  writes by id (`send_message.py --user-id … --access-hash …`) as the last free tier after bot → `@username`. One
  short message (the listing confirmation with the bot subscribe link / a match notice), never a dialogue: once
  the person presses `/start`, `getPersonByTelegram(userId, …)` finds that same Person and sets `telegramChatId`, so
  everything else goes through the bot. Safety: `telegram-user-dm-guard.ts` (switch and daily cap in the admin
  «Сповіщення» — `NotificationSettings.tgUserByIdEnabled` / `tgUserByIdDailyCap`, `null` = `TELEGRAM_USER_DM_BY_ID_DAILY_CAP`
  or 20 per Kyiv day; `TELEGRAM_USER_DM_BY_ID=0` switches it off for good, the admin cannot override it; stops for the day on
  `PEER_FLOOD`) because the one personal session also carries Dzhura and the lunch listener. Technical phones (`380010000000+`) never get paid SMS
  (`sendPaidFallbackSms` → `technical_phone`) and are not revealed by `GET /viber-listings/:id/contact`.
- `ViberListing.source` is only the coarse channel (`Viber1` / `telegram1`; also feeds the ingest hash). Where a
  Telegram listing came from is in `sourceChat` / `sourceTopicId` / `sourceMessageId` (first source wins on merge,
  filled only if empty); `serializeViberListing` adds `sourceUrl` (`telegram-source-link.ts`) for the admin list and
  the admin-chat notification. Public DTOs (`PUBLIC_LISTING_SELECT`) never expose them. The admin list is the «Viber»
  tab (`AdminPage/viber/ViberTab.tsx`, own state, pure filters in `viberText.ts`; `?issue=notime|nophone|noroute|unnotified`).

### Testability pattern

Business logic takes its dependencies (Prisma client, admin password, etc.) as explicit parameters
rather than reading module-level singletons, so tests can inject stubs/mocks. Key hooks:
- `createApp({ prisma, adminPassword })` + `supertest` for HTTP-level tests: always `request(await listenLocal(app))`
  (`src/http-test-server.ts`, closed after each test), never `request(app)`. supertest listens on `::` but connects to
  127.0.0.1, and on macOS another process holding that port on 127.0.0.1 answers instead (flaky 404s).
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
- **One Telethon session, one place.** The same session connected from two IPs at once makes Telegram
  revoke it for good (`AuthKeyDuplicatedError`, which happened during a deploy on 2026-10-10). So:
  - the session lives only in the Railway variable `TELEGRAM_USER_SESSION_BASE64`
    (`auth_session.py --export`); `telegram-user-session.ts` writes it to
    `telegram-user/session_telegram_user.session` at boot, and it is never in git;
  - every Telethon spawn (listener, fetch/send/resolve, `post_text`, `reparse`) first awaits the
    `TelegramSessionLease` row through `awaitTelegramSession()` in `telegram-session-lease.ts`. That
    lease has a DB heartbeat and is released on SIGTERM only after the listener has exited, so during
    a deploy the new container waits for the old one;
  - a dead session (`FATAL_TELEGRAM_SESSION_ERRORS`; listener exit code 78) stops listener restarts
    and alerts the owner's admin chat.

  New Telethon call sites must go through `withTelegramUserSessionExclusive` or
  `awaitTelegramSession()`.
- **The PoDoroguem listener is a separate Railway service with its own Telegram account** (`podoroguem-listener/`,
  Dockerfile at the repo root context; it captures only the PoDoroguem group into `Dzhura*`, no relay). Railway redeploys
  it on every push to `main` and starts the new container ~15 s before stopping the old one, so it takes its own row
  (`TelegramSessionLease.id = 2`; `id = 1` is the owner's account in the backend) through `session_lease.py` — same
  heartbeat / stale / settle rules as the Node lease, released only after `client.disconnect()`. A dead session
  (`FATAL_SESSION_ERRORS`) ends the process with exit code 78 and a log line saying how to log in again
  (`python3 podoroguem-listener/auth.py --fresh --export`, then replace `TELEGRAM_USER_SESSION_BASE64` of **that** service
  only). Lease unit tests: `python3 -m unittest podoroguem-listener/test_session_lease.py` (not in CI).
- Photos and PDFs posted in the lunch group are read by Claude (`ANTHROPIC_API_KEY`; `ANTHROPIC_WORKSPACE_ID` only for
  an organization-level key not bound to a workspace; `lunch/ocr_menu.py` → `scan_media_bytes`) in the Python lunch
  listener. One request answers `kind`: `menu` (≥ 5 priced dishes, merged into the day's menu, never replacing it),
  `receipt` (the transfer amount) or `other`. **Two models:** `LUNCH_OCR_MODEL` (default the cheap
  `claude-haiku-5-5`) looks at every file and reads receipts; when it says «menu», the menu is read again by
  `LUNCH_MENU_MODEL` (default `claude-opus-5-5`) and that result is used. Do not put the menu on the cheap model: on
  the real photos of 13 and 16 Nov 2026 Haiku read receipt amounts exactly like Opus (14 of 14) but shifted menu
  prices by a row (16 wrong prices of 34 in one day). Haiku 5.5 has no server-side `fallbacks`, so that parameter is
  sent only to models that support it. Bank PDF receipts are rejected by the API as documents («The PDF specified was
  not valid»), so the first page is rendered to a JPEG with `pypdfium2` and sent as an image.
  **Payment evidence** (`lunch/evidence.py`): a receipt photo/PDF becomes a `LunchPayment` with `source = 'receipt'`
  (the same amount already recorded from «оплатив 150» or the admin button is only confirmed, never doubled, and
  vice versa; a receipt of another amount is not added either when the debt is already settled by a payment without
  a receipt — `apply_receipt` → `settled`); a `check.monobank.ua/p/…` link cannot be read (captcha), so it pays the person's whole current debt
  with `source = 'link'` («суму не перевірено»; a link sent before the order is settled when the order appears);
  «скинула гроші» / «оплатив» with no amount and no receipt does the same with `source = 'claim'` (the owner's
  decision; past tense in the first person only — «скину», «скиньте», a question are not payments);
  «віддам готівкою» sets `LunchOrder.cashPromised` and shows «💵 Готівкою» in our reply until paid — it is not a
  payment. **Debt reminder** (`lunch/debt_reminder.py`): when the person who carries the money to the canteen
  (`LUNCH_COLLECTOR_IDS`, default Андрій Кравченко `5040092113`) writes «Иду в столовую. Кидайте деньги» or similar, the
  listener queues a reply listing today's debtors with mentions (not him, not «Дозаказ»); one per message, 10-min
  cooldown, deduplicated in SQL (`enqueue_outbound_once`), and catch-up answers a missed call younger than 20 min. Its
  header «Нагадування про оплату обіду» is in every echo filter (listener, `is_system_echo`, `lunch-people.ts`). Every scanned message is journalled in `LunchMediaScan`, so catch-up after a listener pause (which now
  also picks up a missed menu photo and receipts) and «Розібрати день» never ask the model twice; a failed scan is
  not journalled and is retried. Nothing is posted to the group for a receipt — «✅ Оплатив» appears as an edit of
  our reply. The reply text is built in two places that must stay identical: `lunch/formatters.py` and
  `backend/src/lunch.ts` (`formatPaidLine`, `formatCashLine`). Admin job `ocr_compare` (`POST
  /admin/lunch/ocr-compare`, block on the lunch tab) runs a day's real photos through several models and reports
  where they differ, with time and cost; it changes nothing.
- The same listener process hosts «Джура» chat capture (`DZHURA_ENABLED`, default on) — see above.
- **Personal account and SMS** (admin «Сповіщення», `/admin/notifications`, `AdminPage/NotificationSettingsTab.tsx`;
  settings row `NotificationSettings`, 30 s cache, no deploy): when the bot does not reach a person, the personal
  Telegram account is tried first (free), then paid SMS (TurboSMS). The owner switches the personal account per
  scenario — match notices (`tgUserMatchEnabled`) and the author's listing confirmation
  (`tgUserAuthorConfirmationEnabled`) — plus DMs by id (above). Every `sendMessageViaUserAccount` call carries a
  `purpose` (`match` | `authorConfirmation` | `promo` | `other`) and writes one row to `TelegramUserSendLog` (purpose,
  how it got through, ok — never the contact or text); `GET /admin/notification-settings/usage` returns those counts
  (`telegramUser`), SMS per scenario this month (`smsByUseCase`) and the last five account errors without the contact.
  Switches save at once, fields with «Зберегти».
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

  Plus non-menu routes: `AdminPage` (`/admin/:tab?`; the default tab «Бронювання» is `AdminPage/bookings/BookingsTab.tsx`,
  `?when=upcoming|today|past|all`; «Реклама» is `AdminPage/promo/PromoTab.tsx` with sections `/admin/promo`, `reminders`,
  `regulars`; «Дані» is `AdminPage/persons/PersonsTab.tsx`, filters in `personsFilter.ts`, `?only=`; «Архів» is
  `AdminPage/PersonArchiveTab.tsx`, view only, helpers in `archive/archiveText.ts`; «Графік транспорту» has sections
  `/admin/route-schedule` (grid), `sources`, `gps`, city kept in `?city=`), `StickerWallPage` (`/admin/wall`),
  `LoginPage` (`/login`), `UserPage` (`/user`). `/booking` redirects to `/mizhgorodski` and `/poputky` to
  `/mizhgorodski?type=carpool` (the «Попутки» tab already chosen; the page's canonical stays `/mizhgorodski`). The 301s are
  one table, `EXACT_REDIRECTS` in `frontend/scripts/serve-dist-rules.mjs` (pure, tested in `serve-dist-rules.test.ts`;
  the visitor's own query is merged into a target that has one), mirrored by `<Navigate>` in `App.tsx`; keep the two in
  step. Browsers and the CDN keep a 301 for a day (`max-age=86400`), so a changed target reaches repeat visitors with a delay.
  The old BookingPage and PoputkyPage components were removed in #38 (recover them from git history
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
  «people from stickers who came back» tiles on the tab. The tab lists every stop with its counts (filter in `?only=`:
  all / with stickers / `silent` / without a sticker; a printed side with no scan for `SILENT_DAYS` = 14 days after its
  print or last scan is «мовчить» — check it on the spot; pure `stopStatRows` in `stopSticker/scanStats.ts`),
  daily / hourly charts (Kyiv time) and prints recorded in `StickerPrint` on print/SVG download
  (`GET /admin/transport/sticker-scans?days=1|7|30|90`, 1 = today since Kyiv midnight; `POST /admin/transport/sticker-prints`).
  Wall widget `/admin/wall?key=…` (`src/pages/StickerWallPage/`, rendered without NavBar): a phone in
  landscape polls `GET /transport/sticker-wall?key=&after=<id>` every 30 s and celebrates each new scan
  (colour of the stop's line, Web Audio chime) — a finished «Доведе» teaser (`GET /ads/wall`, shown once per browser,
  so a new person) gets its own white «new passenger» celebration with the teaser's bouncing dot — the last 20 before each
  round thousand (№ 981–1000) get a split-flap counter the dot lands on instead (`passengerCountdown`,
  `WallFlapCounter.tsx`; 0999 → 1000 carries through all tiles and turns blue) — and a talon punched
  after the /dovede intro video (`AdEvent` `punched`) gets the site's own talon, punched and stamped; the header shows
  the city of `?city=`; a 4th tab «Люди» shows passengers from stickers; the key is read-only, `HMAC(ADMIN_PASSWORD)` from
  `backend/src/sticker-wall.ts`, issued by `GET /admin/transport/sticker-wall-key`.
  Workflow in `Docs/stop-stickers.md`.
  **People from stickers** (`Docs/stop-stickers.md`, «Люди з наклейок»): every anonymous browser that scanned a sticker is a
  passenger with a number in its city (order of first appearance, counted from `StickerPerson.id`). The phone keeps a
  passport (`stickerPassport.ts`, `sticker-passport:v1`: first sticker, all stops, the number from the scan reply); the DB
  keeps `StickerPerson` (`backend/src/sticker-people.ts`), written by the scan, return and finished-teaser endpoints (a
  failure never breaks the scan) and backfilled by its migration. Read by the wall's «Люди» tab
  (`GET /transport/sticker-wall/people`) and the admin «Наклейки зупинок» → «Люди» (`?view=people`,
  `GET /admin/transport/sticker-people`). Nothing is shown to the passenger yet — greetings and promotions come later.
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
- **Journey planner with transfers** (`Docs/transport-journey-planner-2026-10.md`): `/transport` plans trips in the browser
  (offline-first, no backend endpoint) with a round-based RAPTOR in `src/pages/LocalTransportPage/journey/`. One list of
  journeys (direct + transfers) replaces the old per-route cards: `buildTimetable` (from the dataset via `chainForRecord` +
  `recordTiming`, passenger stops only, `serviceId` filter — call it **after** `configureSegmentDurations`), `planDay` (whole-day
  profile + Pareto over departure/arrival/transfers), `journeyWindow` (depart-at / arrive-by slice), `legAlternatives` (next trips
  of a leg). Walking between stops closer than 400 m is straight-line × `detourFactor` (all numbers in `journey/options.ts`,
  calibrated against Transitous). Service calendars are `everyday` / `weekdays` / `weekends` (`tripRunsOn`); the planner, the
  route page and the stop board show a trip only on its type of day. «Звідки/Куди» may be a point — `me:lat,lng` (geolocation) / `pt:lat,lng` (map click), kept in
  the same `/transport/:from/:to` URL, never sent to GA4 (`endpointGaValue`); `?a=1` is arrive-by. A walk from the start never
  prunes vehicle arrivals (regression test in `engine.test.ts`). `transitous.oracle.test.ts` (manual, `TRANSITOUS_ORACLE=1`, not in
  CI) compares earliest arrival/transfers with api.transitous.org on the committed GTFS.
- **Transport PWA** (`Docs/transport-pwa-2026-10.md`, smoke `Docs/transport-pwa-smoke.md`; the real worker is checked only
  by hand or with `npm run pwa:smoke` in `frontend/` against a deployed site — never in CI): `/transport*` works offline and
  installs as «Як доїхати» (`public/transport.webmanifest`, scope `/transport`; the menu entry and SEO titles stay «Транспорт
  Малина»). The icon is a slice of the route scheme drawn by `npm run pwa:icons` from the scheme's colours, PNGs committed;
  a new drawing gets new `icons/` file names, because browsers and Cloudflare keep `/icons/*` for a day. The same script
  draws the site favicon `/favicon.ico` (16/32/48, next to the SVG) and the link-preview cards `public/og/*.png` (1200×630,
  texts and file names in `scripts/og-images.mjs`, Golos Text from Google Fonts): `index.html` carries the site card,
  `/transport*` pages get the transport card (`usePageSeo` → prerender-spa, `prerender-transport-stops.mjs`), and
  `seo-smoke` fails a prerendered page whose `og:image` is missing or from the wrong section. Two layers.
  Data: `useTransportDataset` serves the localStorage copy (`transport-dataset:v1`) first, refreshes from the API (same
  `revision` → same object), and falls back to the build snapshot `dist/transport/dataset.json` written by
  `prerender-transport-stops.mjs`; `TransportStatusBar` tells the user («Без мережі…» / «Сервер не відповідає…»). Shell:
  `sw/transport-sw.js` is a template, `scripts/build-sw.mjs` (after the prerenders) fills the precache list and `BUILD_ID`
  (`scripts/precache.mjs`, hash of the list + content of non-hashed files, so a data-only deploy reaches installed apps);
  cache-first shell/assets/fonts, `/transport*` navigations get `/index.html` from cache, the cross-origin API is never touched.
  Registered only in production on the primary site from `/transport*` (`src/pwa/serviceWorker.ts`); a new build installs and
  waits, `useFreshBuild` applies it via SKIP_WAITING under its usual rules or shows `UpdateBanner`. `serve-dist` sends
  `no-cache` plus `CDN-Cache-Control: no-store` for HTML, the worker, manifest and snapshots (`cacheHeadersFor`; Cloudflare
  caches `.js` by extension and held the worker at the edge for 4 h without it) and 404s the worker/manifest on the
  secondary domain.
  Never bump `BUILD_ID` by hand; never precache `/` (301) or the prerendered pages.
- **Verifiable build** (`Docs/transport-verifiable-build-2026-10.md`): `scripts/sri.mjs` runs right after `vite build` and
  before the prerenders and puts `integrity="sha384-…" crossorigin="anonymous"` on the entry script and stylesheet of
  `dist/index.html` (pure `addIntegrity()`, test `src/test/sri.test.ts`); the prerenders copy that head, the worker
  precaches the same bytes, so SRI and cache-first do not conflict. `/about#build` (`src/pwa/BuildStamp.tsx`,
  `useBuildInfo`) shows the loaded bundle hash, the active worker's `BUILD_ID` (`GET_BUILD_ID`) and the revision of the
  dataset copy in the browser, with relative links to check them (`/transport-sw.js`, page source, `/transport/revisions`);
  nothing is rendered under prerender. An installed app keeps opening `/transport*` from the precache when the domain
  itself does not answer (smoke section «Без домену»); no updates, API, map or pages outside the scope then. By the
  owner's decision there is no `Docs/fork.md` or any «run your own copy» guide: the license does not forbid forking, the
  repository is public, and that is all.
- **Offline writes** (`Docs/transport-offline-writes-2026-10.md`): the three public POSTs from the board (sticker scans,
  sticker returns, arrival reports) go through `sendOrQueue()` in `src/pwa/outbox.ts` — a localStorage queue
  (`transport-outbox:v1`, ≤ 50 items / 7 days / 10 attempts, deduplicated per `key`: sticker or trip + Kyiv day) that
  is flushed on page open, on `online`, when the tab becomes visible (`useOutboxSync` in `App.tsx`) and after a
  successful dataset fetch. Network errors and 5xx queue, 4xx drop (`isRetryableError`); the worker never sees these
  requests. Arrival reports carry `occurredAt` (time of the tap) and `clientEventId`: `POST /transport/arrival-reports`
  computes the windows from `occurredAt` (clock ahead > 5 min → server time, older than 7 days → 422) and answers a
  repeat of the same `clientId + clientEventId` with `{ counted: false }` (unique index). `TransportStatusBar` shows
  «N записів чекають на мережу» from `useOutboxPending()`; GA event `transport_outbox`.
- `src/types/index.ts` — shared TypeScript types mirroring backend response shapes; keep in sync when
  backend routes/Prisma models change.
- `src/hooks/` — shared data-fetching/state hooks (announce draft, rideshare requests, telegram
  scenarios, page SEO).
- `src/components/` — small reusable UI primitives (Button, Input, Select, Combobox, Alert, etc.) plus
  a few cross-page pieces (TelegramLoginButton, ProtectedRoute for admin-only routes, legal/cookie
  footers). The public footer (`PublicLegalFooter collapsible`, every public page) shows only «Розробник — ТОВ
  «Технології».» and «Більше»; the links and the owner line stay in the HTML under the fold. Once open it folds back on
  the button / Esc, on typing in a field outside it and on navigation — never on a plain click elsewhere (the page
  would jump under the pointer). Pages that fill the screen (`/transport*` on a computer) size themselves to
  `100dvh − --app-nav-height`, so the footer starts right under them (an e2e test guards the old grey strip).
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
  and query (`?homeCity=<code>` carries the choice; cookies do not cross domains) — `buildCitySwitchUrl`
  + `useHomeCityHandoff`. A secondary domain pins its own home city.
- `/admin`, `/login`, `/user` exist only on the primary domain: 301 in `serve-dist.mjs` for the first
  hit, `DomainGuard` for SPA navigation (the Telegram Login widget is bound to one bot domain).
- korosten.kiev.ua is `noindex` for now (`X-Robots-Tag`, synthetic `robots.txt`, 404 sitemap in
  `serve-dist.mjs`); all canonicals keep pointing at malin.kiev.ua.
- `/transport*` of a secondary domain is its own static tree `dist/sites/<key>/` (`PRERENDER_SITE=<key>` for
  `prerender-transport-stops` + `prerender-spa`, `SEO_SMOKE_SITE=<key>` for `seo-smoke`; canonicals there are the city's
  domain, as in the SPA). The tree is built only when the city's public dataset answers (`hasLocalTransport` on) — flip
  the flag, then redeploy the frontend. The Railway frontend service has `NO_CACHE=1`: without it a redeploy with
  unchanged frontend files takes `npm run build` from the layer cache, so prerendered pages ignore new API data (flags,
  datasets). Korosten went live this way on 2026-11-17. `serve-dist` never serves Malyn's HTML or data snapshots from the root
  `dist/transport` on another host (shell instead; poster files are fine), takes 410 / stop-301 data from the site's
  tree, and adds `city=` to the API 302s (pure rules in `serve-dist-rules.mjs`). Stop articles are per city: Korosten's
  `src/content/stops/korosten-articles.json` is generated from the council stop list by `scripts/city-stop-articles.mjs`
  (street only — no coordinates, routes come from the dataset; a test keeps it equal to the generator).
  Files every site has its own copy of (`SITE_OWN_FILES`: `/llms.txt`) live in `public/sites/<key>/` and are served from
  the site's tree on its domain, 404 when missing — never Malyn's. A direct request for `/sites/…` is 404 on every domain.
  The link-preview card of `/transport*` is per site too: `ogImageForPath(path, siteKey)` / `ogImageForUrl(canonical)` in
  `og-images.mjs` (`transportKorosten`, lines in the Korosten legend colours; draw one card with
  `npm run pwa:icons -- --og <key>`).
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
  A number on a line colour is never hard-coded white: it takes `fg` from the scheme legend (`--lt-route-fg`,
  `--lts-r<id>-fg`) or `textColorOn()` (`routeColors.ts`) — white or black, whichever contrasts more (≥ 4.5:1).
- Route lines on the map are straight lines between consecutive chain points; technical points (`mapOnly`
  route stops named «№<id> т.N») bend them along the roads (`Docs/route-geometry-5-2-2026-10.md`,
  `Docs/route-geometry-10-11-2026-10.md`, `Docs/route-geometry-8-2026-10.md`, `Docs/route-geometry-7-2026-10.md`,
  `Docs/route-geometry-12-2026-10.md`, `Docs/route-geometry-3-2026-10.md`, `Docs/route-geometry-9-2026-10.md`;
  generator `build_routes()` in
  `data/malyn-transport/route-geometry-2026-10/scripts/build_more.py`; points within 10 m are shared between routes).
  Korosten's lines are generated for the whole city at once (`Docs/korosten-route-geometry-2026-11.md`,
  `data/korosten-transport/route-geometry-2026-11/scripts/`: `build.py` — OSRM path per span, chosen by the buses' GPS
  points, also against an OSM one-way; `verify.py`; `apply.py`). Technical points do not
  change trip times: `recalculate-segments` times each span between real stops (stop pause, speed, 30 s minimum)
  and splits it by length across the hops (`chainSegmentSeconds` in `backend/src/transport-segments.ts`).
- Per-trip `startStopId` / `endStopId` / `arrivalTime` (short-turn trips, fixed arrival that
  compresses that trip's segment durations) are computed on the fly by one pure helper kept
  byte-identical in `frontend/src/pages/LocalTransportPage/dataset/tripTiming.ts` and
  `backend/src/trip-timing.ts` (a frontend test diffs them). Public pages go through
  `recordTiming()` in `routeTiming.ts`, the admin grid through `computeTripTimes()`, GTFS through
  `backend/src/gtfs-stop-times.ts`. Headsign is display-only; the served stop range comes from
  start/end. A trip is never a "departure" at its own end stop on the stop board.
- **Route variants and timepoints** (`Docs/route-variants-2026-10.md`; first user — №9's first trip via the station).
  A route may carry named path variants (`TransportRoute.variants` JSON: `{ id, directionId, name, stops: [{ stopId,
  mapOnly? }] }`); a trip on one sets `variantId` and runs that chain instead of its direction's main chain (no stop
  twice in a chain — a loop is two trips linked by `blockId`). Segments stay shared per route. Every consumer picks the
  trip's chain through one helper: `chainForRecord()` / `servedStopIds()` / `chainsServingPair()` in
  `LocalTransportPage/routeVariants.ts` on the site, `resolveTripChain()` in `gtfs-stop-times.ts`, `segmentChains()` in
  `transport-segments.ts`; the scheme, board chips, static stop pages and the autostation page count variant stops too,
  stickers do not. `name` is the path in lower case («через вокзал») — the site prints «іншим шляхом: …». A `PUT` route
  without the `variants` key keeps the stored ones (`fillOmittedRouteFields`), `[]` clears them. `TransportTrip.timepoints`
  (`[{ stopId, time }]`, sheet times at later stops) stretch or squeeze the segments between anchors, after the last one
  segments run as is; never together with `arrivalTime`. Edit both in `/admin/route-schedule` («Шлях», «Опорні часи»,
  JSON «Варіанти шляху»); the map editor only lists variants.
- **Lost-update guard:** `GET /transport/dataset` returns `revision` (`TransportMeta.updatedAt`, bumped by every PUT and
  by «Перерахувати час»); the admin editors load it with `getTransportDataset({ fresh: true })` and pass it to
  `putTransportDataset(dataset, baseRevision)` → 409 if the data changed meanwhile. Scripts that PUT without
  `baseRevision` are not checked — close or reload admin tabs before a scripted write.
- **Open data** (`Docs/transport-open-data-2026-10.md`): `GET /transport/gtfs.zip` and `GET /transport/gtfs/<file>.txt`
  serve the GTFS Static feed built by `backend/src/gtfs-feed.ts` (`buildGtfsFeed` — the same generator as
  `npm run export:gtfs`, which is now a thin wrapper; `backend/src/zip.ts` writes the archive, no system `zip`).
  `feed_version` = dataset `revision`; the router caches the feed in memory per revision
  (`createGtfsFeedProvider`) and answers with `Cache-Control: public, max-age=300`, `ETag: "<revision>"` and
  `Last-Modified`. `unreliable` routes are omitted; the data license (`OPEN_DATA_LICENSE`, OwnNet Source License 1.1 — the owner's decision, same as the code; it was CC BY 4.0 until the owner
  decides otherwise) ships as `LICENSE.txt` inside the zip and is mirrored in `frontend/.../LocalTransportPage/openData.ts`.
- **Open protocols** (`Docs/transport-open-protocols-2026-10.md`): canonical addresses live on the site domain and
  `serve-dist.mjs` answers 302 to `API_BASE` (`apiRedirectPath` in `serve-dist-rules.mjs`: `/transport/gtfs.zip`,
  `/transport/gtfs/<file>.txt`, `/openapi.yaml`, `/transport/changes.rss`, `/transport/route/<id>/calendar.ics`, and the
  dot-less JSON endpoints `/transport/dataset`, `/transport/revisions`, `/transport/stops/<id>`, `/transport/stop-redirects`,
  which `isTransportApiPath` in `sw/transport-sw.js` excludes from the worker's page rule — keep the two lists in sync;
  `vite.config.ts` proxies the same paths in dev). Every link people see — docs, `llms.txt`, the site's buttons
  (`LocalTransportPage/openData.ts`, relative paths) — uses the site domain, never the backend host; only the OpenAPI
  `servers` entry, `scripts/api-base.mjs`, deploy docs and internal scripts name the Railway URL. The
  catalog files for Mobility Database / Transitland are in `Docs/open-protocols/` (the owner submits them). The public
  API is described in `backend/openapi/public.yaml` (served at `GET /openapi.yaml`, page `/support/api`); `openapi.test.ts`
  checks every yaml path against `getRegisteredRoutes` and every endpoint of its `PUBLIC_ENDPOINTS` list against the yaml —
  a new public endpoint goes into both. Stable-id contract (`Docs/transport-open-data.md`, «Що ми обіцяємо»): merged or
  removed stops are listed in `TransportMeta.payload.stopRedirects` (`backend/src/stop-redirects.ts`, mirrored in
  `LocalTransportPage/stopRedirects.ts` and `prerender-transport-stops.mjs`), written only through
  `PUT /admin/transport/stop-redirects` (a PUT of the dataset keeps whatever `meta` the editor loaded); `GET /transport/stops/:id`
  answers 301 for an old id, the board navigates to the live stop, serve-dist 301s from `dist/transport/stop-redirects.json`.
  `GET /transport/changes.rss` and `GET /transport/route/:id/calendar.ics` (`backend/src/transport-feeds.ts`) are built from
  the cached GTFS feed (`GtfsFeed.routes` / `.trips`).
- **Revision journal** (`Docs/transport-revisions-2026-10.md`): `TransportRevision(revision = ISO TransportMeta.updatedAt,
  source, stats, diff)` gets a row after every write that bumps the revision — `PUT /transport/dataset`,
  `POST /admin/transport/recalculate-segments`, `PUT /admin/transport/stop-redirects`, the seed script — via
  `snapshotTransportDataset()` **before** the write and `recordTransportRevision()` after it (`backend/src/transport-revisions.ts`;
  `diffTransportDatasets` is pure: stops added / renamed / removed, routes added / removed, trips added / removed / moved by
  `trip_id` + departure time, changed segment count, stop redirects). The journal never blocks the write (errors only
  logged); `index.ts` writes the first row from the current state when the table is empty. `GET /transport/revisions`
  (JSON, `?limit=`, newest first) and `GET /transport/changes.rss` (one item per row, Ukrainian `summary`, falls back to one
  feed-only item while the table is empty) read it; the RSS body is cached per revision. A new write path must call both
  helpers.
- **Korosten city transport** is being added in phases — master plan and recovery file
  `Docs/korosten-transport-2026-11.md` (read it first; its «Готовність до ввімкнення» table says what the Korosten
  `hasLocalTransport` checkbox would show today). Sources and their licences: `data/korosten-transport/SOURCES.md`.
  Source watch (phase 1): `WATCHED_SOURCES` in `backend/src/transport-source-watch.ts` — one GET per source per tick,
  fingerprint = content (table text / file dates), first run is a baseline, one admin-chat alert per change
  (conditional `updateMany` on the old fingerprint), a page without tables is a failure, not a change. Admin block on
  `/admin/route-schedule` (`SourceWatchPanel`), endpoints `/admin/transport/sources*`. The council page is parsed by
  the pure `backend/src/korosten-source-parser.ts` (routes, runs per «Графік», breaks, `*` footnote read from its
  text, italics = other path), so alerts list the changed runs; the committed source snapshot and `timetable.json`
  live in `data/korosten-transport/source/` (`npm run korosten:snapshot` in `backend/`, a test keeps the two in step).
  Never change how `snapshotHtmlTables` hashes a table — a new fingerprint would alert on every source at deploy.
  Stop order and minutes between stops come from the owner's 2025 project (`data/korosten-transport/project-2025/`:
  16 HTML pages → `chains.json` via `korosten-project-parser.ts`); names are mapped to the council's `z-0NN` stops by
  `stop-aliases.json` (`korosten-stop-aliases.ts`, manual hints in `stop-aliases.hints.json`), and `REPORT.md` compares
  the project with the council timetable. All three are generated by `npm run korosten:snapshot -- --project` and a
  test fails when they drift — edit the hints or the HTML, never the generated files.
  Phase 8 (`Docs/korosten-transport-data-2026-11.md`): `npm run korosten:dataset` (backend) builds the draft Korosten dataset
  `data/korosten-transport/dataset/korosten-dataset.json` + `REPORT.md` from those files, the OSM / Nominatim snapshots in
  `osm/` (`--fetch-osm`) and the manual decisions in `dataset-config.json` (№2-Б, path variants, colours, OSM hints); a test
  keeps the committed draft equal to the generator. `--apply` writes it with `?city=Korosten` + `baseRevision` (backup,
  verify after PUT); the map editor has «Імпорт датасету з файлу…» for a non-default city. Google is a checker only
  (`place_id` + distance, never Google coordinates in git; the owner's temporary Google points live only in gitignored
  `*.local.json`). `--google-hops` checks every A → B → C triple of every chain with Routes TRANSIT (`korosten-google.ts`;
  committed `google/hops.json` keeps verdicts + a hash of our coordinates, no Google geometry; resumable across the daily quota). The draft replaces the city's whole dataset — after manual edits the DB
  is the source. On the site, `VERIFIED_ROUTE_IDS` is a Malyn list: `isVerifiedRoute` / `verifiedRouteIds()` treat every route
  of another city as verified (`setVerifiedRoutesCity`, switched by `useTransportDataset`), and the map centre comes from the
  city's profile.
- **Zhytomyr city transport** (`Docs/zhytomyr-transport-2026-11.md`, recovery file): third transport city. Buses from the
  owner's zt.rozklad.in.ua (`data/zhytomyr-transport/`, same minutes as «Доведе» via `zhytomyrTimedDirections`), tram and
  trolleybuses from the hand-taken EasyWay snapshot in `data/zhytomyr-transport/easyway/` (no coordinates there: stops are
  matched by name to our bus stops / OSM, minutes between stops estimated). `npm run zhytomyr:dataset` (backend) builds
  `dataset/zhytomyr-dataset.json` + `REPORT.md`; a test keeps them equal to the generator; `--apply` / `--dry-run` as
  Korosten. A city is a transport tenant by `transport: true` in both site maps (`site-domains.ts`, `site-hosts.mjs`),
  independent of `active` (domain served): `parseTransportCity`, `canonicalTransportCity` and the admin city switcher use
  `transport`, while `siteForCityCode` / notifications still use `active`.
- **Transport tenancy** (`Docs/transport-tenancy-2026-11.md`): the 11 city-transport tables carry `cityCode`
  (`TripPoint.code`, default `'Malyn'`). Every Prisma call on them is scoped by it — the DB functions take
  `cityCode = DEFAULT_TRANSPORT_CITY` / `opts.cityCode`, and `transport-tenancy.test.ts` fails on an unscoped call (add
  a new endpoint to its «кожен запит… несе cityCode» test). The router takes an optional `?city=` (body `city` on the
  three public POSTs) through `parseTransportCity` / `resolveTransportCity` (`backend/src/transport-city.ts`): no
  parameter = Malyn, byte-identical (`transport-golden.test.ts` pins sha256 of its responses — never update that file
  to make a change pass); a city whose `hasLocalTransport` is off answers 404 to the public and `private, no-store` to
  the admin token. Keys are composite with the city (`@@id([cityCode, id])` on stops, routes and trips, composite FKs,
  `TransportRevision` keyed by `(cityCode, revision)`, one `TransportMeta` row per city), so two cities may share ids:
  look rows up with `cityCode_id`, and write another city's dataset with `PUT /transport/dataset?city=<code>` (admin
  only, its own `baseRevision`). Another city's open data (GTFS, RSS, revisions, calendar) still answers 404. Write
  transport tests on `transport-test-store.ts`, which honours `where` and unique keys; do not run `prisma format`.
- **Scheme per city** (`Docs/korosten-scheme-2026-11.md`): one generator `Docs/malyn-transit-scheme/build_scheme.py`; another
  city passes `--city <geometry file>` (Korosten: `Docs/korosten-transit-scheme/korosten_scheme.py`, executed in the generator's
  namespace; Malyn's output must stay byte-identical without it). The site picks a city's SVG / legend / nodes / poster from
  `LocalTransportPage/scheme/registry.ts` (`schemeFor(city)`); `schemeStops`, `schemeMini`, `routeColors` (legend colours win over
  `meta.routeColors`), the sticker model and the wall palette take the scheme of the city whose dataset is loaded
  (`currentScheme()`), pages pass `schemeFor(profile.cityCode)` explicitly. Tests that mock a legend mock the registry (the setup
  imports it first).
- **Transport city on the frontend** (`frontend/src/site/transportCity.ts`): the site's `cityCode` picks the dataset.
  The admin transport tabs (map editor, schedule, stickers, arrivals, `/admin/wall`) edit the city in `?city=<code>`
  (`useAdminTransportCity` + `TransportCityBar`; the same key as the backend's `?city=`), stickers then point at that
  city's domain. `/transport?city=<code>` is an admin-only preview of a city whose gate is still off
  (`transportPreviewCity()`: admin token in localStorage, sticky in sessionStorage, banner with «Вийти з перегляду»).
  `useTransportDataset(city = siteTransportCity())` keeps a cache and a localStorage copy per city (Malyn keeps the
  historic key `transport-dataset:v1`, others add `:<city>`; the build snapshot is Malyn-only), `apiClient` adds
  `?city=` only for a non-default city, and `routeNo()` / `routeColor()` read per-city registries switched by the
  loader. A Malyn page outside `/transport` must ask for Malyn explicitly (`useTransportDataset(DEFAULT_TRANSPORT_CITY)`).
  `transportProfile(city)` also carries the city's name in three cases (`site-hosts.mjs` `cityNameUk*`), its domain, `hasOpenData`,
  quick «Куди їдете?» chips and the footer source: every text, FAQ, JSON-LD, title and canonical on `/transport*` comes from it
  (Malyn strings stay byte-identical — the prerender must not change); a city without a scheme hides the «Схема» tab, scheme minis
  and `/transport/scheme` (→ `/transport`), and orders board lines by number, not by the Malyn legend.
  Stop articles, the scheme legend colours and legacy stop names belong to Malyn (`transportProfile`); another city's
  line colours come from `dataset.meta.routeColors`. `sendOrQueue` stamps `city` on writes from a non-default site.
- **dovede.online** (the owner's domain for «Доведе», bought 2026-11-18 at GoDaddy, DNS in Cloudflare) is not a site of
  its own yet and **not attached to Railway**: the Hobby plan allows 2 custom domains per service and the frontend service
  already has malin.kiev.ua and korosten.kiev.ua. A Cloudflare Redirect Rule answers `dovede.online` and `www.` (proxied
  dummy `A 192.0.2.1` records) with **302** → `https://malin.kiev.ua/dovede`, query kept, path dropped — nothing in this
  repository. 302, not 301, because the page will move to that domain later; until then the guests' password, the intro
  flag and the admin token stay in the primary domain's `localStorage`. Moving it means Railway Pro (or a separate
  service) and a host rule in `serve-dist` before the domain is attached — otherwise `resolveSite` would serve the whole
  Malyn site there. It is not in `site-hosts.mjs` / `site-domains.ts`.
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

- **Personal data belongs to the person** (`Docs/transport-open-data-2026-10.md`, phase 4). `/user/*` identifies the
  person only from the `X-Telegram-Login` header — the Telegram Login Widget answer as base64url JSON, verified by
  `backend/src/telegram-login-auth.ts` (HMAC-SHA256 with sha256(`TELEGRAM_BOT_TOKEN`), `auth_date` ≤ 24 h; 401 with
  `reason`, 503 when the server has no token — never a silent pass; `createApp({ telegramBotToken })` in tests). The
  frontend builds the header in `src/utils/telegramLogin.ts` from `userState.getTelegramUser()`; a 401 on `/user` means
  «log in again». A bare `telegramUserId` in query/body is never trusted: the same guard protects `DELETE /bookings/:id/by-user`,
  `PATCH /viber-listings/:id/(deactivate/)by-user` and `POST /rideshare/request` (`createApp` hands one `telegramBotToken` to
  every router; the matching `apiClient` methods send `telegramLoginHeaders()` and take no id). `GET /user/export` and the bot's `/mydata`
  share `collectPersonData()` (`person-data-export.ts`: no other person's phone, no `telegramChatId`/`accessHash`);
  `DELETE /user { confirm: true }` and `/deleteme` share `erasePerson()` (`person-erase.ts`: anonymise, never delete the
  Person row, never block the phone — unlike the admin archive in `person-archive.ts`; future bookings deleted, past ones
  anonymised, listings deactivated, referral rewards kept, Dzhura messages emptied with `deletedAt`). The technical phone of
  an erased person is `380000` + zero-padded id; `isTechnicalPlaceholderPhone` covers it. Device-only transport settings
  (`lt.frequentToStops`) are exported/restored/cleared as a file by `LocalTransportPage/transportPrefs.ts`
  (`TransportPrefsPanel` in the open-data block) — no server involved.

- **Kyiv ↔ Malyn marshrutka fare** (310 грн one way, both directions, since 4 Nov 2026; was 280, round trip 620 instead of
  560 — the carrier via ІнфоМалин). The number lives in four places, change them together: `Schedule.priceUah` in the DB
  (a data migration — touch only `vehicleType = 'marshrutka'` rows still at the old price, because elektrichka rows
  share the route names and manual prices must survive; see `20261104100000_kyiv_malyn_marshrutka_fare_310`), the default
  for new schedules `KYIV_MALYN_MARSHRUTKA_FARE_UAH` in `backend/src/schedule-price.ts`, the prose constant
  `frontend/src/utils/fares.ts` (FAQ, `/support/prices`, corridor landings, admin form default; `fares.test.ts` fails if the
  two constants differ) and the committed prerender fallback `frontend/scripts/data/corridor-schedules.snapshot.json`.
  Timetable tables and static pages read the price from the live API at build time, so **redeploy the frontend after the
  backend migration has run**. A local `npm run build` rewrites that snapshot from the live API (prices, `fetchedAt`) —
  check `git diff` before committing.
- Git commit messages must be written in English (project convention, from `.cursor/rules`).
- «Зубастик» (Kyiv ↔ Malyn marshrutkas) is **phone-only for now** (a separate integration with the carrier is in
  progress): the online flow (site modal, bot `/book`) still writes the booking and keeps the old «технічний режим»
  warnings. Warn **only at the moment of booking**: the booking modal (`BusBookingModal`, also opened from «Доведе» —
  `DovedePage/ui/BookingButton.tsx` → lazy `DovedeBooking.tsx`, a portal into `body`), bot booking steps and «Мої
  бронювання», confirmations, reminders, SMS, the admin message and `POST /bookings` (`phoneOnly` + `notice`). The home
  page, search results, «Доведе» stories, ads, SEO and AEO copy (landings, FAQ / JSON-LD, meta, `llms.txt`, promos, bot
  welcome/help) say nothing about it — back to the copy before the warnings (owner, 2026-11-19; a test keeps the
  corridor copy free of «не працює / лише за телефоном / тимчасово»). One rule, kept identical in
  `backend/src/phone-booking.ts` and `frontend/src/pages/MizhgorodskiPage/phoneOnlyBooking.ts`. Restoring online
  booking = reverting that change.
- **Zubastyk phones** are one list for the whole site, changed by the owner in the admin without a deploy («Графіки»
  tab → `AdminPage/ZubastykPhonesPanel.tsx`): table `SiteSetting` (key `zubastyk.phones`, value `{ phones }`, `{}` =
  defaults), `backend/src/zubastyk-phones.ts` (defaults, parsing «093 192 00 08», in-memory list refreshed at start, every
  5 min and on save; bot / SMS / API texts in `phone-booking.ts` are functions reading it), `GET /site/zubastyk-phones`
  (public, 5 min cache) and `GET` / `PUT /admin/site/zubastyk-phones`. Pages use `useZubastykPhones()`
  (`src/site/zubastykPhones.ts`; defaults = `ZUBASTYK_PHONES` in `zubastykContent.ts`): /zubastyk (list, FAQ, meta), the
  booking modal notice, «Доведе» contacts. The static /zubastyk is rendered with the same request at build time — after
  changing the phones, redeploy the frontend so crawlers see them.
- The Python `viberparser/` service has no automated test suite (out of CI) — see `Docs/TESTING.md`
  "Out of CI" section for what's covered by manual smoke checklists instead
  (`Docs/*-smoke.md`), e.g. `Docs/gold-route-model-smoke.md`, `Docs/poputky-od-city-scale-smoke.md`.
- Root `.env`/`backend/.env`/`frontend/.env`/`viberparser/.env` are git-ignored; use the matching
  `.env.example` files as the source of truth for required variables.
- Deploy target is Railway (see `DEPLOYMENT.md`, `RAILWAY_SETUP.md`); both `backend/` and `frontend/`
  are separate Railway services each with their own `railway.json`, deploying automatically on push to
  `main`.
