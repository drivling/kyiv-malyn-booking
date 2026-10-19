/**
 * Звірка рушія з Transitous (MOTIS): ті самі кінці та час, порівнюємо найраніше прибуття й пересадки.
 * Не входить у CI й pre-commit (мережа, чужий публічний сервіс): запускати вручну, див.
 * Docs/transport-journey-planner-2026-10.md —
 *
 *   TRANSITOUS_ORACLE=1 npx vitest run src/pages/LocalTransportPage/journey/transitous.oracle.test.ts
 *
 * Змінні: ORACLE_PAIRS (30), ORACLE_SEED (1), ORACLE_MODE=points|stops (points),
 * ORACLE_OPTS='{"detourFactor":1.5}' — перевизначення JourneyOptions, ORACLE_TOLERANCE (2 хв),
 * ORACLE_CACHE — файл кешу відповідей (за замовчуванням у tmp; повторні прогони з іншими параметрами не б'ють по мережі),
 * NODE_USE_ENV_PROXY=1 — у середовищі з HTTPS-проксі.
 *
 * Чому за замовчуванням «points» (координати зупинок): Transitous розкриває stop_id до «еквівалентних» зупинок
 * (та сама назва/поруч, пересадка 0 м за 2 хв), а кінець-координата дає ту саму семантику «людина стоїть тут»,
 * що й наша точка. Розклад збирається прямо з GTFS-снімка data/malyn-transport/gtfs (stop_times.txt) — незалежно від
 * recordTiming, тож перевіряється і сам алгоритм, і підібрані числа. Правила Transitous: впізнаваний User-Agent, пауза.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { server } from '@/test/msw/server';
import { haversineDistance } from '../nearbyAlternatives';
import { DEFAULT_JOURNEY_OPTIONS, type JourneyOptions } from './options';
import { planDay } from './plan';
import { assembleTimetable } from './timetable';
import type { Endpoint, Pattern, PatternTrip, Timetable, TimetableStop } from './types';

const ENABLED = process.env.TRANSITOUS_ORACLE === '1';
const GTFS_DIR = path.resolve(process.cwd(), '../data/malyn-transport/gtfs');
const API = process.env.TRANSITOUS_API ?? 'https://api.transitous.org/api/v5/plan';
const FEED_PREFIX = 'ua-malyn_';
/** День запитів — 2026-10-20 (вівторок); Київ ще на літньому часі, UTC+3 */
const KYIV_UTC_OFFSET_H = 3;
const WINDOW_MIN = 120;
const PAIRS = Number(process.env.ORACLE_PAIRS ?? 30);
const SEED = Number(process.env.ORACLE_SEED ?? 1);
const TOLERANCE = Number(process.env.ORACLE_TOLERANCE ?? 2);
const MODE = process.env.ORACLE_MODE === 'stops' ? 'stops' : 'points';
// не кругле й не збігається з відправленнями рейсів: Transitous додає ≥ 1 хв пішки навіть від стовпчика до себе
const QUERY_TIMES = ['07:03', '12:37'];
const CACHE_FILE = process.env.ORACLE_CACHE ?? path.join(os.tmpdir(), 'transitous-oracle-cache.json');
const EXTRA_OPTIONS: Partial<JourneyOptions> = process.env.ORACLE_OPTS ? JSON.parse(process.env.ORACLE_OPTS) : {};

