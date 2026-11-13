# «Доведе» — architecture review (2026-11-13)

Report of the architect (Plan) sub-agent on `origin/main` (cc39a4e). Verdict: the architecture «ШІ розуміє — наші
дані відповідають» holds up; four refinements were proposed (all adopted in phases 0–1 where relevant): answer from
the local parse first and call Claude only when needed, keep the anchors in the frontend only, gate the page silently
before its code is loaded, never put the question text in the URL.

## 1. Validation and risks

**(a) Reusing the planner outside `/transport` — low risk.**
- Two pages already repeat the wiring: `LocalTransportStopBoardPage.tsx:124-135` and `AvtostantsiyaPage.tsx:88`
  (`useTransportDataset(DEFAULT_TRANSPORT_CITY)`).
- Four modules keep the "current city" in module-level state: `segmentDurations.ts` (`configureSegmentDurations`),
  `routeTiming.ts` (`setVerifiedRoutesCity`), `routeNames` and `routeColors` (`set*City`). `useTransportDataset(city)`
  sets them during render; each page sets them again in its own `useMemo([dataset])`. Rule: one city's planner on
  screen at a time.
- Proposed (done in phase 1): `journey/usePlannerModel.ts(city)` → `datasetToLocalViewModel` →
  `configureSegmentDurations` → memoised routes / chains / catalog → timetable per service day. Do not refactor the
  2000-line `LocalTransportPage.tsx` in the MVP. `/dovede` always passes `DEFAULT_TRANSPORT_CITY`.
- Cost: ~3 `planDay` calls (one per anchor stop), then one window per intercity schedule.
- Edge: times stop at 24:00 → a 21:00 marshrutka arriving ~23:00 has no city bus → fall back to walking.

**(b) Does `/poputky/search` give enough to time the Malyn leg?**
- `searchPoputky` (`backend/src/poputky-search.ts:63`) returns full `Schedule` rows, already filtered to the date:
  `arrivalTime`, `durationMinutes`, `boardingPlace`, `tripNumber`, `priceUah`, `ticketPurchaseUrl`,
  `tripRoute.stops[].departureOffsetMinutes`.
- Marshrutky: arrival almost certainly null. Elektrichky: present (confirmed later on prod: 6613 → 17:11).
- Arrival order: `arrivalTime` → departure + `durationMinutes` → the anchor's typical duration, marked «≈». When
  approximate, add a backup bus. The owner can fill `arrivalTime` for marshrutky in the admin.
- Key anchors by `schedule.route` slug (`Kyiv-Malyn-Irpin` / `-Bucha`), not by free-text boarding place.
- One elektrichka can appear as several rows (6621: Борщагівка 18:51 / Святошин 18:59) — dedupe by `tripNumber`.

**(c) Unknown public path `/dovede`** — invisible by default:
- `serve-dist.mjs` serves the SPA shell (200) like any unknown path; `index.html` already has
  `<meta name="robots" content="noindex,follow">`; `prerender-spa.mjs` renders only `STATIC_ROUTES` + sitemap;
  `seo-smoke.mjs` checks only sitemap URLs; sitemap generated from the dataset.
- **Do not touch** `robots.txt` or `llms.txt` (would reveal the page).
- Add: `usePageSeo({robots:'noindex, nofollow'})`; `/dovede` in `PRIMARY_ONLY_PATHS`
  (`frontend/scripts/site-hosts.mjs`) — the admin token lives only in malin.kiev.ua's localStorage; exclude
  `/dovede` in `gaShouldTrackPath` (`page_view` sends the full URL including the query).
- Service worker scope is `/transport`, but `build-sw.mjs` precaches **everything** under `assets/` → the lazy chunk
  would be precached and named in the public `transport-sw.js`. Add an exclude prefix to `buildPrecache` + test.
- The route string sits in the main bundle either way — "secret" means unlinked and unindexed; the real protection
  is `requireAdmin` on the backend.

**(d) Lazy loading** — no `React.lazy` existed yet (first code split).
- A silent `AdminOnly` gate *outside* the lazy boundary: synchronous `apiClient.getAuthToken()`, then
  `GET /admin/check`; non-admins get `null`, the chunk is never downloaded. Not `ProtectedRoute` (it renders
  `LoginPage`, which gives the page away).
- Dynamic chunks get no SRI (`sri.mjs` covers the entry) — acceptable; note in
  `Docs/transport-verifiable-build-2026-10.md`.

