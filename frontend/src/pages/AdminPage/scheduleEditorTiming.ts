/**
 * Чисті обчислення для ScheduleEditorTab: час на зупинці = departureTime рейсу +
 * сума TransportSegment.seconds від першої обслуговуваної зупинки (той самий алгоритм,
 * що й на публічній сторінці — див. ../TransportPage/tripTiming.ts).
 */
import type { TransportSegmentDto, TransportTripDto } from '@/api/transportDataset';
import { computeTripTiming, minutesAtStop, type TripTiming } from '../TransportPage/tripTiming';

export const FALLBACK_DEFAULT_SEGMENT_SEC = 120;

export function parseClockToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

export function formatMinutesToClock(totalMinutes: number): string {
  const mins = Math.round(totalMinutes);
  const h = Math.floor(mins / 60) % 24;
  const m = ((mins % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildSegmentLookup(segments: TransportSegmentDto[]): Record<string, number> {
  const lookup: Record<string, number> = {};
  for (const seg of segments) {
    lookup[`${seg.routeId}|${seg.fromStopId}|${seg.toStopId}`] = seg.seconds;
  }
  return lookup;
}

export function getSegmentDurationSec(
  lookup: Record<string, number>,
  routeId: string,
  fromStopId: string,
  toStopId: string,
  defaultSec: number
): number {
  const key1 = `${routeId}|${fromStopId}|${toStopId}`;
  const key2 = `${routeId}|${toStopId}|${fromStopId}`;
  return lookup[key1] ?? lookup[key2] ?? defaultSec;
}

/**
 * Час рейсу по зупинках ланцюжка напрямку (з технічними точками): start/end/arrival рейсу
 * враховано; null — рейс без departureTime або поганий зріз.
 */
export function computeTripTimes(
  trip: TransportTripDto,
  lookup: Record<string, number>,
  routeId: string,
  chainStopIds: string[],
  defaultSec: number
): TripTiming | null {
  const departureMins = parseClockToMinutes(trip.departureTime);
  if (departureMins == null) return null;
  return computeTripTiming(
    chainStopIds,
    (from, to) => getSegmentDurationSec(lookup, routeId, from, to, defaultSec),
    {
      departureMins,
      arrivalMins: parseClockToMinutes(trip.arrivalTime),
      startStopId: trip.startStopId || null,
      endStopId: trip.endStopId || null,
    }
  );
}

/** HH:MM на зупинці або null, якщо рейс її не обслуговує / без часу. */
export function clockAtStop(timing: TripTiming | null | undefined, stopId: string): string | null {
  const m = minutesAtStop(timing, stopId);
  return m == null ? null : formatMinutesToClock(m);
}

/**
 * Табличка при зміні кінцевої: порожню або таку, що дорівнює попередній кінцевій, замінюємо назвою
 * нової зупинки; власний текст («Малинівка, Юрівка, БАМ») лишаємо.
 */
export function autoHeadsign(current: string | undefined, prevEndName: string | null, nextEndName: string): string {
  const cur = (current || '').trim();
  if (!cur || (prevEndName && cur === prevEndName.trim())) return nextEndName;
  return current || '';
}

/**
 * Найближче пізніше відправлення того ж маршруту у зворотному напрямку (HH:MM) —
 * підказка для «Прибуття» (у друкованих розкладах це час виїзду з кінцевої назад).
 */
export function nextOppositeDeparture(trips: TransportTripDto[], trip: TransportTripDto): string | null {
  const dep = parseClockToMinutes(trip.departureTime);
  if (dep == null) return null;
  const thisDir = trip.directionId === '0' ? '0' : '1';
  let best: number | null = null;
  for (const t of trips) {
    if (t.routeId !== trip.routeId || t.id === trip.id) continue;
    if ((t.directionId === '0' ? '0' : '1') === thisDir) continue;
    const m = parseClockToMinutes(t.departureTime);
    if (m == null || m <= dep) continue;
    if (best == null || m < best) best = m;
  }
  return best == null ? null : formatMinutesToClock(best);
}

/** Рейси без departureTime йдуть в кінець; далі сортування за часом, потім за id. */
export function compareTripsByDeparture(a: TransportTripDto, b: TransportTripDto): number {
  const ma = parseClockToMinutes(a.departureTime);
  const mb = parseClockToMinutes(b.departureTime);
  if (ma == null && mb == null) return a.id.localeCompare(b.id);
  if (ma == null) return 1;
  if (mb == null) return -1;
  if (ma !== mb) return ma - mb;
  return a.id.localeCompare(b.id);
}

/** Наступний вільний id рейсу для маршруту у форматі "{routeId}-{NN}" (обидва напрямки разом). */
export function nextTripId(routeId: string, trips: TransportTripDto[]): string {
  const prefix = `${routeId}-`;
  let maxNum = 0;
  for (const t of trips) {
    if (t.routeId !== routeId || !t.id.startsWith(prefix)) continue;
    const num = Number(t.id.slice(prefix.length));
    if (Number.isFinite(num) && num > maxNum) maxNum = num;
  }
  return `${prefix}${String(maxNum + 1).padStart(2, '0')}`;
}
