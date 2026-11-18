/**
 * Звірка нашого планувальника міста з Google Routes (TRANSIT): ті самі зупинки й час — хто з нас помиляється.
 * Перший споживач — Коростень (Docs/korosten-transport-2026-11.md, «Звірка планувальника з Google»). Не входить у CI й
 * pre-commit (мережа, платний ключ): запускати вручну —
 *
 *   GOOGLE_ORACLE=1 GOOGLE_ORACLE_KEY_FILE=<файл із ключем> NODE_USE_ENV_PROXY=1 \
 *     npx vitest run src/pages/LocalTransportPage/journey/google.oracle.test.ts
 *
 * Змінні: ORACLE_CITY (Korosten), ORACLE_API (прод-бекенд), ORACLE_PAIRS (120 випадкових пар), ORACLE_SEED (1),
 * ORACLE_MAX_REQUESTS (1200 — стеля нових запитів до Google за прогін), ORACLE_TOLERANCE (5 хв).
 *
 * Що робить:
 *  - бере датасет міста з API і будує той самий розклад дня, що сайт (`buildTimetable`, сегменти міста);
 *  - пари зупинок: кінцеві й середина кожного ланцюжка маршруту + випадкові пари далі 800 м одна від одної;
 *    час — четвер 07:13 / 12:37 / 17:22 і субота 10:07 (за Києвом);
 *  - для кожного запиту — найраніше прибуття в нас (рейси з відправленням не раніше за час, або пішки) і в Google
 *    (найкращий з альтернатив, від координат наших зупинок);
 *  - кожен рейс Google (лінія, зупинка посадки, час) звіряє з нашими відправленнями того самого номера на найближчій
 *    нашій зупинці (до 200 м): так видно, чий розклад інший, а не лише «хтось швидший».
 * Ключ іде в параметрі `key` (не в заголовку: проксі середовища підставляє в заголовок свій). Відповіді Google
 * лежать лише локально (`planner-check.local.json`, `planner-check.results.local.json`, у .gitignore); у репозиторій —
 * звіт `planner-check.md` без координат Google.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { server } from '@/test/msw/server';
import type { TransportDataset } from '@/api/transportDataset';
import { datasetToLocalViewModel } from '../dataset/datasetAdapter';
import { configureSegmentDurations } from '../segmentDurations';
import { buildRoutesFromData } from '../stopDepartures';
import { routeChainSources } from '../routeVariants';
import { setVerifiedRoutesCity } from '../routeTiming';
import { haversineDistance } from '../geo';
import { buildTimetable, type ServiceDay } from './buildTimetable';
import { planDay } from './plan';
import type { Timetable } from './types';

const ENABLED = process.env.GOOGLE_ORACLE === '1';
const CITY = process.env.ORACLE_CITY ?? 'Korosten';
const API = process.env.ORACLE_API ?? 'https://kyiv-malyn-booking-production.up.railway.app';
const PAIRS = Number(process.env.ORACLE_PAIRS ?? 120);
const SEED = Number(process.env.ORACLE_SEED ?? 1);
const MAX_REQUESTS = Number(process.env.ORACLE_MAX_REQUESTS ?? 1200);
const TOLERANCE = Number(process.env.ORACLE_TOLERANCE ?? 5);
const OUT_DIR = path.resolve(process.cwd(), `../data/${CITY.toLowerCase()}-transport/google`);
const CACHE_FILE = path.join(OUT_DIR, 'planner-check.local.json');
const REPORT_FILE = path.join(OUT_DIR, 'planner-check.md');
/** Повні результати по запитах — лише локально (великі; у .gitignore), у репозиторій іде звіт */
const JSON_FILE = path.join(OUT_DIR, 'planner-check.results.local.json');
/** Листопад — Київ на зимовому часі, UTC+2 */
const KYIV_UTC_OFFSET_H = 2;
const DAYS: Array<{ date: string; label: string; serviceDay: ServiceDay; times: string[] }> = [
  { date: '2026-11-19', label: 'четвер', serviceDay: 'weekday', times: ['07:13', '12:37', '17:22'] },
  { date: '2026-11-21', label: 'субота', serviceDay: 'weekend', times: ['10:07'] },
];
/** Рейс Google і наш — та сама зупинка, якщо наша найближча не далі */
const STOP_MATCH_M = 200;
/** Відправлення лінії збігається з нашим, якщо різниця не більша */
const DEPARTURE_MATCH_MIN = 2;

