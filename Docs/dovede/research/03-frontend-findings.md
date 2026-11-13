# «Доведе» — frontend findings (2026-11-13)

Read-only exploration of `frontend/` on `origin/main` (cc39a4e). `journey/`, stop articles and the Combobox are the
same on both the owner's `help` branch and `origin/main`; the admin-only Korosten preview exists only on `origin/main`.

## 1. How the Korosten "admin-only" preview works (phase 6, #126)

- **Route:** no separate route. The public `/transport*` pages (`App.tsx:85-104`, each wrapped in
  `<LocalTransportGate>`) open an unpublished city when the URL has `?city=Korosten`. Admin entry link:
  `TransportCityBar.tsx:30` → `/transport?city=<code>`.
- **The check:** `frontend/src/site/transportCity.ts`
  - `hasAdminToken()` (37-43) only checks that `localStorage.adminToken` exists (no server call);
  - `transportPreviewCity()` (59-65) returns null without `window`, during prerender, or without the token;
    otherwise reads `?city=`, falling back to `sessionStorage['transport-preview-city']` (sticks for that tab);
  - `rememberTransportPreview()` (68-79), `exitTransportPreview()` (81-87), `siteTransportCity()` (93-95), used by
    every dataset hook.
- **The gate:** `site/LocalTransportGate.tsx:13-41` renders `<TransportPreviewBanner/>` («…ще не опубліковано,
  бачите лише ви» + exit button, `TransportPreviewBanner.tsx:9-25`) then the page; otherwise the normal
  `hasLocalTransport` flag.
- **Non-admin:** `?city=` ignored → normal page or `LocalTransportSoon` («Скоро», `noindex, follow`). Real protection
  on the backend: public GETs for an unpublished city return 404 without the admin token
  (`Docs/korosten-transport-2026-11.md:68, 442`).
- **Other gates:** `ProtectedRoute` (`components/ProtectedRoute/ProtectedRoute.tsx:9-55`) calls
  `apiClient.checkAdminAuth()` → `GET /admin/check`; on failure clears the token and renders `<LoginPage/>`.
  `DomainGuard` only redirects primary-only paths (`PRIMARY_ONLY_PATHS = ['/admin','/login','/user']`,
  `scripts/site-hosts.mjs`) to malin.kiev.ua; no auth. Two storage keys for the admin session:
  `localStorage.adminToken` (apiClient, transportCity) and `user_state`/`admin_token` (`userState.isAdmin()`,
  NavBar; `utils/userState.ts:60`).

## 2. Journey planner (`LocalTransportPage/journey/`)

- **Exports** (`index.ts`): `buildTimetable(input: BuildTimetableInput): Timetable` (`buildTimetable.ts:59`;
  input `{routes, stopsByRoute, variantsByRoute, coords: Record<id,[lat,lng]>, serviceDay: 'weekday'|'weekend',
  options?}`); `serviceDayForDate(date)` (21) and `tripRunsOn(serviceId, day)` (27) — calendar knows only
  `weekdays` and `everyday`, no holidays; `planDay(tt, from: Endpoint, to: Endpoint): DayPlan` (`plan.ts:126`) →
  `{journeys, directWalk}`, the Pareto set for the whole day; `journeyWindow(journeys, {mode:'depart'|'arrive', mins,
  before?, after?})` (168); `legAlternatives(tt, leg, count=3)` (188); `offsetsFor(tt, ep)` (37);
  `DEFAULT_JOURNEY_OPTIONS` (`options.ts:31`): walk 1.2 m/s, detour 1.5, transfer walks ≤ 400 m, access walks
  ≤ 15 min, ≤ 40 access stops, ≤ 2 transfers, direct walk offered if ≤ 20 min.
- **Types** (`types.ts`): `Endpoint = {kind:'stop',stopId} | {kind:'point',lat,lng}`;
  `WalkLeg{from,to: Place, depMins, arrMins, meters}`; `TransitLeg{routeId, tripId, direction:'there'|'back',
  variantId, boardStopId, alightStopId, depMins, arrMins, stopIds, stopTimes, patternIndex, tripIndex, boardPos,
  alightPos}`; `Journey{legs, departMins, arriveMins, transfers, walkMeters, waitMins}`. Times are minutes after
  midnight.
- **Wiring** (inline in `LocalTransportPage.tsx`): `useTransportDataset()` (313) → `datasetToLocalViewModel` +
  `configureSegmentDurations` synchronously in `useMemo` (317-324) → `buildRoutesFromData` and `routeChainSources`
  (430-431) → `buildTimetable` (566-570) → `planDay(endpointFromKey(...))` (572-577) → `journeyWindow` (585-613).
- **Rules:** `buildTimetable` only works after `configureSegmentDurations()` (module-level state);
  `useTransportDataset` also sets route names, colours and verified-route state per city.
- **Endpoint strings** (`endpointKey.ts`): `me:lat,lng` («Моє місцезнаходження»), `pt:lat,lng` («Точка на карті»);
  `endpointFromKey(key)`; `endpointGaValue` sends only `geo`/`point` to GA.
- **URLs** (`buildPlannerUrl`, `LocalTransportPage.tsx:95`): planner `/transport/:from/:to?d=DD.MM.YY&h=HH:MM[&a=1]`
  (also `/transport?from=&to=&d=&h=`; dates in `dateUrl.ts`); route page
  `/transport/route/:routeId?d=&h=&stop=<board>&to=<alight>&dir=there|back` (1195-1218); stop board
  `/transport/stop/:id?d=&h=`.
