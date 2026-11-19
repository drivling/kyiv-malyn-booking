/**
 * Міська електричка Києва (Kyiv City Express) — розклад і пошук рейсу (Docs/dovede-roadmap.md, «Міська електричка
 * Києва»). Кільце з 20 станцій: рейси «А» їдуть за годинниковою стрілкою, «Б» — проти, обидва починають і
 * закінчують на Святошині; «Д» — додаткові півкільцем Почайна — Дарниця — Видубичі між берегами.
 *
 * Розклад — `kyivRingTimetable.json`: його пише `npm run dovede:ring` зі знімка `data/kyiv-city-express/` (не
 * правити руками). Час на станції — відправлення; на Дарниці (стоянка до 10 хв) для рейсів «Д» відоме й прибуття.
 * Рейси з `extra` діють лише в оголошені дні (`from` … `to`), після них самі зникають з відповідей. Дні власник може
 * змінити в адмінці без деплою («Налаштування» → «Дані сторінки», `ring.extra`): `applyRingData`.
 * Ціна — 30 грн у застосунку (з 22.07.2026; у касі й терміналі дорожче). На відміну від метро, час тут точний.
 */
import { RING_STATIONS, type RingStation } from '../nlu/kyivRingData';
import { ringStation } from '../nlu/kyivRing';
import timetable from './kyivRingTimetable.json';

export interface RingTrain {
  no: string;
  dir: 'cw' | 'ccw';
  days: 'daily' | 'weekdays';
  extra?: boolean;
  /** рейс діє з цієї дати (і з цієї хвилини першого дня) до `to` включно */
  from?: string;
  fromMins?: number;
  to?: string;
  /** [індекс станції, відправлення хв] або [індекс, відправлення, прибуття] */
  stops: number[][];
}

export const RING_TRAINS = timetable.trains as RingTrain[];

export const RING_SERVICE = {
  checkedAt: timetable.checkedAt,
  fareUah: 30,
  /** запас перед посадкою: знайти платформу, показати квиток */
  boardBufferMin: 4,
} as const;

/** Кольори — як на схемі перевізника: кільце помаранчеве, додаткові рейси між берегами сині */
export const RING_COLOR = { main: '#f39a1e', extra: '#1d2a8f', ink: '#3b2300' } as const;

const BY_SLUG = new Map(RING_STATIONS.map((st) => [st.slug, st]));
/** станція за індексом розкладу */
const AT: RingStation[] = timetable.stations.map((slug) => {
  const st = BY_SLUG.get(slug);
  if (!st) throw new Error(`kyivRing: у розкладі невідома станція ${slug}`);
  return st;
});
const INDEX = new Map(AT.map((st, i) => [st.id, i]));

/** Станції кільця за годинниковою стрілкою, як у розкладі */
export const RING_ORDER: readonly RingStation[] = AT;

export interface RingRide {
  /** номер рейсу: «А14», «Д10» */
  train: string;
  dir: 'cw' | 'ccw';
  /** додатковий рейс (діє лише в оголошені дні) */
  extra: boolean;
  /** останній день додаткового рейсу, 'YYYY-MM-DD' */
  validTo: string | null;
  from: RingStation;
  to: RingStation;
  depMins: number;
  arrMins: number;
  /** усі станції від посадки до виходу включно, з часом */
  stops: Array<{ station: RingStation; mins: number }>;
}

function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Дні додаткових рейсів з адмінки; undefined — як у розкладі, null — додаткових рейсів немає */
let extraWindow: { from: string; fromMins: number; to: string } | null | undefined;

const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Дані з адмінки (`GET /dovede/page-data`, лише змінені): `ring.extra` — `{ from, fromTime?, to }` або null */
export function applyRingData(values: Record<string, unknown>): void {
  if (!('ring.extra' in values)) return;
  const v = values['ring.extra'];
  if (v === null) {
    extraWindow = null;
    return;
  }
  const o = v as { from?: unknown; to?: unknown; fromTime?: unknown };
  if (!o || !isoDate(o.from) || !isoDate(o.to) || o.to < o.from) return;
  const m = typeof o.fromTime === 'string' ? /^(\d{2}):(\d{2})$/.exec(o.fromTime) : null;
  extraWindow = { from: o.from, to: o.to, fromMins: m ? Number(m[1]) * 60 + Number(m[2]) : 0 };
}