// ─── Розклад нашого міста ─────────────────────────────────────────────────────────────────────

interface CityModel {
  dataset: TransportDataset;
  timetables: Map<ServiceDay, Timetable>;
  names: Map<string, string>;
  routeNo: Map<string, string>;
}

function buildModel(dataset: TransportDataset): CityModel {
  const vm = datasetToLocalViewModel(dataset, CITY);
  configureSegmentDurations(vm.segmentDurations, vm.defaultSec);
  // як на сайті цього міста: у Малина неперевірені маршрути йдуть плоскими 2 хв на крок, в іншого міста — сегменти
  setVerifiedRoutesCity(CITY);
  const data = vm.data!;
  const routes = buildRoutesFromData(data);
  const { stopsByRoute, variantsByRoute } = routeChainSources(data);
  const coords = vm.coords.stops ?? null;
  const timetables = new Map<ServiceDay, Timetable>();
  for (const day of ['weekday', 'weekend'] as const) timetables.set(day, buildTimetable({ routes, stopsByRoute, variantsByRoute, coords, serviceDay: day }));
  return {
    dataset,
    timetables,
    names: new Map(dataset.stops.map((s) => [s.id, s.name])),
    routeNo: new Map(dataset.routes.map((r) => [r.id, (r.shortName ?? '').trim() || r.id])),
  };
}

/** «2-Б», «2Б», «2b» — один номер */
export function sameLineNo(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-–.№]/g, '')
    .replace(/b/g, 'б')
    .replace(/a/g, 'а');
}

// ─── Пари зупинок ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pair {
  from: string;
  to: string;
  why: 'route' | 'random';
}

function pickPairs(model: CityModel): Pair[] {
  const tt = model.timetables.get('weekday')!;
  const out = new Map<string, Pair>();
  const add = (from: string, to: string, why: Pair['why']) => {
    if (from !== to && !out.has(`${from}>${to}`)) out.set(`${from}>${to}`, { from, to, why });
  };
  // кожен ланцюжок маршруту: від кінцевої до кінцевої й до середини
  for (const p of tt.patterns) {
    const ids = p.stops.map((i) => tt.stops[i].id);
    if (ids.length < 3) continue;
    const mid = ids[Math.floor(ids.length / 2)];
    add(ids[0], ids[ids.length - 1], 'route');
    add(ids[0], mid, 'route');
    add(mid, ids[ids.length - 1], 'route');
  }
  const located = tt.stops.filter((s) => s.lat != null && s.lng != null);
  const rnd = mulberry32(SEED);
  let guard = 0;
  let added = 0;
  while (added < PAIRS && guard++ < PAIRS * 50) {
    const a = located[Math.floor(rnd() * located.length)];
    const b = located[Math.floor(rnd() * located.length)];
    if (a.id === b.id || haversineDistance(a.lat!, a.lng!, b.lat!, b.lng!) < 800) continue;
    const before = out.size;
    add(a.id, b.id, 'random');
    if (out.size > before) added++;
  }
  return [...out.values()];
}

// ─── Наша відповідь ───────────────────────────────────────────────────────────────────────────