- **Walking from any point:** `offsetsFor` takes stops within 15 min (haversine × 1.5, no street network, no
  geocoder), up to 40.
- **Programmatic use:** yes — pure TypeScript; tomorrow works by passing tomorrow's date; nothing past 24:00.

## 3. Stop data

- Dataset: `TransportStopDto{id,name,lat,lng}` (`api/transportDataset.ts:5`); catalog `Record<id,{name}>`
  (`stopCatalog.ts:8`). No aliases or districts.
- Stop articles (`src/content/stops/types.ts`): `StopArticle{id, name, lead?, place?, routeIds?, coords?, tips?}`;
  landmarks only as free prose in `place`; 119 Malyn-only articles.
- Closest thing to landmarks: `SCHEME_NODES` (`scheme/malyn-scheme-nodes.ts`) — hubs/terminals/waypoints mapping to
  stop ids, e.g. «Лікарня · Поліклініка» → st_0035/0036/0072; «Центр · Базарна площа» → st_0070/0056/0049/0044;
  «Залізничний вокзал» → st_0019; «Автостанція» → st_0004/0005; «Царське село» → st_0090; «Малинівка», «Юрівка».
  Also `legacyStopNames` (`transportCity.ts:166`), Korosten `CITY_QUICK_NODES` (183-192), `STOP_RELATED_PAGES`
  (`scripts/stop-related-pages.mjs`).
- Missing: «Юність», the market (only the stop «Кооперативний ринок»), microdistricts.
- Search: `Combobox` default filter is a case-insensitive substring match (`components/Combobox/Combobox.tsx:33-34`);
  no fuzzy, translit, Russian names or aliases. `resolveStopIdInList` (`stopCatalog.ts:54`) accepts exact ids only.

## 4. Intercity UI (`MizhgorodskiPage/`)

- One call: `apiClient.searchPoputky({from,to,date})` → `GET /poputky/search` →
  `PoputkySearchResponse{listings, schedules, availability}` (`MizhgorodskiPage.tsx:248`).
- `ResultItem` covers carpool, bus, train (84-86), built at 451 using `isMarshrutka`, `isElektrichka`,
  `isScheduleActiveOnDate`, `boardingTimeAtStop` from `mizhUtils.ts`. Cards are inline JSX.
- Schedule fields: `departureTime`, `arrivalTime?`, `durationMinutes?`, `boardingPlace?`, `alightingPlace?`,
  `ticketPurchaseUrl?`, `vehicleType`, `activeWeekdays`. Boarding/alighting places are free text, not linked to
  city stop ids.
- Booking: `<BusBookingModal schedule date fromCity toCity initialAvailability onClose>` (1311) → `createBooking`.
- Train tickets: `<TrainTicketModal schedule onClose>` (1325) → «Купити квиток» link to `ticketPurchaseUrl`.
- Phone-only: `isPhoneOnlySchedule()` (`phoneOnlyBooking.ts:15`), matches `^(Kyiv-Malyn|Malyn-Kyiv)` routes but never
  trains; 📞 `zubastykTelHref()` + `<PhoneOnlyNotice/>`; mirrors `backend/src/phone-booking.ts`.
- CSS: `.mizh-card*` (tokens scoped to `.mizh-page`, font Outfit); `.lt-journey*` in `journey/JourneyResults.css`
  (needs `--lt-*` tokens on `.lt-page`, font Golos Text, `LocalTransportPage.css:6-40`); global `--pb-*` tokens in
  `index.css`. No dark mode anywhere.

## 5. Plumbing for a new page

- Routes (`App.tsx`): `/admin/:tab?` behind `ProtectedRoute`; `/admin/wall` is a standalone admin route without the
  NavBar. Under `/admin*`: no cookie notice, GA ignores the path (`gaShouldTrackPath`), fresh-build reload skipped
  (`freshBuild.ts:65`), robots disallow, other domains redirect to primary.
- NavBar links are hard-coded (`NavBar.tsx:73-84`) — an unlisted page stays out of the menu.
- Prerender/sitemap: only `STATIC_ROUTES` (`scripts/prerender-spa.mjs:29`) or sitemap entries; `public/sitemap.xml`
  is maintained by hand plus route/stop URLs from `prerender-transport-stops.mjs`. A new path is excluded by default.
- SEO: `usePageSeo({title, canonicalUrl, robots:'noindex, nofollow'})`.
- API: `apiClient.request()` sends `Authorization: <raw token>` when `adminToken` is set (`api/client.ts:91-139`).
- GA4: `gaTrackEvent(name, params)`, snake_case `transport_*` names, ids/categories only; each new event goes into
  `Docs/transport-analytics.md` with a test; no-op on `/admin*`.

## Gaps

- No natural-language parsing or geocoding in the frontend; the only LLM is backend `dzhura.ts` (`ANTHROPIC_API_KEY`).
- No landmark/district/alias list; scheme nodes are the closest seed.
- Intercity arrival places are free text, not tied to city stops (needs a mapping like autostation → st_0004/0005,
  railway station → st_0019).
- Transit timing: no holidays, nothing past midnight, walking is straight-line × 1.5.
- Planner logic is inline in a ~2000-line page; a reusable hook must keep the order dataset →
  `configureSegmentDurations` → timetable.
- The Korosten approach (`adminToken` present + URL parameter) hides a page visually but proves nothing; real
  protection is `ProtectedRoute` or backend endpoints that require the admin token.
