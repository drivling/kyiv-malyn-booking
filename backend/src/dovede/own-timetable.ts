/**
 * «Доведе» · свій розклад міста зі своїм датасетом (Коростень) як суддя відповідей Google
 * (Docs/dovede-learning-roadmap.md, аналіз 2026-11-23, пункти 3–4): чи ходить названа Google лінія в цю годину, коли в
 * місті взагалі ходять автобуси й чи назва місця — наша зупинка. Чистий модуль: на вході датасет, без бази.
 */
import type { TransportDataset } from '../local-transport';
import { korostenStopForName } from './korostenPlaces';

export type OwnDayType = 'weekday' | 'saturday' | 'sunday';

export interface OwnTimetable {
  /**
   * Чи є в нашому розкладі рейс лінії `line` (номер, як його пише Google: «2Б», «7») цього типу дня з відправленням у
   * годину `hour` ± 1 (рейс, що вирушив годину тому, ще в дорозі). null — такої лінії в нас нема.
   */
  lineRuns(line: string, dayType: string, hour: number): boolean | null;
  /** Перша й остання година відправлень у місті цього типу дня; null — рейсів нема */
  hours(dayType: string): { first: number; last: number } | null;
  /** Назва місця містить назву нашої зупинки («Школа №5», «Загальноосвітня школа №1») */
  isOwnStop(name: string): boolean;
}

/** «2-Б», «2б», «2b» — той самий номер (як `sameNo` у nlu/routes.ts сторінки) */
export const sameLineNo = (s: string): string => s.toLowerCase().replace(/[-\s]/g, '').replace(/b/g, 'б');

function runsOn(serviceId: string | undefined, dayType: string): boolean {
  const s = serviceId ?? 'everyday';
  if (s === 'everyday') return true;
  return dayType === 'weekday' ? s === 'weekdays' : s === 'weekends';
}

export function ownTimetable(dataset: Pick<TransportDataset, 'stops' | 'routes' | 'trips'>): OwnTimetable {
  const routeOf = new Map<string, string>();
  for (const r of dataset.routes) {
    if (r.unreliable) continue;
    routeOf.set(sameLineNo(r.id), r.id);
    if (r.shortName) routeOf.set(sameLineNo(r.shortName), r.id);
  }
  // година відправлення кожного рейсу за маршрутом і типом дня
  const hoursOf = new Map<string, Set<number>>();
  const all = new Map<string, number[]>();
  for (const t of dataset.trips) {
    const h = Number(String(t.departureTime ?? '').split(':')[0]);
    if (!Number.isInteger(h)) continue;
    for (const day of ['weekday', 'saturday', 'sunday']) {
      if (!runsOn(t.serviceId, day)) continue;
      const k = `${t.routeId}|${day}`;
      if (!hoursOf.has(k)) hoursOf.set(k, new Set());
      hoursOf.get(k)!.add(h);
      all.set(day, [...(all.get(day) ?? []), h]);
    }
  }
  const stops = dataset.stops.map((s) => ({ id: s.id, name: s.name }));
  return {
    lineRuns(line, dayType, hour) {
      const id = routeOf.get(sameLineNo(line));
      if (!id) return null;
      const hs = hoursOf.get(`${id}|${dayType}`);
      return Boolean(hs && (hs.has(hour) || hs.has(hour - 1) || hs.has(hour + 1)));
    },
    hours(dayType) {
      const hs = all.get(dayType);
      return hs?.length ? { first: Math.min(...hs), last: Math.max(...hs) } : null;
    },
    isOwnStop(name) {
      return korostenStopForName(stops, name, 'contains') != null;
    },
  };
}
