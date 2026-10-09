/**
 * Найближчий рейс маршруту за часом — для картки планувальника і сторінки маршруту.
 * Без контексту `at` — за відправленням з кінцевої; з `at` — за часом на зупинці «З»
 * (з урахуванням start/end/arrival рейсу), і рейс має обслуговувати пару З→До.
 */
import type { TransportRecord } from './types';
import { recordTiming } from './routeTiming';
import { minutesAtStop, tripServesPair } from './dataset/tripTiming';
import { groupTripsByDirection, tripDepartureMinutes } from './tripDeparture';

/** Контекст «на зупинці»: час рейсу рахується на fromStop, рейс має обслуговувати пару З→До */
export type NearestTripAt = {
  routeId: string;
  chainKeys: { there: string[]; back: string[] };
  fromStop: string;
  toStop?: string;
};

export type NearestTrip = {
  /** Відправлення з кінцевої, хв від півночі */
  time: number;
  /** Час на зупинці «З» (без контексту дорівнює `time`) */
  timeAtFrom: number;
  /** Час на зупинці «До» — лише коли в контексті є `toStop` */
  timeAtTo: number | null;
  direction: 'there' | 'back';
  /** Після `nowMins` рейсів немає — показано перший рейс дня (тобто наступного дня) */
  wrapped: boolean;
  record: TransportRecord;
};

type Candidate = { time: number; timeAtFrom: number; timeAtTo: number | null; record: TransportRecord };

type Upcoming = Candidate & { wrapped: boolean; direction: 'there' | 'back' };

/**
 * Найближчі рейси за часом (для картки «далі 09:40 · 10:55»): майбутні рейси обох напрямків у порядку
 * відстані від `nowMins`, далі — рейси з початку дня як «наступного дня» (wrapped), без повторів.
 * Перший елемент — те саме, що повертає findNearestTrip.
 */
export function findUpcomingTrips(
  trips: TransportRecord[],
  nowMins: number,
  directionFilter?: 'there' | 'back',
  at?: NearestTripAt,
  limit = 3
): NearestTrip[] {
  const { dir0, dir1 } = groupTripsByDirection(trips);
  const candidates = (list: TransportRecord[], dir: 'there' | 'back'): Candidate[] =>
    list
      .map((t): Candidate | null => {
        const base = tripDepartureMinutes(t);
        if (base <= 0) return null;
        if (!at) return { time: base, timeAtFrom: base, timeAtTo: null, record: t };
        const timing = recordTiming(at.routeId, at.chainKeys[dir], t);
        if (at.toStop ? !tripServesPair(timing, at.fromStop, at.toStop) : minutesAtStop(timing, at.fromStop) == null) {
          return null;
        }
        const m = minutesAtStop(timing, at.fromStop);
        if (m == null) return null;
        const mTo = at.toStop ? minutesAtStop(timing, at.toStop) : null;
        return { time: base, timeAtFrom: m, timeAtTo: mTo ?? null, record: t };
      })
      .filter((c): c is Candidate => c != null)
      .sort((a, b) => a.timeAtFrom - b.timeAtFrom);
  const DAY = 24 * 60;
  const withDist = (list: Candidate[], direction: 'there' | 'back'): Array<Upcoming & { dist: number; rank: number }> =>
    list.map((c) => ({
      ...c,
      direction,
      wrapped: c.timeAtFrom < nowMins,
      dist: (c.timeAtFrom - nowMins + DAY) % DAY,
      rank: direction === 'there' ? 0 : 1,
    }));
  const all = [
    ...(directionFilter === 'there' ? [] : withDist(candidates(dir0, 'back'), 'back')),
    ...(directionFilter === 'back' ? [] : withDist(candidates(dir1, 'there'), 'there')),
  ].sort((a, b) => a.dist - b.dist || a.rank - b.rank);
  return all.slice(0, limit).map((c) => ({ time: c.time, timeAtFrom: c.timeAtFrom, timeAtTo: c.timeAtTo, direction: c.direction, wrapped: c.wrapped, record: c.record }));
}

export function findNearestTrip(
  trips: TransportRecord[],
  nowMins: number,
  directionFilter?: 'there' | 'back',
  at?: NearestTripAt
): NearestTrip | null {
  return findUpcomingTrips(trips, nowMins, directionFilter, at, 1)[0] ?? null;
}
