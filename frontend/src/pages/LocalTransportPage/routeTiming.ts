/**
 * Константи та допоміжні функції для часу руху між зупинками.
 * Для перевірених маршрутів — дані з segmentDurations.ts (секунди);
 * коли немає даних — fallback 2 хв у коді.
 */

import {
  getSegmentDurationSec as getSegmentDurationSecFromFile,
  getDurationFromStartSec as getDurationFromStartSecFromFile,
  DEFAULT_SEGMENT_DURATION_SEC,
} from './segmentDurations';

/** Маршрути з перевіреною трасою (карта, час між зупинками з файлу segmentDurations) */
export const VERIFIED_ROUTE_IDS = ['2', '3', '5', '7', '8', '9', '11', '12'] as const;

/** Fallback: хвилин між зупинками, коли немає даних для маршруту (розрахунок у коді) */
export const MINS_BETWEEN_STOPS_FALLBACK = 2;

const VERIFIED_SET = new Set<string>(VERIFIED_ROUTE_IDS as unknown as string[]);

/** Чи маршрут перевірений (є дані в segmentDurations) */
export function isVerifiedRoute(routeId: string): boolean {
  return VERIFIED_SET.has(routeId);
}

/** Тривалість сегменту між двома зупинками (секунди). Якщо даних немає — 2 хв (120 с). */
export function getSegmentDurationSec(routeId: string, stopFrom: string, stopTo: string): number {
  return getSegmentDurationSecFromFile(routeId, stopFrom, stopTo);
}

/** Сума тривалостей від початку маршруту до зупинки з індексом toIndex (секунди). */
export function getDurationFromStartSec(
  routeId: string,
  orderedStopNames: string[],
  toIndex: number
): number {
  return getDurationFromStartSecFromFile(routeId, orderedStopNames, toIndex);
}

/** Повертає хвилини між сусідніми зупинками для маршруту (fallback для неперевірених). */
export function getMinsBetweenStops(routeId: string): number {
  return isVerifiedRoute(routeId) ? DEFAULT_SEGMENT_DURATION_SEC / 60 : MINS_BETWEEN_STOPS_FALLBACK;
}