/** Назад до розкладу (тести) */
export function resetRingData(): void {
  extraWindow = undefined;
}

/** Дні, коли рейс діє: для додаткових — з адмінки, якщо там змінено; null — рейс не діє зовсім */
export function ringTrainWindow(t: RingTrain): { from?: string; fromMins?: number; to?: string } | null {
  if (!t.extra || extraWindow === undefined) return { from: t.from, fromMins: t.fromMins, to: t.to };
  return extraWindow;
}

/** Чи їде рейс цього дня (і чи вже діє о цій хвилині — для першого дня додаткових рейсів) */
export function ringTrainRuns(t: RingTrain, isoDate: string, depMins: number): boolean {
  const wd = weekdayOf(isoDate);
  if (t.days === 'weekdays' && (wd === 0 || wd === 6)) return false;
  const w = ringTrainWindow(t);
  if (!w) return false;
  if (w.from && (isoDate < w.from || (isoDate === w.from && depMins < (w.fromMins ?? 0)))) return false;
  if (w.to && isoDate > w.to) return false;
  return true;
}

function rideOn(t: RingTrain, a: number, b: number): RingRide | null {
  // Святошин у повному колі стоїть двічі (початок і кінець): беремо найкоротший відрізок «спершу a, потім b»
  let best: [number, number] | null = null;
  t.stops.forEach(([sa], i) => {
    if (sa !== a) return;
    const j = t.stops.findIndex(([sb], k) => k > i && sb === b);
    if (j > i && (!best || j - i < best[1] - best[0])) best = [i, j];
  });
  if (!best) return null;
  const [i, j] = best as [number, number];
  const stops = t.stops.slice(i, j + 1).map(([si, dep, arr], k, all) => ({ station: AT[si], mins: k === all.length - 1 ? arr ?? dep : dep }));
  return { train: t.no, dir: t.dir, extra: Boolean(t.extra), validTo: ringTrainWindow(t)?.to ?? null, from: AT[a], to: AT[b], depMins: stops[0].mins, arrMins: stops[stops.length - 1].mins, stops };
}

/**
 * Усі поїздки між двома станціями кільця за день, за часом відправлення. Їхати можна в обидва боки кільця, тому
 * поїздка, яку інша обганяє (виїжджає не раніше, а приїжджає не пізніше), відкидається.
 */
export function ringRides(fromId: string, toId: string, isoDate: string): RingRide[] {
  const a = INDEX.get(fromId);
  const b = INDEX.get(toId);
  if (a == null || b == null || a === b) return [];
  const all = RING_TRAINS.map((t) => rideOn(t, a, b)).filter((r, i): r is RingRide => r != null && ringTrainRuns(RING_TRAINS[i], isoDate, r.depMins));
  const best = all.filter((r) => !all.some((o) => o !== r && o.depMins >= r.depMins && o.arrMins <= r.arrMins && (o.depMins > r.depMins || o.arrMins < r.arrMins)));
  return best.sort((x, y) => x.depMins - y.depMins || x.arrMins - y.arrMins);
}

/** Найближчий рейс, що вирушає не раніше `afterMins` */
export function nextRingRide(fromId: string, toId: string, isoDate: string, afterMins: number): RingRide | null {
  return ringRides(fromId, toId, isoDate).find((r) => r.depMins >= afterMins) ?? null;
}

/** Останній рейс, що прибуває не пізніше `beforeMins` */
export function lastRingRide(fromId: string, toId: string, isoDate: string, beforeMins: number): RingRide | null {
  const fit = ringRides(fromId, toId, isoDate).filter((r) => r.arrMins <= beforeMins);
  return fit[fit.length - 1] ?? null;
}

/** Відправлення наступних рейсів тієї ж пари після цього (хв), не більше `n` */
export function laterRingDepartures(ride: RingRide, isoDate: string, n = 3): number[] {
  return ringRides(ride.from.id, ride.to.id, isoDate)
    .filter((r) => r.depMins > ride.depMins)
    .slice(0, n)
    .map((r) => r.depMins);
}

/** Чи станція лежить на лівому березі (між Почайною й Видубичами за годинниковою) — для підпису «через Дніпро» */
export function ringLeftBank(id: string): boolean {
  const i = INDEX.get(id);
  const a = INDEX.get('kyiv.e.pochaina')!;
  const b = INDEX.get('kyiv.e.vydubychi')!;
  return i != null && i > a && i < b;
}

export { ringStation };
