/**
 * Чисті обчислення для ScheduleEditorTab: час на зупинці = departureTime рейсу +
 * сума TransportSegment.seconds від першої зупинки напрямку до цієї (той самий алгоритм,
 * що й на публічній сторінці — див. frontend/src/pages/LocalTransportPage/segmentDurations.ts).
 */
import type { TransportSegmentDto, TransportTripDto } from '@/api/transportDataset';

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

/** Сума тривалостей сегментів від першої зупинки до зупинки з індексом toIndex (не включно). */
export function getDurationFromStartSec(
  lookup: Record<string, number>,
  routeId: string,
  orderedStopIds: string[],
  toIndex: number,
  defaultSec: number
): number {
  let sec = 0;
  for (let i = 0; i < toIndex && i < orderedStopIds.length - 1; i++) {
    sec += getSegmentDurationSec(lookup, routeId, orderedStopIds[i], orderedStopIds[i + 1], defaultSec);
  }
  return sec;
}

/** HH:MM прибуття на зупинку stopIndex, або null якщо у рейса немає departureTime. */
export function computeStopArrivalClock(
  departureTime: string | null | undefined,
  lookup: Record<string, number>,
  routeId: string,
  orderedStopIds: string[],
  stopIndex: number,
  defaultSec: number
): string | null {
  const depMins = parseClockToMinutes(departureTime);
  if (depMins == null) return null;
  const sec = getDurationFromStartSec(lookup, routeId, orderedStopIds, stopIndex, defaultSec);
  return formatMinutesToClock(depMins + sec / 60);
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
