import type { TransportTripDto } from '@/api/transportDataset';

/** Коротка статистика маршруту для картки на схемі (/transport/scheme). */
export type RouteScheduleStats = {
  /** Рейсів на день у кожен бік: «14» або «10–11», коли напрямки різняться */
  tripsPerDirection: string;
  /** Перше відправлення, «6:40» */
  first: string;
  /** Останнє відправлення, «18:30» */
  last: string;
};

function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? `${Number(m[1])}:${m[2]}` : hhmm;
}

/**
 * Та сама логіка, що й у генераторі схеми (Docs/malyn-transit-scheme/build_scheme.py):
 * рейси рахуються по напрямках, перший/останній — за departureTime. Без розкладу → null.
 */
export function routeScheduleStats(trips: TransportTripDto[], routeId: string): RouteScheduleStats | null {
  const own = trips.filter((t) => t.routeId === routeId);
  const times = own
    .map((t) => (t.departureTime || '').slice(0, 5))
    .filter((t) => /^\d{2}:\d{2}$/.test(t))
    .sort();
  if (!times.length) return null;
  const perDirection = new Map<string, number>();
  for (const t of own) {
    const dir = t.directionId ?? '';
    perDirection.set(dir, (perDirection.get(dir) ?? 0) + 1);
  }
  const counts = [...perDirection.values()].sort((a, b) => a - b);
  const min = counts[0];
  const max = counts[counts.length - 1];
  return {
    tripsPerDirection: min === max ? String(min) : `${min}–${max}`,
    first: clock(times[0]),
    last: clock(times[times.length - 1]),
  };
}
