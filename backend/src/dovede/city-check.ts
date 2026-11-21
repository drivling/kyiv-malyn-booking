/**
 * «Доведе» · звірка свого розкладу з Google (Docs/dovede-learning-roadmap.md, крок 4б).
 *
 * Чисті функції для кампанії «Звірити свій розклад з Google» (`city-campaign.ts`, заготовка `check`): з датасету
 * міста — пари зупинок (три великі відрізки кожного напрямку кожного маршруту) з нашим часом у дорозі, а з відповіді
 * сервера на пару — вердикт: збігається, Google швидше, наше швидше, Google їде іншою лінією, лише пішки, дороги
 * немає. Датасет звірка не міняє — це лише звіт.
 *
 * Наш час — сума сегментів між зупинками; стискання окремих рейсів (`arrivalTime`, `timepoints`) не враховано.
 */
import type { TransportDataset } from '../local-transport';
import { segmentChains } from '../transport-segments';
import { normalizeLine } from '../korosten-google';
import type { CrawlDayType } from './crawl-core';

export type CheckVerdict = 'same' | 'google_faster' | 'ours_faster' | 'other_line' | 'walk' | 'none';

export const CHECK_VERDICTS: readonly CheckVerdict[] = ['same', 'google_faster', 'ours_faster', 'other_line', 'walk', 'none'];

/** Наш маршрут, що їде пару без пересадки, і його час */
export interface CheckLine {
  /** номер для показу («2-Б») */
  routeNo: string;
  ownMin: number;
}

/** Що кампанія зберігає про пару в плані (`CampaignSeed.check`) */
export interface CheckMeta {
  fromName: string;
  toName: string;
  lines: CheckLine[];
}

export interface CheckPair extends CheckMeta {
  from: string;
  to: string;
  dayType: CrawlDayType;
  hour: number;
}

/** Кінці пари ближче за це — пішки швидше, Google автобуса не дасть */
export const CHECK_MIN_M = 400;
/** Збігається: різниця не більша за більше з двох — стільки хвилин і стільки відсотків нашого часу */
export const CHECK_TOLERANCE_MIN = 2;
export const CHECK_TOLERANCE_PCT = 20;
/** Година, біля якої шукаємо рейс для питання */
const TARGET_MIN = 10 * 60;