function parseCsv(file: string): Array<Record<string, string>> {
  const raw = fs.readFileSync(path.join(GTFS_DIR, file), 'utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const clockMins = (s: string): number => {
  const [h, m, sec] = s.split(':').map(Number);
  return Math.round(h * 60 + m + (sec || 0) / 60);
};

export function gtfsTimetable(options: Partial<JourneyOptions> = {}): Timetable {
  const stops: TimetableStop[] = parseCsv('stops.txt').map((r) => ({ id: r.stop_id, lat: Number(r.stop_lat), lng: Number(r.stop_lon) }));
  const stopIndex = new Map(stops.map((s, i) => [s.id, i]));
  const trips = new Map(parseCsv('trips.txt').map((r) => [r.trip_id, r]));
  const byTrip = new Map<string, Array<{ seq: number; stop: string; mins: number }>>();
  for (const r of parseCsv('stop_times.txt')) {
    const list = byTrip.get(r.trip_id) ?? [];
    list.push({ seq: Number(r.stop_sequence), stop: r.stop_id, mins: clockMins(r.departure_time) });
    byTrip.set(r.trip_id, list);
  }
  const groups = new Map<string, { base: Omit<Pattern, 'trips'>; trips: PatternTrip[] }>();
  for (const [tripId, list] of byTrip) {
    const t = trips.get(tripId);
    if (!t) continue;
    list.sort((a, b) => a.seq - b.seq);
    const ids = list.map((x) => x.stop);
    const key = `${t.route_id}|${t.direction_id}|${ids.join(',')}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        base: { routeId: t.route_id, direction: t.direction_id === '0' ? 'back' : 'there', variantId: null, stops: ids.map((id) => stopIndex.get(id)!) },
        trips: [],
      };
      groups.set(key, g);
    }
    g.trips.push({ tripId, times: list.map((x) => x.mins) });
  }
  // обгін усередині патерна розводимо так само, як buildTimetable
  const patterns: Pattern[] = [];
  for (const { base, trips: ts } of groups.values()) {
    const sorted = [...ts].sort((a, b) => a.times[0] - b.times[0]);
    const parts: PatternTrip[][] = [];
    for (const t of sorted) {
      const part = parts.find((p) => t.times.every((x, i) => p[p.length - 1].times[i] <= x));
      if (part) part.push(t);
      else parts.push([t]);
    }
    for (const part of parts) patterns.push({ ...base, trips: part });
  }
  return assembleTimetable({ stops, patterns, options });
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const kyivFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false });
const kyivMins = (iso: string): number => {
  const [h, m] = kyivFmt.format(new Date(iso)).split(':').map(Number);
  return h * 60 + m;
};

interface RemoteLeg {
  mode: string;
  distance?: number;
  from?: { stopId?: string };
  to?: { stopId?: string };
}
interface RemoteItinerary {
  startTime: string;
  endTime: string;
  transfers: number;
  legs: RemoteLeg[];
}
interface Remote {
  startMins: number;
  endMins: number;
  transfers: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** У кеш йде лише потрібне для звірки (повна відповідь MOTIS — сотні КБ) */
function slimItinerary(it: RemoteItinerary): RemoteItinerary {
  return {
    startTime: it.startTime,
    endTime: it.endTime,
    transfers: it.transfers,
    legs: it.legs.map((l) => ({ mode: l.mode, distance: l.distance, from: { stopId: l.from?.stopId }, to: { stopId: l.to?.stopId } })),
  };
}

let cache: Record<string, RemoteItinerary[]> = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, RemoteItinerary[]>;
} catch {
  cache = {};
}

async function askTransitous(from: string, to: string, timeLocal: string): Promise<RemoteItinerary[]> {
  const [h, m] = timeLocal.split(':').map(Number);
  const utc = new Date(Date.UTC(2026, 9, 20, h - KYIV_UTC_OFFSET_H, m));
  const url = new URL(API);
  url.searchParams.set('fromPlace', from);
  url.searchParams.set('toPlace', to);
  url.searchParams.set('time', utc.toISOString());
  url.searchParams.set('searchWindow', String(WINDOW_MIN * 60));
  url.searchParams.set('numItineraries', '30');
  url.searchParams.set('maxTransfers', String(DEFAULT_JOURNEY_OPTIONS.maxTransfers));
  url.searchParams.set('detailedLegs', 'false');
  url.searchParams.set('detailedTransfers', 'false');
  url.searchParams.set('joinInterlinedLegs', 'false');
  // решта — як у посиланні з веб-інтерфейсу Transitous
  url.searchParams.set('pedestrianSpeed', String(DEFAULT_JOURNEY_OPTIONS.walkSpeedMps));
  url.searchParams.set('maxPreTransitTime', String(DEFAULT_JOURNEY_OPTIONS.maxAccessWalkMin * 60));
  url.searchParams.set('maxPostTransitTime', String(DEFAULT_JOURNEY_OPTIONS.maxAccessWalkMin * 60));
  url.searchParams.set('maxMatchingDistance', '250');
  url.searchParams.set('useRoutedTransfers', 'false');
  const key = url.toString();
  if (cache[key]) return cache[key];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'malin.kiev.ua journey-planner oracle (mer.sergei@gmail.com)' } });
    if (res.ok) {
      const body = (await res.json()) as { itineraries?: RemoteItinerary[] };
      cache[key] = (body.itineraries ?? []).map(slimItinerary);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      await sleep(1100);
      return cache[key];
    }
    if (attempt >= 2) throw new Error(`Transitous ${res.status} for ${url.search}`);
    await sleep(3000);
  }
}

/** Найраніше прибуття серед поїздок, що вирушають у вікні [T, T + WINDOW]; за рівного — менше пересадок */
function bestOf(list: Remote[], t: number): Remote | null {
  const inWindow = list.filter((j) => j.startMins >= t && j.startMins <= t + WINDOW_MIN);
  inWindow.sort((a, b) => a.endMins - b.endMins || a.transfers - b.transfers);
  return inWindow[0] ?? null;
}

const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

describe.skipIf(!ENABLED)('звірка з Transitous', () => {
  beforeAll(() => {
    server.close(); // MSW із setup.ts не повинен чіпати справжні запити
  });

  it(
    'найраніше прибуття й пересадки збігаються на випадкових парах',
    async () => {
      const tt = gtfsTimetable({ maxAccessStops: 40, ...EXTRA_OPTIONS });
      const rand = mulberry32(SEED);
      const stopById = new Map(tt.stops.map((s) => [s.id, s]));
      const pick = () => tt.stops[Math.floor(rand() * tt.stops.length)];

      const endpoint = (s: TimetableStop): Endpoint =>
        MODE === 'points' ? { kind: 'point', lat: s.lat!, lng: s.lng! } : { kind: 'stop', stopId: s.id };
      const place = (s: TimetableStop): string => (MODE === 'points' ? `${s.lat},${s.lng}` : FEED_PREFIX + s.id);

      const rows: Array<Record<string, string | number>> = [];
      const walkRatios: number[] = [];
      const stat = { compared: 0, exact: 0, within: 0, mineLater: 0, mineEarlier: 0, mineMissing: 0, theirsMissing: 0, transfersEqual: 0 };

      for (let n = 0; n < PAIRS; n++) {
        const a = pick();
        const b = pick();
        if (a.id === b.id) continue;
        const plan = planDay(tt, endpoint(a), endpoint(b));
        const mineAll: Remote[] = plan.journeys.map((j) => ({ startMins: j.departMins, endMins: j.arriveMins, transfers: j.transfers }));
        for (const time of QUERY_TIMES) {
          const [h, m] = time.split(':').map(Number);
          const t = h * 60 + m;
          const itineraries = await askTransitous(place(a), place(b), time);
          const theirs = bestOf(
            itineraries.map((i) => ({ startMins: kyivMins(i.startTime), endMins: kyivMins(i.endTime), transfers: i.transfers })),
            t
          );
          // Реальні піші відрізки Transitous (OSM) проти прямої: між зупинками, а в режимі points — ще й від/до кінця запиту
          for (const it of itineraries) {
            for (const leg of it.legs) {
              if (leg.mode !== 'WALK' || !((leg.distance ?? 0) > 0)) continue;
              const stopOf = (id?: string) => (id ? stopById.get(id.replace(FEED_PREFIX, '')) : undefined);
              const start = stopOf(leg.from?.stopId) ?? (leg.from?.stopId ? undefined : a);
              const end = stopOf(leg.to?.stopId) ?? (leg.to?.stopId ? undefined : b);
              if (!start || !end || start === end) continue;
              const straight = haversineDistance(start.lat!, start.lng!, end.lat!, end.lng!);
              if (straight > 30) walkRatios.push((leg.distance as number) / straight);
            }
          }
          const mine = bestOf(mineAll, t);
          stat.compared++;
          if (!mine && !theirs) {
            stat.exact++;
            stat.within++;
            stat.transfersEqual++;
            continue;
          }
          if (!mine) stat.mineMissing++;
          else if (!theirs) stat.theirsMissing++;
          else {
            const delta = mine.endMins - theirs.endMins;
            if (delta === 0) stat.exact++;
            if (Math.abs(delta) <= TOLERANCE) {
              stat.within++;
              if (mine.transfers === theirs.transfers) stat.transfersEqual++;
            } else if (delta > 0) stat.mineLater++;
            else stat.mineEarlier++;
          }
          if (!mine || !theirs || Math.abs(mine.endMins - theirs.endMins) > TOLERANCE || mine.transfers !== theirs.transfers) {
            rows.push({
              pair: `${a.id}→${b.id}`,
              at: time,
              mine: mine ? `${mine.startMins}→${mine.endMins} (${mine.transfers})` : '—',
              transitous: theirs ? `${theirs.startMins}→${theirs.endMins} (${theirs.transfers})` : '—',
            });
          }
        }
      }

      walkRatios.sort((x, y) => x - y);
      const ratio = walkRatios.length
        ? `довжина пішки Transitous / по прямій: медіана ${quantile(walkRatios, 0.5).toFixed(2)}, p25 ${quantile(walkRatios, 0.25).toFixed(2)}, p75 ${quantile(walkRatios, 0.75).toFixed(2)} (n=${walkRatios.length})`
        : 'піших відрізків між зупинками у відповідях немає';
      const report =
        `Transitous oracle [${MODE}] ${JSON.stringify({ ...EXTRA_OPTIONS })}\n` +
        `запитів ${stat.compared}: точно ${stat.exact}, в межах ±${TOLERANCE} хв ${stat.within} (з тими ж пересадками ${stat.transfersEqual}), ` +
        `наше пізніше ${stat.mineLater}, наше раніше ${stat.mineEarlier}, у нас порожньо ${stat.mineMissing}, у них порожньо ${stat.theirsMissing}\n` +
        `${ratio}\n` +
        (rows.length ? JSON.stringify(rows, null, 1) : 'розбіжностей немає');
      console.log(`\n${report}`);
      if (process.env.ORACLE_REPORT) fs.writeFileSync(process.env.ORACLE_REPORT, `${report}\n`);
      expect(stat.compared).toBeGreaterThan(0);
      expect(stat.within / stat.compared).toBeGreaterThanOrEqual(Number(process.env.ORACLE_MIN_MATCH ?? 0.8));
    },
    30 * 60 * 1000
  );
});
