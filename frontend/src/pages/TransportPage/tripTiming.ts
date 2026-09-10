/**
 * Час рейсу по зупинках: зріз ланцюжка [start..end], сума сегментів,
 * пропорційне стиснення під фіксований час прибуття на останню обслуговувану зупинку.
 *
 * MIRROR: keep byte-identical with backend/src/trip-timing.ts
 * (frontend copy: frontend/src/pages/TransportPage/tripTiming.ts). Чистий модуль без імпортів.
 */

/** Тривалість перегону між двома сусідніми ключами ланцюжка (секунди). */
export type SegSecFn = (fromStopId: string, toStopId: string) => number;

export interface TripTimingInput {
  /** Хвилини від півночі — відправлення з першої обслуговуваної зупинки */
  departureMins: number;
  /** Фіксований час (хвилини від півночі) на останній обслуговуваній зупинці; null — за сегментами */
  arrivalMins?: number | null;
  /** Перша обслуговувана зупинка; null/порожньо — перша в напрямку */
  startStopId?: string | null;
  /** Остання обслуговувана зупинка; null/порожньо — остання в напрямку */
  endStopId?: string | null;
}

export interface TripStopTime {
  stopId: string;
  /** Позиція у chainKeys */
  index: number;
  /** Хвилини від півночі (дробові) */
  mins: number;
}

export interface TripTiming {
  /** Обслуговувані ключі ланцюжка у порядку руху (технічні точки теж — фільтрує викликач) */
  stops: TripStopTime[];
  startIndex: number;
  endIndex: number;
  /** Сума сегментів зрізу без стиснення (сек) */
  neededSec: number;
  /** (arrival − departure) у секундах, або null коли прибуття не задано */
  availableSec: number | null;
  /** availableSec / neededSec, коли сегменти не вкладаються у вікно; інакше 1 (не розтягуємо) */
  factor: number;
  /** arrivalMins задано, але ≤ departureMins — проігноровано */
  arrivalIgnored: boolean;
  minsByStop: Record<string, number>;
}

/** HH:MM або HH:MM:SS → хвилини від півночі; інакше null. Секунди відкидаються. */
export function parseClockMins(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null;
  return h * 60 + min;
}

/**
 * Обчислити час на кожній обслуговуваній зупинці рейсу.
 * null — коли ланцюжок коротший за 2, start/end не в ланцюжку або start не раніше end.
 */
export function computeTripTiming(
  chainKeys: string[],
  segSec: SegSecFn,
  trip: TripTimingInput
): TripTiming | null {
  if (chainKeys.length < 2) return null;
  const startIndex = trip.startStopId ? chainKeys.indexOf(trip.startStopId) : 0;
  const endIndex = trip.endStopId ? chainKeys.indexOf(trip.endStopId) : chainKeys.length - 1;
  if (startIndex < 0 || endIndex < 0 || startIndex >= endIndex) return null;

  const cum: number[] = [0];
  for (let i = startIndex; i < endIndex; i++) {
    const sec = Number(segSec(chainKeys[i], chainKeys[i + 1]));
    cum.push(cum[cum.length - 1] + (Number.isFinite(sec) && sec > 0 ? sec : 0));
  }
  const neededSec = cum[cum.length - 1];
  const availableSec =
    trip.arrivalMins == null ? null : (trip.arrivalMins - trip.departureMins) * 60;
  const arrivalIgnored = availableSec != null && availableSec <= 0;
  const factor =
    availableSec != null && availableSec > 0 && neededSec > availableSec ? availableSec / neededSec : 1;

  const stops: TripStopTime[] = [];
  const minsByStop: Record<string, number> = {};
  for (let k = 0; k < cum.length; k++) {
    const index = startIndex + k;
    const mins = trip.departureMins + (cum[k] * factor) / 60;
    stops.push({ stopId: chainKeys[index], index, mins });
    minsByStop[chainKeys[index]] = mins;
  }
  return { stops, startIndex, endIndex, neededSec, availableSec, factor, arrivalIgnored, minsByStop };
}

/** Хвилини на зупинці або null, якщо рейс її не обслуговує. */
export function minutesAtStop(timing: TripTiming | null | undefined, stopId: string): number | null {
  if (!timing) return null;
  return Object.prototype.hasOwnProperty.call(timing.minsByStop, stopId) ? timing.minsByStop[stopId] : null;
}

/** Чи рейс обслуговує обидві зупинки і fromId раніше за toId. */
export function tripServesPair(timing: TripTiming | null | undefined, fromId: string, toId: string): boolean {
  if (!timing || fromId === toId) return false;
  const from = timing.stops.find((s) => s.stopId === fromId);
  const to = timing.stops.find((s) => s.stopId === toId);
  return !!from && !!to && from.index < to.index;
}

/** Округлення до хвилин з гарантією неспадання (для GTFS stop_times). */
export function roundMonotonic(mins: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < mins.length; i++) {
    const r = Math.round(mins[i]);
    out.push(i > 0 && r < out[i - 1] ? out[i - 1] : r);
  }
  return out;
}