interface Answer {
  /** хв від півночі; null — нема як */
  arrive: number | null;
  lines: string[];
  /** перша посадка: «№2 о 07:20 від «Пашини»» */
  first: string | null;
  walkOnly: boolean;
  /** Google: кроки найкращого маршруту (для пояснення, чому він швидший); у нас не заповнюється */
  steps?: GStep[];
  /** перша посадка: номер лінії й хвилини відправлення */
  firstLine?: string;
  firstDep?: number;
}

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const toMins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function oursFor(model: CityModel, day: ServiceDay, from: string, to: string, at: number): Answer {
  const tt = model.timetables.get(day)!;
  const plan = planDay(tt, { kind: 'stop', stopId: from }, { kind: 'stop', stopId: to });
  const best = plan.journeys.filter((j) => j.departMins >= at).sort((a, b) => a.arriveMins - b.arriveMins || a.transfers - b.transfers)[0] ?? null;
  const walk = plan.directWalk ? at + plan.directWalk.minutes : null;
  if (walk != null && (!best || walk <= best.arriveMins)) return { arrive: walk, lines: [], first: null, walkOnly: true };
  if (!best) return { arrive: null, lines: [], first: null, walkOnly: false };
  const rides = best.legs.filter((l) => l.kind === 'transit');
  const r0 = rides[0];
  return {
    arrive: best.arriveMins,
    lines: rides.map((l) => (l.kind === 'transit' ? model.routeNo.get(l.routeId) ?? l.routeId : '')),
    first: r0 && r0.kind === 'transit' ? `№${model.routeNo.get(r0.routeId) ?? r0.routeId} о ${clock(r0.depMins)} від «${model.names.get(r0.boardStopId) ?? r0.boardStopId}»` : null,
    walkOnly: false,
    ...(r0 && r0.kind === 'transit' ? { firstLine: model.routeNo.get(r0.routeId) ?? r0.routeId, firstDep: r0.depMins } : {}),
  };
}

// ─── Google ───────────────────────────────────────────────────────────────────────────────────

interface GStep {
  mode: string;
  seconds: number;
  line?: string;
  lineName?: string;
  depStop?: string;
  depLat?: number;
  depLng?: number;
  dep?: string;
  arr?: string;
  stops?: number;
}
type GRoute = GStep[];

/**
 * Хвилини від київської півночі дня запиту (`date`): рейс наступного ранку — понад 1440. Google на вечірній запит
 * інколи пропонує завтрашній перший рейс — це не «швидше за нас».
 */
const minsFrom = (date: string, iso: string) => Math.round((Date.parse(iso) - Date.parse(utcIso(date, '00:00'))) / 60_000);

function readKey(): string {
  const file = process.env.GOOGLE_ORACLE_KEY_FILE;
  const key = (file ? fs.readFileSync(file, 'utf8') : process.env.GOOGLE_ORACLE_KEY ?? '').trim();
  if (!key) throw new Error('GOOGLE_ORACLE_KEY_FILE (або GOOGLE_ORACLE_KEY) не задано');
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function utcIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(h - KYIV_UTC_OFFSET_H, m, 0, 0);
  return d.toISOString();
}