**(e) `@anthropic-ai/sdk` in the backend** (phase 2)
- Backend is CommonJS (`tsconfig.json`: `module: CommonJS`, TS 5.3), Dockerfile `node:20`; the SDK ships CJS builds;
  `import Anthropic from '@anthropic-ai/sdk'` with `esModuleInterop` compiles to `require`.
- Pin a version recent enough to type `output_config.effort`, `fallbacks`, `server-side-fallback-2026-07-01` (else
  one narrow cast); commit `backend/package-lock.json` (Docker runs `npm ci`); rebuild and commit `dist/`.
- Call: `client.beta.messages.create` with `betas` and `fallbacks: 'default'`;
  `output_config: {effort:'low', format:{type:'json_schema', schema}}` (Opus 5.5 defaults to `medium`); leave out
  `thinking`; `max_tokens` ~4000; per-request `timeout` ~8000 ms, `maxRetries: 1`; `refusal` / `max_tokens` → local
  parse.
- Tests: pass the client into the router (`createAdminDovedeRouter({ prisma, understand })`); add
  `delete process.env.ANTHROPIC_API_KEY` to `backend/vitest.setup.ts`.
- Prompt caching: byte-stable system prompt (sorted gazetteer + version header); «сьогодні/зараз (Київ)» in the
  **user** turn; place ids as plain `string` validated on the server (not a 150-value enum); fixed schema.
- Rough cost: ~5K cached system tokens + 300–800 output tokens ≈ 1–2 cents per query.

**Refinement: answer from the local parse first.** If the browser parse is complete and unambiguous, compose
immediately; during the admin phase still call Claude to log and compare; if it disagrees, show a quiet «Можливо,
ви мали на увазі…». Logging both intents in `DovedeQuery` gives a free review queue.

## 2. Intercity anchors

Anchors live **only in the frontend** for the MVP (`DovedePage/data/anchors.ts`, pure data, `ANCHORS_VERSION`); make
them a shared mirrored file or an admin-editable table only once a server-side composer exists (e.g. Telegram).

```ts
interface IntercityAnchor {
  corridor: 'Kyiv-Malyn'; direction: 'to_malyn' | 'from_malyn';
  vehicle: 'marshrutka' | 'elektrichka'; routeSlugs?: string[];
  malynStops: { stopIds: string[]; label: string; ref: 'arrival'|'departure'; offsetMin: number; confirmed: boolean }[];
  typicalDurationMin?: { min: number; typical: number; max: number };
  bufferMin: { beforeBoard: number; afterAlight: number };
}
interface KyivPoint { id: string; label: string; metro?: string; latLng?: [number, number];
  boarding: string[]; nearby?: { boarding: string; hint: string; extraMin: number }[] }
```

`confirmed: false` makes the story say «зазвичай». Tests: every `stopIds` entry exists in the Malyn dataset; every
`boarding` string exists in `frontend/scripts/data/corridor-schedules.snapshot.json`.

## 3. Gazetteer

| Kind | Example id(s) |
|---|---|
| city | `city.Kyiv`, `city.Malyn` (codes match `TripPoint`) |
| kyiv_point | `kyiv.akadem`, `kyiv.sviatoshyn`, `kyiv.pas`, `kyiv.borshch` |
| malyn_place | `malyn.vokzal` → `[st_0019]`, `malyn.avtostantsiya` → `[st_0004, st_0005]`, `malyn.tsentr` (reuse `SCHEME_NODES`) |
| landmark | `lm.<slug>`, with `latLng` or `stopIds` |
| malyn_stop | raw `st_XXXX` ids |

- Curated, import-free `placesCurated.ts` (entries with aliases uk/ru/translit + declensions; `STOP_ALIASES`); stop
  names merged at runtime (frontend: dataset; backend: `prisma.transportStop.findMany({ where:{cityCode:'Malyn'},
  orderBy:{id:'asc'} })`, memoised per revision). The prompt only changes when stops change.
- Sharing follows `trip-timing.ts`: byte-identical `backend/src/dovede/places-curated.ts` and `intent.ts` (types,
  JSON schema, `validateIntent`) with a mirror test (backend `rootDir` is `src`).
- Local parser: folding (apostrophes, ё/е, і/и/ї); prepositions з/із/від/с/от → from, до/в/у/на/к → to, через → via;
  prefix match on stems ≥ 4 chars + Damerau-Levenshtein ≤ 1 for tokens ≥ 5; time/day words (зранку/утром, о 8,
  щоб бути до 9, завтра/післязавтра, у п'ятницю, 20.11); mode words («автобус» ambiguous; «до» ambiguous: destination
  or deadline).

## 4. Phased roadmap (as proposed)

