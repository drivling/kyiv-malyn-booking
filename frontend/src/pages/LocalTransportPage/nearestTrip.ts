/**
 * Найближчий рейс маршруту за часом — для картки планувальника і сторінки маршруту.
 * Без контексту `at` — за відправленням з кінцевої; з `at` — за часом на зупинці «З»
 * (з урахуванням start/end/arrival рейсу), і рейс має обслуговувати пару З→До.
 */
import type { TransportRecord } from './types';
import { recordTiming } from './routeTiming';
import { minutesAtStop, tripServesPair } from '../TransportPage/tripTiming';
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

export function findNearestTrip(
  trips: TransportRecord[],
  nowMins: number,
  directionFilter?: 'there' | 'back',
  at?: NearestTripAt
): NearestTrip | null {
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
  // Якщо майбутніх немає — беремо перший зранку і позначаємо це (wrapped)
  const pick = (list: Candidate[]): (Candidate & { wrapped: boolean }) | null => {
    const future = list.find((c) => c.timeAtFrom >= nowMins);
    if (future) return { ...future, wrapped: false };
    return list[0] ? { ...list[0], wrapped: true } : null;
  };
  const next0 = directionFilter === 'there' ? null : pick(candidates(dir0, 'back'));
  const next1 = directionFilter === 'back' ? null : pick(candidates(dir1, 'there'));
  if (next0 == null && next1 == null) return null;
  if (next0 == null) return { ...next1!, direction: 'there' };
  if (next1 == null) return { ...next0, direction: 'back' };
  // Хто ближчий за часом (якщо обидва в минулому — хто перший зранку)
  const dist0 = (next0.timeAtFrom - nowMins + 24 * 60) % (24 * 60);
  const dist1 = (next1.timeAtFrom - nowMins + 24 * 60) % (24 * 60);
  return dist1 <= dist0 ? { ...next1, direction: 'there' } : { ...next0, direction: 'back' };
}
