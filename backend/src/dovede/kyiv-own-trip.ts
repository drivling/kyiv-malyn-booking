/**
 * «Доведе» · поїздка Києвом однією лінією «Київпастрансу» без Google (Docs/dovede-learning-roadmap.md, крок 8б-2).
 *
 * У Києві ні точки «словами», ні станції метро не мають у нас координат. Але збережені відповіді Google уже знають, з
 * якої зупинки сідають біля точки A (будь-куди) і на якій виходять біля місця B (звідки завгодно), і скільки до них
 * іти. Ці «половинки» плюс свій розклад КПТ дають нову дорогу A → B: пішки → лінія КПТ → пішки. Як Житомир — без
 * точного часу відправлення: «кожні ≈ N хв», очікування — пів інтервалу. Чиста функція.
 */
import { distanceM } from '../korosten-osm';
import type { CityStep } from './city-route';
import type { KptData, KptDir } from './kyiv-kpt';
import { KYIV_KPT } from './kyiv-kpt-data';
import { along, clock, departures, isWeekend, offsetAt, projectOnDir } from './kyiv-own-lines';

/** Зупинка Google далі від ламаної контрольних точок — не на цій лінії */
export const OWN_TRIP_NEAR_M = 300;
/** Іти до зупинки чи від неї довше — це вже не «біля місця» */
export const OWN_TRIP_MAX_WALK_MIN = 15;
/** Чекати першого рейсу довше — краще спитати Google */
const MAX_WAIT_MIN = 60;

/** Половинка збереженої дороги: зупинка біля точки й скільки до неї (від неї) іти */
export interface TripHalf {
  stop: string;
  lat: number;
  lng: number;
  walkMin: number;
  walkM: number;
  /** коли Google це дав (ISO) */
  fetchedAt: string;
}

export interface OwnTripQuery {
  /** зупинки посадки біля точки A і висадки біля місця B */
  starts: TripHalf[];
  ends: TripHalf[];
  /** 'YYYY-MM-DD' і 'HH:MM' за Києвом */
  date: string;
  time: string;
}

export interface OwnTrip {
  steps: CityStep[];
  minutes: number;
  /** найстаріша з двох половинок — «перевірено N днів тому» */
  fetchedAt: string;
}

/** Кроки однієї збереженої відповіді → посадка першої поїздки й висадка останньої (з пішим підходом) */
export function halvesOf(steps: CityStep[]): { start: { stop: string; walkMin: number; walkM: number } | null; end: { stop: string; walkMin: number; walkM: number } | null } {
  const rides = steps.map((s, i) => [s, i] as const).filter(([s]) => s.kind === 'transit');
  if (!rides.length) return { start: null, end: null };
  const [first, fi] = rides[0];
  const [last, li] = rides[rides.length - 1];
  const before = steps.slice(0, fi).filter((s) => s.kind === 'walk');
  const after = steps.slice(li + 1).filter((s) => s.kind === 'walk');
  const sum = (xs: CityStep[], k: 'minutes' | 'meters') => xs.reduce((n, s) => n + (s[k] ?? 0), 0);
  return {
    start: first.fromStop ? { stop: first.fromStop, walkMin: sum(before, 'minutes'), walkM: sum(before, 'meters') } : null,
    end: last.toStop ? { stop: last.toStop, walkMin: sum(after, 'minutes'), walkM: sum(after, 'meters') } : null,
  };
}

/** Найшвидша поїздка однією лінією КПТ між якоюсь стартовою й якоюсь кінцевою зупинкою; null — своїми даними не доїхати */
export function ownKyivTrip(q: OwnTripQuery, data: KptData = KYIV_KPT): OwnTrip | null {
  const starts = q.starts.filter((h) => h.walkMin <= OWN_TRIP_MAX_WALK_MIN);
  const ends = q.ends.filter((h) => h.walkMin <= OWN_TRIP_MAX_WALK_MIN);
  if (!starts.length || !ends.length) return null;
  const start = Number(q.time.slice(0, 2)) * 60 + Number(q.time.slice(3, 5));
  const weekend = isWeekend(q.date);
  let best: (OwnTrip & { total: number }) | null = null;
  for (const dir of data.dirs) {
    if (!dir.id.endsWith('/0')) continue;
    const deps = departures(dir, weekend);
    if (!deps.length) continue;
    for (const a of starts) {
      const pa = projectOnDir(dir, a);
      if (!pa || pa.off > OWN_TRIP_NEAR_M) continue;
      // підхід до лінії від зупинки Google — пішки по прямій
      const walkA = a.walkMin + Math.ceil(pa.off / 75);
      const boardAt = start + walkA;
      const hour = Math.floor(boardAt / 60) % 24;
      const offA = offsetAt(dir, pa, hour);
      const at = deps.map((d) => d + offA);
      const next = at.findIndex((t) => t >= boardAt);
      if (next < 0 || at[next] - boardAt > MAX_WAIT_MIN) continue;
      const gaps = [next > 0 ? at[next] - at[next - 1] : null, next + 1 < at.length ? at[next + 1] - at[next] : null].filter((g): g is number => g != null && g > 0);
      const headway = gaps.length ? Math.max(1, Math.round(gaps.reduce((n, g) => n + g, 0) / gaps.length)) : null;
      const wait = headway ? Math.ceil(headway / 2) : at[next] - boardAt;
      for (const b of ends) {
        const pb = projectOnDir(dir, b);
        if (!pb || pb.off > OWN_TRIP_NEAR_M || along(dir, pa) >= along(dir, pb)) continue;
        // стартова й кінцева зупинки поруч — їхати нема чого
        if (distanceM(a, b) < 400) continue;
        const ride = Math.round(offsetAt(dir, pb, hour) - offA);
        if (ride < 1) continue;
        const walkB = b.walkMin + Math.ceil(pb.off / 75);
        const total = walkA + wait + ride + walkB;
        if (best && best.total <= total) continue;
        const last = at[at.length - 1];
        best = {
          total,
          minutes: total,
          fetchedAt: a.fetchedAt < b.fetchedAt ? a.fetchedAt : b.fetchedAt,
          steps: tripSteps(dir, a, b, walkA, walkB, ride, headway, last - boardAt <= 60 ? clock(last) : null),
        };
      }
    }
  }
  if (!best) return null;
  return { steps: best.steps, minutes: best.minutes, fetchedAt: best.fetchedAt };
}

function tripSteps(dir: KptDir, a: TripHalf, b: TripHalf, walkA: number, walkB: number, ride: number, headway: number | null, lastDeparts: string | null): CityStep[] {
  const steps: CityStep[] = [];
  if (walkA >= 1) steps.push({ kind: 'walk', minutes: walkA, meters: Math.round((a.walkM || walkA * 75) / 10) * 10 });
  steps.push({
    kind: 'transit',
    minutes: ride,
    mode: dir.mode,
    line: dir.no,
    headsign: dir.points[dir.points.length - 1][0],
    fromStop: a.stop,
    toStop: b.stop,
    own: true,
    ...(headway ? { headwayMin: headway } : {}),
    ...(lastDeparts ? { lastDeparts } : {}),
  });
  if (walkB >= 1) steps.push({ kind: 'walk', minutes: walkB, meters: Math.round((b.walkM || walkB * 75) / 10) * 10 });
  return steps;
}