async function askGoogle(key: string, from: [number, number], to: [number, number], departure: string): Promise<GRoute[] | { error: string }> {
  const res = await fetch(`https://routes.googleapis.com/directions/v2:computeRoutes?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-FieldMask': 'routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from[0], longitude: from[1] } } },
      destination: { location: { latLng: { latitude: to[0], longitude: to[1] } } },
      travelMode: 'TRANSIT',
      departureTime: departure,
      computeAlternativeRoutes: true,
      languageCode: 'uk',
    }),
  });
  const body = (await res.json()) as {
    error?: { message?: string };
    routes?: Array<{ legs?: Array<{ steps?: Array<Record<string, unknown>> }> }>;
  };
  if (!res.ok) return { error: `${res.status} ${body.error?.message ?? ''}`.trim() };
  return (body.routes ?? []).map((r) =>
    (r.legs?.[0]?.steps ?? []).map((s): GStep => {
      const t = s.transitDetails as
        | {
            stopDetails?: { departureStop?: { name?: string; location?: { latLng?: { latitude: number; longitude: number } } }; departureTime?: string; arrivalTime?: string };
            transitLine?: { nameShort?: string; name?: string };
            stopCount?: number;
          }
        | undefined;
      return {
        mode: String(s.travelMode ?? ''),
        seconds: Number(String(s.staticDuration ?? '0s').replace('s', '')) || 0,
        ...(t
          ? {
              line: t.transitLine?.nameShort ?? '',
              lineName: t.transitLine?.name ?? '',
              depStop: t.stopDetails?.departureStop?.name ?? '',
              depLat: t.stopDetails?.departureStop?.location?.latLng?.latitude,
              depLng: t.stopDetails?.departureStop?.location?.latLng?.longitude,
              dep: t.stopDetails?.departureTime,
              arr: t.stopDetails?.arrivalTime,
              stops: t.stopCount,
            }
          : {}),
      };
    }),
  );
}

/** Найраніше прибуття серед маршрутів Google (пішки — від часу запиту, рейси — за їхнім розкладом) */
function googleBest(routes: GRoute[], date: string, at: number): Answer {
  const kyivMins = (iso: string) => minsFrom(date, iso);
  let best: Answer = { arrive: null, lines: [], first: null, walkOnly: false };
  for (const r of routes) {
    let t = at;
    const rides = r.filter((s) => s.dep && s.arr);
    for (const s of r) t = s.dep && s.arr ? Math.max(t, kyivMins(s.arr)) : t + s.seconds / 60;
    // перехід через північ не очікуємо (запити вдень)
    if (best.arrive == null || t < best.arrive - 0.5) {
      const r0 = rides[0];
      best = {
        arrive: Math.round(t),
        lines: rides.map((s) => s.line ?? '?'),
        first: r0 ? `№${r0.line} о ${clock(kyivMins(r0.dep!))} від «${r0.depStop}»` : null,
        walkOnly: rides.length === 0,
        steps: r,
        ...(r0 ? { firstLine: r0.line ?? '', firstDep: kyivMins(r0.dep!) } : {}),
      };
    }
  }
  return best;
}

// ─── Звірка ───────────────────────────────────────────────────────────────────────────────────

/**
 * Чому Google швидший: радить пішки; веде пішки до іншої зупинки далі 400 м (наш планувальник так далеко не ходить);
 * їде лінією, якої в нас нема; має рейс, якого в нас нема (± 2 хв на зупинці посадки); інакше — ті самі рейси є й у
 * нас, а планувальник їх не знайшов.
 */
type Why = 'walk' | 'walk_far' | 'other_line' | 'extra_trip' | 'other_path' | 'slower' | 'planner';
const WHY_LABEL: Record<Why, string> = {
  walk: 'Google радить пішки',
  walk_far: 'Google веде пішки до іншої зупинки (далі 400 м)',
  other_line: 'Google їде лінією, якої в нас нема (електричка чи приміський)',
  extra_trip: 'у Google є рейс, якого в нас нема',
  other_path: 'той самий рейс у нас іде іншим шляхом чи в інший бік (не довозить до місця)',
  slower: 'той самий рейс, але в нас він їде довше (інші хвилини між зупинками)',
  planner: 'рейси ті самі — наш планувальник не знайшов',
};

type Verdict = 'agree' | 'google_faster' | 'ours_faster' | 'google_none' | 'ours_none' | 'both_walk';

interface QueryResult {
  from: string;
  to: string;
  why: Pair['why'];
  date: string;
  time: string;
  ours: Answer;
  google: Answer;
  delta: number | null;
  verdict: Verdict;
  why?: Why;
}

function verdictOf(ours: Answer, google: Answer): { verdict: Verdict; delta: number | null } {
  if (ours.arrive == null && google.arrive == null) return { verdict: 'both_walk', delta: null };
  if (google.arrive == null) return { verdict: 'google_none', delta: null };
  if (ours.arrive == null) return { verdict: 'ours_none', delta: null };
  const delta = ours.arrive - google.arrive;
  if (ours.walkOnly && google.walkOnly) return { verdict: 'both_walk', delta };
  if (Math.abs(delta) <= TOLERANCE) return { verdict: 'agree', delta };
  return { verdict: delta > 0 ? 'google_faster' : 'ours_faster', delta };
}

/** Рейс Google проти нашого розкладу: найближче наше відправлення того самого номера з найближчої нашої зупинки */
interface LineCheck {
  line: string;
  lineName: string;
  depStop: string;
  googleDep: number;
  ourRoute: string | null;
  ourStop: string | null;
  ourStopM: number | null;
  ourDep: number | null;
  diff: number | null;
}

function checkRide(model: CityModel, day: ServiceDay, date: string, s: GStep): LineCheck {
  const tt = model.timetables.get(day)!;
  const googleDep = minsFrom(date, s.dep!);
  const base: LineCheck = { line: s.line ?? '?', lineName: s.lineName ?? '', depStop: s.depStop ?? '', googleDep, ourRoute: null, ourStop: null, ourStopM: null, ourDep: null, diff: null };
  const want = sameLineNo(s.line ?? '');
  const routeIds = [...model.routeNo].filter(([, no]) => sameLineNo(no) === want).map(([id]) => id);
  if (!routeIds.length) return base;
  let best: LineCheck = { ...base, ourRoute: routeIds.map((id) => model.routeNo.get(id)).join(', ') };
  if (s.depLat == null || s.depLng == null) return best;
  for (const p of tt.patterns) {
    if (!routeIds.includes(p.routeId)) continue;
    p.stops.forEach((si, pos) => {
      const st = tt.stops[si];
      if (st.lat == null || st.lng == null) return;
      const m = haversineDistance(s.depLat!, s.depLng!, st.lat, st.lng);
      if (m > STOP_MATCH_M) return;
      for (const trip of p.trips) {
        const diff = trip.times[pos] - googleDep;
        if (best.diff == null || Math.abs(diff) < Math.abs(best.diff) || (Math.abs(diff) === Math.abs(best.diff) && m < (best.ourStopM ?? Infinity))) {
          best = { ...best, ourStop: model.names.get(st.id) ?? st.id, ourStopM: Math.round(m), ourDep: trip.times[pos], diff };
        }
      }
    });
  }
  return best;
}

/**
 * Чи довозить наш рейс тієї самої лінії, що відправляється з посадки Google у той самий час (± 2 хв), кудись ближче
 * 400 м до місця призначення: інакше той самий за часом рейс у нас іде іншим шляхом (варіант) чи в інший бік.
 */
function ourTripReaches(model: CityModel, day: ServiceDay, date: string, s: GStep, dest: [number, number]): boolean {
  const tt = model.timetables.get(day)!;
  const googleDep = minsFrom(date, s.dep!);
  const want = sameLineNo(s.line ?? '');
  const routeIds = new Set([...model.routeNo].filter(([, no]) => sameLineNo(no) === want).map(([id]) => id));
  for (const p of tt.patterns) {
    if (!routeIds.has(p.routeId)) continue;
    for (let pos = 0; pos < p.stops.length; pos++) {
      const st = tt.stops[p.stops[pos]];
      if (st.lat == null || st.lng == null || s.depLat == null || s.depLng == null) continue;
      if (haversineDistance(s.depLat, s.depLng, st.lat, st.lng) > STOP_MATCH_M) continue;
      if (!p.trips.some((t) => Math.abs(t.times[pos] - googleDep) <= DEPARTURE_MATCH_MIN)) continue;
      const later = p.stops.slice(pos + 1).map((i) => tt.stops[i]);
      if (later.some((x) => x.lat != null && x.lng != null && haversineDistance(dest[0], dest[1], x.lat, x.lng) <= 400)) return true;
    }
  }
  return false;
}

function whyGoogleFaster(model: CityModel, day: ServiceDay, date: string, origin: [number, number], dest: [number, number], google: Answer, ours: Answer): Why {
  if (google.walkOnly) return 'walk';
  // ми сідаємо на ту саму лінію в той самий час, а приїжджаємо пізніше — інші хвилини між зупинками
  if (ours.firstLine != null && google.firstLine != null && sameLineNo(ours.firstLine) === sameLineNo(google.firstLine) && Math.abs((ours.firstDep ?? 0) - (google.firstDep ?? 0)) <= DEPARTURE_MATCH_MIN) return 'slower';
  const rides = (google.steps ?? []).filter((s) => s.dep && s.arr);
  const r0 = rides[0];
  if (r0 && r0.depLat != null && r0.depLng != null && haversineDistance(origin[0], origin[1], r0.depLat, r0.depLng) > 400) return 'walk_far';
  for (const s of rides) {
    const dep = minsFrom(date, s.dep!);
    if (dep < 0 || dep >= 1440) continue;
    const c = checkRide(model, day, date, s);
    if (!c.ourRoute) return 'other_line';
    if (c.diff == null || Math.abs(c.diff) > DEPARTURE_MATCH_MIN) return 'extra_trip';
  }
  // одна поїздка Google: чи наш рейс того самого часу справді довозить до місця
  if (rides.length === 1 && !ourTripReaches(model, day, date, rides[0], dest)) return 'other_path';
  return 'planner';
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function report(model: CityModel, results: QueryResult[], rides: LineCheck[], meta: { requests: number; cached: number; errors: string[] }): string {
  const lines: string[] = [];
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const name = (id: string) => model.names.get(id) ?? id;
  lines.push(`# ${CITY}: наш планувальник проти Google`, '');
  lines.push(
    `Згенеровано \`google.oracle.test.ts\` (${new Date().toISOString().slice(0, 10)}, датасет \`${model.dataset.revision ?? '—'}\`). ` +
      `Запитів до Google: ${meta.requests} нових, ${meta.cached} з кешу. Поріг «збігається» — ±${TOLERANCE} хв. ` +
      'Координат Google тут нема — лише час, номери ліній і назви зупинок.',
    '',
  );
  lines.push('## Найраніше прибуття', '');
  lines.push('| Висновок | Запитів |', '|---|---|');
  const labels: Record<Verdict, string> = {
    agree: 'збігається',
    google_faster: 'Google швидший (у нас довше або немає рейсу)',
    ours_faster: 'ми швидші (у Google нема рейсу чи лінії)',
    google_none: 'Google не знайшов нічого',
    ours_none: 'ми не знайшли нічого',
    both_walk: 'обидва — пішки / нема',
  };
  for (const v of Object.keys(labels) as Verdict[]) lines.push(`| ${labels[v]} | ${count(v)} |`);
  lines.push('');
  const faster = results.filter((r) => r.verdict === 'google_faster');
  lines.push('Чому Google швидший:', '');
  for (const w of Object.keys(WHY_LABEL) as Why[]) lines.push(`- ${WHY_LABEL[w]}: ${faster.filter((r) => r.why === w).length}`);
  lines.push('');
  for (const d of DAYS) {
    for (const t of d.times) {
      const part = results.filter((r) => r.date === d.date && r.time === t);
      const agree = part.filter((r) => r.verdict === 'agree').length;
      lines.push(`- ${d.label} ${t}: ${agree} з ${part.length} збігаються`);
    }
  }
  lines.push('');

  // розклад ліній
  lines.push('## Розклад ліній: рейси Google проти наших відправлень', '');
  lines.push(
    `Кожна посадка Google: та сама лінія, наша зупинка не далі ${STOP_MATCH_M} м, найближче наше відправлення. ` +
      `«Збіг» — різниця до ${DEPARTURE_MATCH_MIN} хв. Медіана — наше відправлення мінус Google (плюс — ми пізніше).`,
    '',
  );
  lines.push('| Лінія Google | Наш маршрут | Посадок | Збіг ±2 хв | Медіана, хв | Найбільше розходження |', '|---|---|---|---|---|---|');
  const byLine = new Map<string, LineCheck[]>();
  for (const r of rides) byLine.set(r.line, [...(byLine.get(r.line) ?? []), r]);
  const sortedLines = [...byLine.keys()].sort((a, b) => a.localeCompare(b, 'uk', { numeric: true }));
  for (const line of sortedLines) {
    const list = byLine.get(line)!;
    const matched = list.filter((r) => r.diff != null);
    const ok = matched.filter((r) => Math.abs(r.diff!) <= DEPARTURE_MATCH_MIN).length;
    const worst = matched.reduce<LineCheck | null>((w, r) => (!w || Math.abs(r.diff!) > Math.abs(w.diff!) ? r : w), null);
    const our = list[0].ourRoute ? `№${list[0].ourRoute}` : '— нема';
    const worstText = worst ? `${worst.diff! > 0 ? '+' : ''}${worst.diff} хв: Google ${clock(worst.googleDep)} «${worst.depStop}», у нас ${clock(worst.ourDep!)} «${worst.ourStop}»` : list[0].ourRoute ? 'нашої зупинки поруч нема' : '—';
    lines.push(`| ${line} (${list[0].lineName}) | ${our} | ${list.length} | ${matched.length ? `${ok} з ${matched.length}` : '—'} | ${median(matched.map((r) => r.diff!)) ?? '—'} | ${worstText} |`);
  }
  lines.push('');
  const ourNos = new Set([...model.routeNo.values()].map(sameLineNo));
  const googleOnly = sortedLines.filter((l) => !ourNos.has(sameLineNo(l)));
  const seen = new Set(sortedLines.map(sameLineNo));
  const oursOnly = [...new Set(model.routeNo.values())].filter((no) => !seen.has(sameLineNo(no)));
  lines.push('## Покриття', '');
  lines.push(`- Лінії, які знає Google, а в нас їх нема: ${googleOnly.length ? googleOnly.map((l) => `${l} (${byLine.get(l)![0].lineName})`).join('; ') : 'нема'}.`);
  lines.push(`- Наші маршрути, яких Google жодного разу не запропонував: ${oursOnly.length ? oursOnly.map((n) => `№${n}`).join(', ') : 'нема'}.`, '');

  lines.push('## Найбільші розходження прибуття', '');
  lines.push('| Звідки → куди | День, час | Ми | Google | Різниця, хв | Чому |', '|---|---|---|---|---|---|');
  const worst = results.filter((r) => r.delta != null && r.verdict !== 'agree' && r.verdict !== 'both_walk').sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
  const fmt = (a: Answer) => (a.arrive == null ? 'нема' : `${clock(a.arrive)} — ${a.walkOnly ? 'пішки' : a.first ?? ''}${a.lines.length > 1 ? `, далі №${a.lines.slice(1).join(', №')}` : ''}`);
  for (const r of worst.slice(0, 40)) {
    const day = DAYS.find((d) => d.date === r.date)!.label;
    lines.push(`| ${name(r.from)} → ${name(r.to)} | ${day} ${r.time} | ${fmt(r.ours)} | ${fmt(r.google)} | ${r.delta! > 0 ? '+' : ''}${r.delta} | ${r.why ? WHY_LABEL[r.why] : ''} |`);
  }
  const nothing = results.filter((r) => r.verdict === 'google_none' || r.verdict === 'ours_none');
  if (nothing.length) {
    lines.push('', '## Хтось не знайшов нічого', '');
    for (const r of nothing.slice(0, 30)) {
      const day = DAYS.find((d) => d.date === r.date)!.label;
      lines.push(`- ${name(r.from)} → ${name(r.to)}, ${day} ${r.time}: ${r.verdict === 'google_none' ? `Google — нічого; ми — ${fmt(r.ours)}` : `ми — нічого; Google — ${fmt(r.google)}`}`);
    }
  }
  if (meta.errors.length) lines.push('', '## Помилки Google', '', ...[...new Set(meta.errors)].slice(0, 10).map((e) => `- ${e}`));
  lines.push('');
  return lines.join('\n');
}

describe('sameLineNo', () => {
  it('один номер у різних записах', () => {
    expect(sameLineNo('2-Б')).toBe(sameLineNo('2Б'));
    expect(sameLineNo('2b')).toBe(sameLineNo('2Б'));
    expect(sameLineNo('№ 7')).toBe('7');
  });
});

describe.skipIf(!ENABLED)('звірка з Google Routes', () => {
  beforeAll(() => {
    server.close(); // MSW із setup.ts не повинен чіпати справжні запити
  });

  it(
    'наш планувальник проти Google: прибуття, розклад ліній, покриття',
    async () => {
      const key = readKey();
      const res = await fetch(`${API}/transport/dataset?city=${encodeURIComponent(CITY)}`);
      expect(res.ok).toBe(true);
      const model = buildModel((await res.json()) as TransportDataset);
      const tt = model.timetables.get('weekday')!;
      const coordsOf = (id: string): [number, number] | null => {
        const s = tt.stops[tt.stopIndex.get(id) ?? -1];
        return s && s.lat != null && s.lng != null ? [s.lat, s.lng] : null;
      };
      const pairs = pickPairs(model).filter((p) => coordsOf(p.from) && coordsOf(p.to));
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const cache: Record<string, GRoute[]> = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
      const results: QueryResult[] = [];
      const rides: LineCheck[] = [];
      const seenRide = new Set<string>();
      const meta = { requests: 0, cached: 0, errors: [] as string[] };
      for (const day of DAYS) {
        for (const time of day.times) {
          for (const p of pairs) {
            const cacheKey = `${p.from}>${p.to}@${day.date}T${time}`;
            let routes = cache[cacheKey];
            if (routes) meta.cached++;
            else {
              if (meta.requests >= MAX_REQUESTS) continue;
              meta.requests++;
              const got = await askGoogle(key, coordsOf(p.from)!, coordsOf(p.to)!, utcIso(day.date, time));
              await sleep(120);
              if ('error' in got) {
                meta.errors.push(got.error);
                // квота чи відмова ключа — далі питати марно
                if (/^(403|429)/.test(got.error)) break;
                continue;
              }
              routes = got;
              cache[cacheKey] = routes;
              if (meta.requests % 50 === 0) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
            }
            const at = toMins(time);
            const ours = oursFor(model, day.serviceDay, p.from, p.to, at);
            const google = googleBest(routes, day.date, at);
            const v = verdictOf(ours, google);
            const why = v.verdict === 'google_faster' ? whyGoogleFaster(model, day.serviceDay, day.date, coordsOf(p.from)!, coordsOf(p.to)!, google, ours) : undefined;
            results.push({ ...p, date: day.date, time, ours, google: { ...google, steps: undefined }, ...v, ...(why ? { why } : {}) });
            for (const r of routes) {
              for (const s of r) {
                // рейс іншого дня (завтрашній перший) з нашим розкладом цього дня не звіряємо
                if (!s.dep || !s.line) continue;
                const depMins = minsFrom(day.date, s.dep);
                if (depMins < 0 || depMins >= 1440) continue;
                const k = `${day.serviceDay}|${s.line}|${s.depStop}|${s.dep}`;
                if (seenRide.has(k)) continue;
                seenRide.add(k);
                rides.push(checkRide(model, day.serviceDay, day.date, s));
              }
            }
          }
        }
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      fs.writeFileSync(REPORT_FILE, report(model, results, rides, meta));
      fs.writeFileSync(
        JSON_FILE,
        `${JSON.stringify({ city: CITY, revision: model.dataset.revision ?? null, tolerance: TOLERANCE, results, rides: rides.map(({ line, lineName, depStop, googleDep, ourRoute, ourStop, ourStopM, ourDep, diff }) => ({ line, lineName, depStop, googleDep, ourRoute, ourStop, ourStopM, ourDep, diff })) }, null, 1)}\n`,
      );
      console.log(`[google-oracle] ${results.length} запитів, нових ${meta.requests}, з кешу ${meta.cached}; звіт: ${REPORT_FILE}`);
      expect(results.length).toBeGreaterThan(0);
    },
    3_600_000,
  );
});