- **Phase 0:** worktree branch from `origin/main`; `Docs/dovede-roadmap.md` (Ukrainian, like `dzhura-roadmap.md`)
  with «Що знає лише власник»; `eval/golden.json` 40+ cases
  `{id, text, now, expect:{from,to,when,modes,intent}, tags, scope}`; `Docs/dovede/prototype.html`.
- **Phase 1:** `App.tsx` lazy route + `AdminOnly`; `site-hosts.mjs` `/dovede` primary-only; `googleAnalytics.ts` skip;
  `precache.mjs` exclude; `journey/usePlannerModel.ts`; `DovedePage/{DovedePage.tsx,.css}`; `nlu/*`; `data/anchors.ts`;
  `compose/{intercity.ts, composeStories.ts, narrate.ts}`; `ui/*`. Reuse `BusBookingModal`, `TrainTicketModal`,
  `isPhoneOnlySchedule` («Подзвонити»). Tests: `parseLocal` ≥ 80% on MVP; gazetteer/anchors integrity;
  `composeStories` (null arrival, past last bus, reverse, both modes); non-admins render `null`. Acceptance: 10
  scenarios match `/transport`; main bundle grows ≤ ~1 KB; all tests green.
- **Phase 2:** backend `src/dovede/{places-curated, intent, gazetteer, prompt, understand, guard}.ts`,
  `routes/admin-dovede.ts`, `DovedeQuery` migration (text ≤ 300, local + LLM intents, model, latency, tokens incl.
  cache reads, error), daily cap per Kyiv day; env `DOVEDE_ENABLED`, `DOVEDE_MODEL`, `DOVEDE_DAILY_CAP`; frontend
  `apiClient.dovedeUnderstand` + local-first merge; supertest (401 / 429 / 503 with `{fallback:'local'}`, unknown id
  → `unknown`, byte-identical prompt, mirror test); manual eval `DOVEDE_EVAL=1`. Acceptance: ≥ 90% slots, p50 < 3 s,
  `cache_read_input_tokens > 0` on the second call, works without a key.
- **Phase 3:** highlighting, editable slot line, slot suggestions, one clarifying question with keys, collapsed
  alternatives with a mini time bar, «Поділитися», status line, calm errors, 18 px / 48 px, URL with ids only,
  `e2e/dovede.spec.ts`.
- **Phase 4:** `/admin/dovede` — query log, local vs Claude disagreements, «додати в golden»; anchors v2;
  `arrivalTime` for marshrutky.
- **Phase 5:** public `POST /dovede/understand` with per-IP and global caps; retention for query texts; privacy
  policy on `/about` (Anthropic as processor); GA events with ids only; entry points from `/transport` and
  `/mizhgorodski`; SEO and PWA decisions.
- **Phase 6+:** Zhytomyr and Korosten; poputky; booking from a story; follow-ups; Telegram entry point.

## 5. Owner-only facts and decisions (as listed then)

1. Where marshrutky stop inside Malyn in each direction, with minute offsets. → **answered**: PTL → Бандери → центр
   «Промінь».
2. Typical Kyiv↔Malyn travel time (Irpin vs Bucha, by time of day). → **answered**: 1 h 30, max 1 h 37, Friday
   evening up to 1 h 40.
3. Elektrichka time Київ-Пас. → Святошин / Борщагівка. → **checked** on swrailway (see `05-data-checks.md`).
4. Kyiv-side hints and Google Maps. → **answered**: short Google-style tables + Google Maps transit link.
5. Transfer buffers. → **answered**: ≥ 10 min to board the Kyiv marshrutka.
6. Model and budget. → **answered**: `claude-opus-5-5`, switchable via `DOVEDE_MODEL`.
7. Query text retention after public launch. → open (phase 5).
8. Card action while marshrutky are phone-only. → «Подзвонити».
9. Out-of-scope answers. → «Цю дорогу я ще вчу»; poputky: from Malyn centre to Kyiv, back like marshrutky.
10. Public name / URL / indexing / place in «Як доїхати». → name «Доведе», `/dovede`; rest open (phase 5).
11. Admin entry. → **answered**: bookmark only.

### Critical files

- `frontend/src/pages/LocalTransportPage/LocalTransportPage.tsx` (wiring 313-325, 430-431, 550-605)
- `frontend/src/pages/LocalTransportPage/dataset/useTransportDataset.ts`
- `backend/src/poputky-search.ts`
- `frontend/src/App.tsx`, `frontend/scripts/site-hosts.mjs`, `frontend/scripts/precache.mjs`
- `backend/src/create-app.ts`, `backend/tsconfig.json`, `backend/package.json`, `backend/prisma/schema.prisma`
