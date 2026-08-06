/**
 * Тривалості переїзду між сусідніми зупинками (секунди).
 * Runtime-дані з GET /transport/dataset через configureSegmentDurations.
 */

let defaultSec = 120;
let segments: Record<string, number> = {};

/** Застосувати сегменти з адаптера dataset (єдине джерело для публічної сторінки). */
export function configureSegmentDurations(
  nextSegments: Record<string, number>,
  nextDefaultSec = 120
): void {
  segments = nextSegments;
  defaultSec = Number.isFinite(nextDefaultSec) && nextDefaultSec > 0 ? nextDefaultSec : 120;
  DEFAULT_SEGMENT_DURATION_SEC = defaultSec;
  SEGMENT_DURATIONS_SEC = segments;
}

export function getDefaultSegmentDurationSec(): number {
  return defaultSec;
}

export let DEFAULT_SEGMENT_DURATION_SEC = 120;
export let SEGMENT_DURATIONS_SEC: Record<string, number> = {};

/** Повертає тривалість переїзду між двома зупинками (секунди). Якщо даних немає — defaultSec. */
export function getSegmentDurationSec(
  routeId: string,
  stopFrom: string,
  stopTo: string
): number {
  const key1 = `${routeId}|${stopFrom}|${stopTo}`;
  const key2 = `${routeId}|${stopTo}|${stopFrom}`;
  return segments[key1] ?? segments[key2] ?? defaultSec;
}

/**
 * Сума тривалостей сегментів від першої зупинки до зупинки з індексом toIndex (не включно).
 * orderedStopNames — масив ключів зупинок (id) у порядку руху.
 */
export function getDurationFromStartSec(
  routeId: string,
  orderedStopNames: string[],
  toIndex: number
): number {
  let sec = 0;
  for (let i = 0; i < toIndex && i < orderedStopNames.length - 1; i++) {
    sec += getSegmentDurationSec(routeId, orderedStopNames[i], orderedStopNames[i + 1]);
  }
  return sec;
}
