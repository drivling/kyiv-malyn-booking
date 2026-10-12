/**
 * Синтез GTFS stop_times для одного рейсу: ланцюжок рейсу (основний напрямку або варіант шляху), зріз [start..end],
 * сегменти маршруту, пропорційне стиснення під arrivalTime або опорні часи (спільна логіка з сайтом — ./trip-timing).
 */
import type { TransportRouteStopInput, TransportRouteVariantInput, TransportTripInput } from './local-transport';
import { computeTripTiming, parseClockMins, parseTimepoints, roundMonotonic, type SegSecFn } from './trip-timing';

export const DEFAULT_SEC = 120;
export const FALLBACK_MINS = 2;

export type Direction = 'there' | 'back';

export function toGtfsTime(raw: string | null | undefined): string | null {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, '0');
  return `${hh}:${m[2]}:${m[3] || '00'}`;
}

export function minutesToGtfs(mins: number): string {
  const total = Math.max(0, Math.round(mins));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

export function parseMinutes(gtfsTime: string): number {
  const m = gtfsTime.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** direction_id "1" = туди (orderThere), інакше назад (orderBack) */
export function tripDirection(directionId: string | undefined | null): Direction {
  return String(directionId) === '1' ? 'there' : 'back';
}

export function orderedPassengerStops(stops: TransportRouteStopInput[], direction: Direction) {
  const key = direction === 'there' ? 'orderThere' : 'orderBack';
  return stops
    .filter((s) => !s.mapOnly && (s[key] ?? -1) > 0)
    .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}

export function orderedAllStops(stops: TransportRouteStopInput[], direction: Direction) {
  const key = direction === 'there' ? 'orderThere' : 'orderBack';
  return stops
    .filter((s) => (s[key] ?? -1) > 0)
    .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}

/** Ланцюжок рейсу: варіант шляху (variantId того самого напрямку) або основний ланцюжок напрямку. */
export function resolveTripChain(
  trip: TransportTripInput,
  routeStops: TransportRouteStopInput[],
  variants: TransportRouteVariantInput[] = []
): { direction: Direction; chainKeys: string[]; passengerSet: Set<string>; variantId: string | null } {
  const direction = tripDirection(trip.directionId);
  const variant = trip.variantId
    ? variants.find((v) => v.id === trip.variantId && tripDirection(v.directionId) === direction)
    : undefined;
  if (variant) {
    return {
      direction,
      chainKeys: variant.stops.map((p) => p.stopId),
      passengerSet: new Set(variant.stops.filter((p) => !p.mapOnly).map((p) => p.stopId)),
      variantId: variant.id,
    };
  }
  return {
    direction,
    chainKeys: orderedAllStops(routeStops, direction).map((s) => s.stopId),
    passengerSet: new Set(orderedPassengerStops(routeStops, direction).map((s) => s.stopId)),
    variantId: null,
  };
}

/**
 * Тривалість перегону для маршруту: прямий ключ, зворотний ключ, defaultSec.
 * Маршрут без жодного сегмента — плоскі FALLBACK_MINS на перегін.
 */
export function makeSegSec(segments: Record<string, number>, defaultSec: number, routeId: string): SegSecFn {
  const prefix = `${routeId}|`;
  const hasRouteSegments = Object.keys(segments).some((k) => k.startsWith(prefix));
  if (!hasRouteSegments) return () => FALLBACK_MINS * 60;
  return (a, b) => segments[`${prefix}${a}|${b}`] ?? segments[`${prefix}${b}|${a}`] ?? defaultSec;
}

export interface StopTimeRow {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: number;
  timepoint: 0 | 1;
}

export interface TripStopTimes {
  rows: StopTimeRow[];
  direction: Direction;
  /** Варіант шляху рейсу; null — основний ланцюжок напрямку */
  variantId: string | null;
  /** Повний ланцюжок рейсу (з технічними точками) */
  chainKeys: string[];
  startIndex: number;
  endIndex: number;
  startStopId: string;
  endStopId: string;
  factor: number;
}

/**
 * stop_times рейсу або null, якщо рейс без часу / зріз не має ≥2 пасажирських зупинок.
 * knownStopIds — зупинки, що є в датасеті (без координат у фід не потрапляють).
 */
export function buildTripStopTimes(
  trip: TransportTripInput,
  routeStops: TransportRouteStopInput[],
  segments: Record<string, number>,
  defaultSec: number,
  knownStopIds: Set<string>,
  variants: TransportRouteVariantInput[] = []
): TripStopTimes | null {
  const dep = toGtfsTime(trip.departureTime);
  if (!dep) return null;
  const { direction, chainKeys, passengerSet, variantId } = resolveTripChain(trip, routeStops, variants);
  const arrivalMins = parseClockMins(trip.arrivalTime);
  const timepoints = parseTimepoints(trip.timepoints);
  const timing = computeTripTiming(chainKeys, makeSegSec(segments, defaultSec, trip.routeId), {
    departureMins: parseMinutes(dep),
    arrivalMins,
    startStopId: trip.startStopId || null,
    endStopId: trip.endStopId || null,
    timepoints,
  });
  if (!timing) return null;

  const served = timing.stops.filter((s) => passengerSet.has(s.stopId) && knownStopIds.has(s.stopId));
  if (served.length < 2) return null;

  const rounded = roundMonotonic(served.map((s) => s.mins));
  const fixedIndexes = new Set(timing.timepointIndexes);
  const fixedArrival = !fixedIndexes.size && arrivalMins != null && !timing.arrivalIgnored;
  const rows: StopTimeRow[] = served.map((s, i) => {
    const t = minutesToGtfs(rounded[i]);
    const last = i === served.length - 1;
    return {
      trip_id: trip.id,
      arrival_time: t,
      departure_time: t,
      stop_id: s.stopId,
      stop_sequence: i + 1,
      timepoint: i === 0 || fixedIndexes.has(s.index) || (last && fixedArrival) ? 1 : 0,
    };
  });

  return {
    rows,
    direction,
    variantId,
    chainKeys,
    startIndex: timing.startIndex,
    endIndex: timing.endIndex,
    startStopId: chainKeys[timing.startIndex],
    endStopId: chainKeys[timing.endIndex],
    factor: timing.factor,
  };
}
