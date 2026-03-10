/**
 * Тривалості переїзду між сусідніми зупинками (секунди).
 * Дані з segmentDurations.json — файл можна зручно редагувати (ключ: "routeId|stopFrom|stopTo").
 * Якщо для сегменту немає запису — використовується defaultSec (2 хв).
 */

import segmentsData from './segmentDurations.json';

const { defaultSec, segments } = segmentsData as { defaultSec: number; segments: Record<string, number> };

export const DEFAULT_SEGMENT_DURATION_SEC = defaultSec;

export const SEGMENT_DURATIONS_SEC: Record<string, number> = segments;

/** Повертає тривалість переїзду між двома зупинками (секунди). Якщо даних немає — defaultSec (2 хв). */
export function getSegmentDurationSec(
  routeId: string,
  stopFrom: string,
  stopTo: string
): number {
  const key1 = `${routeId}|${stopFrom}|${stopTo}`;
  const key2 = `${routeId}|${stopTo}|${stopFrom}`;
  return SEGMENT_DURATIONS_SEC[key1] ?? SEGMENT_DURATIONS_SEC[key2] ?? DEFAULT_SEGMENT_DURATION_SEC;
}

/**
 * Сума тривалостей сегментів від першої зупинки до зупинки з індексом toIndex (не включно).
 * orderedStopNames — масив назв зупинок у порядку руху.
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
