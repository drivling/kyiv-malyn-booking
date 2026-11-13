# «Доведе» — backend findings (2026-11-13)

Read-only exploration of `backend/` on `origin/main` (cc39a4e). Line numbers marked (o/m) are from
`git show origin/main:<path>`. At that time the owner's local checkout (branch `help`) was 20 commits behind
`origin/main`; the Claude code (#118, #122, #123) and the Korosten transport tenancy existed only on `origin/main`.

## 1. Claude / LLM usage

- **Python only.** Uses the `anthropic>=2.5,<3` SDK (`backend/telegram-user/requirements.txt`,
  `lunch/requirements.txt`). `backend/package.json` has no Anthropic or OpenAI package. On main, OpenAI was fully
  replaced by Claude in #118.
- **Dzhura auto-reply** — `backend/telegram-user/dzhura/autoreply.py` (o/m):
  - default model `claude-opus-5-5` (L26), overridable by `DZHURA_AUTOREPLY_MODEL` (only values starting with
    `claude-`, `model_name` L125);
  - key from `ANTHROPIC_API_KEY`, plus an optional `ANTHROPIC_WORKSPACE_ID` header via
    `lunch/ocr_menu.py: anthropic_client_headers()` L107; client built in `make_client()` L254;
  - call `generate_reply(rows, *, peer_name, owner_name, note, now, model, client)` L265 →
    `client.beta.messages.create(...)` with `max_tokens=16000`, `betas=["server-side-fallback-2026-07-01"]`,
    `fallbacks="default"`;
  - structured output `output_config={"effort":"medium","format":{"type":"json_schema","schema":REPLY_SCHEMA}}`
    (L278-297); `REPLY_SCHEMA` (L100) is `{action: reply|skip, messages[], reason}`;
  - prompt: static Ukrainian `SYSTEM_PROMPT` (L55-98) plus one user message from `build_user_text()` (L196) — chat
    transcript and Kyiv time;
  - refusal or `max_tokens` stop → "skip" (L298-301); `parse_plan` (L229) tolerates JSON in code fences.
- **Missing in both Claude callers:** no tool use, no prompt caching, no token/cost logging, no explicit timeout or
  retries (SDK defaults).
- **Safeguards and switches:** `responder.py` (o/m) — `DZHURA_AUTOREPLY_ENABLED` (L53),
  `DZHURA_AUTOREPLY_DAILY_CAP` default 40 per chat per Kyiv day (L43, L58); output only to the log and a report in
  the owner's Saved Messages. Node `dzhura.ts` (o/m): `isAutoReplyAvailable()` (L200); per-chat flags
  `autoReplyEnabled/DelaySec/Note` on `DzhuraChat`; preview through the `DzhuraJob` queue (type
  `autoreply_preview`, L496-528) — Node writes the job, the Python listener (spawned by `lunch-listener.ts:115`)
  runs it.
- **Lunch menu OCR** — `lunch/ocr_menu.py` (o/m): `ocr_menu_from_image_bytes(image_bytes, *, mime, api_key, model,
  known_names, client)` L121, same pattern with `MENU_SCHEMA` and `LUNCH_OCR_MODEL`.
- **No shared LLM helper module.** Dzhura imports `anthropic_client_headers` from `ocr_menu`.

## 2. Intercity data

**Prisma models** (`backend/prisma/schema.prisma`, o/m):
- `TripPoint` (L12): city-level only. Codes `Kyiv, Malyn, Zhytomyr, Korosten, Irpin, Bucha`, plus via points
  (Potiivka/Radomyshl). Flags `appearInPoputky`, `hasLocalTransport`.
- `TripRoute` (L42): `slug` such as `Kyiv-Malyn` or `Kyiv-Malyn-Irpin`, with corridor/variant.
- `TripRouteStop` (L67): `position`, `role`, `departureOffsetMinutes` — per TripPoint (e.g. Irpin), not per Kyiv
  street stop.
- `Schedule` (L84): `departureTime` "HH:MM", `arrivalTime?`, `durationMinutes?`, `activeWeekdays` JSON 1..7;
  `boardingPlace` / `alightingPlace` free text, one per schedule; `vehicleType` marshrutka|elektrichka, `priceUah`,
  `tripNumber`, `ticketPurchaseUrl`, `timetableSourceUrl`, `maxSeats`.
- Seeds: migrations `20260812010000` (points), `20260812040000` (corridors), `20260812060000` (offsets),
  `20260813010000` and `20260813030000` (trains), `20260902100100` (Kyiv-Zhytomyr).

**Data shape** (`frontend/scripts/data/corridor-schedules.snapshot.json`, 2026-09-11 at the time):
- Kyiv→Malyn marshrutka: 12 via Irpin boarding «м. Академмістечко», 2 via Bucha boarding «м. Святошино».
- Malyn→Kyiv marshrutka: board at «Автостанція Малин».
- Not stored: Житомирська or other in-Kyiv stops, Malyn intermediate stops (Бандери, центр — only prose in
  `zubastykContent.ts:21-30`, which also holds Akadem coordinates), travel time per stop («1.5–2 h» only in text).
- Zhytomyr→Malyn: 16 buses from Автовокзал Житомир-1, 283–299 UAH; Malyn→Zhytomyr 17, no price.
- Korosten↔Malyn: elektrichka only. Korosten↔Kyiv: no schedules.
- Fare: `schedule-price.ts:7` (o/m) `KYIV_MALYN_MARSHRUTKA_FARE_UAH = 310`.

**Shared helpers:** `schedule-trip.ts` — `isScheduleActiveOnDate` L68, `boardingTimeAtStop` L102,
`scheduleMatchesOdAlongStops` L114, `resolveArrivalTime` L130, `defaultLabelUk` L213.

**Booking:** `POST /bookings` at `routes/schedules-bookings.ts:636`, body
`{scheduleId | route+departureTime, date, seats, name, phone, telegramUserId?}`; elektrichka → 400 with
`ticketPurchaseUrl`; response includes `phoneOnly` and `notice` (L860). «Зубастик» rule
`phone-booking.ts: isPhoneOnlyBooking({route, vehicleType, source})` matches `/^(Kyiv-Malyn|Malyn-Kyiv)(-|$)/` for
non-elektrichka, non-`viber_match`; `ZUBASTYK_PHONES` and `PHONE_ONLY_*` texts in the same file; frontend mirror
`MizhgorodskiPage/phoneOnlyBooking.ts`.

**Elektrichka:**
- Data from SW Railway HTML (`swrailway.gov.ua/timetable/eltrain/...`), seeded as Schedule rows at 60 UAH.
- Kyiv side `boardingPlace` / `alightingPlace`: «Київ-Пас. (Приміський)», «Святошин», «Борщагівка»; 7 trains each
  way. Malyn side «Малин».
- Ticket link: `ticketPurchaseUrl` = `https://lnk.ua/8iLMTuFpe` (carrier-app shortlink, not UZ); Telegram flow
  `buildElektrichkaPurchaseMessage`.
- Parser `swrailway-eltrain.ts`: `stationNameMatches` L56, `parseEltrainTimetable` L109, `fetchEltrainPage` L232,
  `resolveTrainForSchedule` L260, `pickStationTimes` L289.
- Admin sync: `schedule-timetable-sync.ts` `buildTimetablePreview` L110 / `applyTimetablePreview` L286, exposed as
  `POST /schedules/timetable-preview|apply` (L342/359, admin). Only board/alight times stored.

**Poputky:** `searchPoputky(prisma, {fromCode, toCode, date})` at `poputky-search.ts:63` →
`{from, to, date, listings: PublicListing[], schedules, availability}`. City matching: exact lower-cased TripPoint
`code` (`catalog-cache.ts:152 pointByCode`) plus `routeIdsAlong` and `listingMatchesSearchOd` (`poputky-od.ts:177`).
`GET /viber-listings/search?fromCode&toCode|route&date` (`routes/viber-listings.ts:104`) returns listings only.

**Endpoints the intercity page uses:** `GET /poputky/search?from=Kyiv&to=Malyn&date=YYYY-MM-DD`
(`routes/poputky.ts:21`); `GET /trip-points[?appearInPoputky=true]`, `GET /trip-routes`, `GET /od-pairs`;
`POST /bookings`; `ZubastykPage` uses `GET /schedules?route|vehicleType|date|fromCode|toCode`
(`schedules-bookings.ts:278`).

## 3. Place-name normalization

- `viber-parser.ts`: `extractRoute(text)` L559 — regexes for Київ/Киев in all cases, plus `академ`,
  `м. Житомирська` → Kyiv, `житомир(?!ська)`, `коростен[ья]`, `буч[аіиуе]|bucha`, `ірпін|ирпен|irpin`; returns
  slugs. `extractNotes` L393 — landmarks (Академмістечко, Теремки, Шулявка, Оболонь, Почайна, вокзал, «через
  Ірпінь») into notes text.
- `inline-listings.ts: parseInlineRidesQueryPayload` (L90): Ukrainian/Russian/Latin city hints and сьогодні/завтра.
- `poputky-od.ts: DEFAULT_POINT_LABELS_UK` L225, `schedule-trip.ts: defaultLabelUk` (incl. accusative after «через»).
- Korosten: `korosten-stop-aliases.ts` (o/m) normalizes Korosten stop names (admin/offline only);
  `transport-city.ts: parseTransportCity` (o/m) maps a city code to a site.
- Malyn local stops: names and coordinates in `TransportStop` (dataset snapshot: 363 stops, 11 routes, 257 trips;
  `st_0004` «Автостанція», `st_0019` «Залізничний вокзал»).
- District/landmark text is frontend-only: ~120 stop articles `frontend/src/content/stops/st_XXXX.ts` with free-text
  `place` and `coords`. No structured alias table. `validation/` and `site-domains.ts` contain no gazetteer.

## 4. Admin endpoint pattern

- `middleware/require-admin.ts` exports `requireAdmin` and `isAdminRequest`; token = HMAC of `ADMIN_PASSWORD` in
  `Authorization`.
- Router factory `export function createXRouter(deps: { prisma }): Router` with `r.get('/admin/...', requireAdmin,
  ...)`; small template `routes/admin-notification-settings.ts`; mounted in `create-app.ts` (o/m) L114-143.
- Tests: vitest + supertest, hand-rolled Prisma stub, `createApp({ prisma, adminPassword })`, `POST /admin/login`
  for a token, assert 401 without it (`admin-notification-settings-http.test.ts`, `http-test-prisma-stub.ts`).
- Log tables to copy: `TransportArrivalReport` (o/m L1038) and `StickerScan` (L974) — append-only, `clientId`,
  `cityCode`, `createdAt` indexes, no FK; `SmsSendLog` (L763) — status, `useCase`, `errorText`, `segments`;
  `DzhuraJob` (L1193) — JSON params/result, status, timestamps. Daily cap pattern:
  `telegram-user-dm-guard.ts: createIdDmGuard` L29, `NotificationSettings.smsDailyCap`.

## 5. Related features

- Malyn journey planner (RAPTOR) is frontend-only (`LocalTransportPage/journey/`, `planDay(tt, from, to)` in
  `plan.ts:126`; walking defaults in `options.ts`: 1.2 m/s, detour 1.5, 15 min access, 400 m transfer). Backend has
  only `gtfs-stop-times.ts: buildTripStopTimes` L118 and `trip-timing.ts: computeTripTiming` L95.
- Free-text parsing exists only for ride announcements (bot `/addviber` → `parseViberMessage(s)`,
  `telegram.ts:5442/5527`); no free-text Q&A commands.
- Static content: `frontend/public/llms.txt`, `SupportPage/supportContent.ts` («travel»), `corridorLandings.ts`,
  `avtostantsiyaContent.ts`, `zubastykContent.ts` (some stale: says 280 UAH, fare on main is 310).
- Dzhura's prompt has no schedule knowledge.

## Gaps

- **Kyiv:** no local transport and no Kyiv street stops; marshrutka boarding is one text label per schedule.
- **Timing:** no per-stop offsets or arrival times for marshrutka inside Kyiv or Malyn; Malyn drop-off points not
  structured.
- **Geocoding:** none at runtime (`scripts/geocode_stops.py` runs Nominatim offline); no district→stop gazetteer.
- **Planning on the server:** planner only in the frontend.
- **Missing intercity data:** no Korosten↔Kyiv schedules, no Malyn→Zhytomyr prices, no live UZ data or delays.
- **No Node LLM client:** backend has no Anthropic SDK, no shared LLM helper or usage logging.