function straightM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const minutesOf = (time: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Тип дня й рейс для питання: будній, якщо маршрут у будні ходить, інакше субота; відправлення — найближче до 10:00 */
function pickTrip(trips: Array<{ serviceId?: string; departureTime?: string | null }>): { dayType: CrawlDayType; startMin: number } | null {
  const timed = trips.map((t) => ({ weekend: t.serviceId === 'weekends', min: minutesOf(t.departureTime) })).filter((t): t is { weekend: boolean; min: number } => t.min !== null);
  if (!timed.length) return null;
  const weekday = timed.filter((t) => !t.weekend);
  const pool = weekday.length ? weekday : timed;
  const best = pool.reduce((a, b) => (Math.abs(b.min - TARGET_MIN) < Math.abs(a.min - TARGET_MIN) ? b : a));
  return { dayType: weekday.length ? 'weekday' : 'saturday', startMin: best.min };
}

/**
 * Пари зупинок для звірки: кожен маршрут (без ненадійних) × напрямок — початок → кінець, початок → середина,
 * середина → кінець головного ланцюжка. Однакова пара з кількох маршрутів — одна пара з кількома лініями.
 */
export function checkPairs(dataset: TransportDataset): CheckPair[] {
  const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
  const seconds = new Map(dataset.segments.map((s) => [`${s.routeId}|${s.fromStopId}|${s.toStopId}`, s.seconds]));
  const byKey = new Map<string, CheckPair>();
  for (const route of dataset.routes) {
    if (route.unreliable) continue;
    const routeNo = (route.shortName ?? '').trim() || route.id;
    const routeStops = dataset.routeStops.filter((s) => s.routeId === route.id);
    for (const chain of segmentChains(routeStops)) {
      const direction = chain.label === 'there' ? 'there' : 'back';
      // рейси основного шляху цього напрямку: '1' — «туди» (як у GTFS-експорті)
      const trips = dataset.trips.filter((t) => t.routeId === route.id && !t.variantId && (String(t.directionId) === '1' ? 'there' : 'back') === direction);
      const trip = pickTrip(trips);
      if (!trip) continue;
      // секунди від початку ланцюжка до кожної точки; без сегмента — час невідомий, напрямок пропускаємо
      const offset: number[] = [0];
      let known = true;
      for (let i = 0; i < chain.ids.length - 1; i++) {
        const sec = seconds.get(`${route.id}|${chain.ids[i]}|${chain.ids[i + 1]}`);
        if (sec === undefined) {
          known = false;
          break;
        }
        offset.push(offset[i] + sec);
      }
      if (!known) continue;
      const real = chain.ids.map((id, i) => ({ id, i })).filter((p) => !chain.technical[p.i] && stopById.has(p.id));
      if (real.length < 2) continue;
      const first = real[0];
      const last = real[real.length - 1];
      const mid = real[Math.floor(real.length / 2)];
      const spans = real.length >= 3 ? [[first, last], [first, mid], [mid, last]] : [[first, last]];
      for (const [a, b] of spans) {
        const from = stopById.get(a.id)!;
        const to = stopById.get(b.id)!;
        if (a.id === b.id || straightM(from, to) < CHECK_MIN_M) continue;
        const ownMin = Math.max(1, Math.round((offset[b.i] - offset[a.i]) / 60));
        const key = `${a.id}|${b.id}`;
        const pair = byKey.get(key);
        if (pair) {
          if (!pair.lines.some((l) => normalizeLine(l.routeNo) === normalizeLine(routeNo))) pair.lines.push({ routeNo, ownMin });
          continue;
        }
        const atFrom = trip.startMin + Math.floor(offset[a.i] / 60);
        byKey.set(key, { from: a.id, to: b.id, fromName: from.name, toName: to.name, lines: [{ routeNo, ownMin }], dayType: trip.dayType, hour: Math.min(23, Math.floor(atFrom / 60)) });
      }
    }
  }
  return [...byKey.values()];
}

/** Відповідь сервера на пару: стан питання й кроки коротко (`compactSteps`) */
export interface CheckAnswer {
  status: string;
  steps?: unknown;
}

export interface CheckResult {
  verdict: CheckVerdict;
  /** наш маршрут, яким поїхав Google (для `same` / `google_faster` / `ours_faster`), і хвилини */
  routeNo?: string;
  ownMin?: number;
  googleMin?: number;
  /** лінії, якими їде Google */
  googleLines?: string[];
}

interface Ride {
  line: string;
  min: number;
}

const rides = (steps: unknown): Ride[] =>
  (Array.isArray(steps) ? (steps as Array<{ line?: unknown; min?: unknown; walk?: unknown }>) : [])
    .filter((s) => s && s.walk === undefined && typeof s.line === 'string')
    .map((s) => ({ line: String(s.line), min: Number(s.min) || 0 }));

/** Вердикт по парі; null — відповіді ще немає (питання в черзі чи не вдалося) */
export function checkVerdict(meta: CheckMeta, answer: CheckAnswer): CheckResult | null {
  if (answer.status === 'no_route') return { verdict: 'none' };
  if (answer.status !== 'ok') return null;
  const ridden = rides(answer.steps);
  if (!ridden.length) return { verdict: 'walk' };
  const googleLines = [...new Set(ridden.map((r) => r.line).filter(Boolean))];
  const ours = ridden.length === 1 ? meta.lines.find((l) => normalizeLine(l.routeNo) === normalizeLine(ridden[0].line)) : undefined;
  if (!ours) return { verdict: 'other_line', googleLines };
  const googleMin = ridden[0].min;
  const diff = googleMin - ours.ownMin;
  const tolerance = Math.max(CHECK_TOLERANCE_MIN, (ours.ownMin * CHECK_TOLERANCE_PCT) / 100);
  const verdict: CheckVerdict = Math.abs(diff) <= tolerance ? 'same' : diff < 0 ? 'google_faster' : 'ours_faster';
  return { verdict, routeNo: ours.routeNo, ownMin: ours.ownMin, googleMin, googleLines };
}

export interface CheckRow extends CheckResult {
  from: string;
  to: string;
  /** наші маршрути пари */
  routes: string[];
  /** найменший наш час серед маршрутів пари (коли Google не поїхав нашим) */
  ours: number;
}

export interface CheckReport {
  pairs: number;
  /** пар із відповіддю */
  answered: number;
  counts: Record<CheckVerdict, number>;
  /** по наших маршрутах: скільки пар і з якими вердиктами */
  byRoute: Array<{ routeNo: string; pairs: number; same: number; googleFaster: number; oursFaster: number; other: number }>;
  /** пари, де не збігається, — найбільша різниця вгорі */
  rows: CheckRow[];
}

/** Звіт звірки: `pairs` — пари плану з ключем `from|to` id, `answers` — відповіді за тим самим ключем */
export function checkReport(pairs: Array<{ key: string; meta: CheckMeta }>, answers: Map<string, CheckAnswer>): CheckReport {
  const counts = Object.fromEntries(CHECK_VERDICTS.map((v) => [v, 0])) as Record<CheckVerdict, number>;
  const routes = new Map<string, CheckReport['byRoute'][number]>();
  const rows: CheckRow[] = [];
  let answered = 0;
  for (const { key, meta } of pairs) {
    const answer = answers.get(key);
    const result = answer ? checkVerdict(meta, answer) : null;
    if (!result) continue;
    answered++;
    counts[result.verdict]++;
    for (const line of meta.lines) {
      const r = routes.get(line.routeNo) ?? { routeNo: line.routeNo, pairs: 0, same: 0, googleFaster: 0, oursFaster: 0, other: 0 };
      r.pairs++;
      // вердикт про час стосується лише того маршруту, яким поїхав Google
      const mine = result.routeNo === undefined || normalizeLine(result.routeNo) === normalizeLine(line.routeNo);
      if (result.verdict === 'same' && mine) r.same++;
      else if (result.verdict === 'google_faster' && mine) r.googleFaster++;
      else if (result.verdict === 'ours_faster' && mine) r.oursFaster++;
      else r.other++;
      routes.set(line.routeNo, r);
    }
    if (result.verdict !== 'same') rows.push({ ...result, from: meta.fromName, to: meta.toName, routes: meta.lines.map((l) => l.routeNo), ours: Math.min(...meta.lines.map((l) => l.ownMin)) });
  }
  const weight = (r: CheckRow) => (r.googleMin !== undefined && r.ownMin !== undefined ? Math.abs(r.googleMin - r.ownMin) : -1);
  rows.sort((a, b) => weight(b) - weight(a) || CHECK_VERDICTS.indexOf(a.verdict) - CHECK_VERDICTS.indexOf(b.verdict) || a.from.localeCompare(b.from, 'uk'));
  return {
    pairs: pairs.length,
    answered,
    counts,
    byRoute: [...routes.values()].sort((a, b) => a.routeNo.localeCompare(b.routeNo, 'uk', { numeric: true })),
    rows: rows.slice(0, 200),
  };
}
