/**
 * Планувальник поїздок одного міста поза сторінкою /transport (перший споживач — «Доведе», Docs/dovede-roadmap.md).
 * Той самий порядок, що на /transport і табло: датасет → configureSegmentDurations (синхронно, у тому ж рендері)
 * → buildTimetable на тип дня. Модулі тривалостей, номерів і кольорів тримають «поточне місто», тому на екрані —
 * планувальник лише одного міста за раз.
 */
import { useMemo } from 'react';
import { useTransportDataset } from '../dataset/useTransportDataset';
import { datasetToLocalViewModel } from '../dataset/datasetAdapter';
import { configureSegmentDurations } from '../segmentDurations';
import { buildRoutesFromData } from '../stopDepartures';
import { routeChainSources } from '../routeVariants';
import { displayNameForStopKey, getStopsCatalog } from '../stopCatalog';
import { buildTimetable, serviceDayForDate, type ServiceDay } from './buildTimetable';
import { planDay } from './plan';
import type { DayPlan, Endpoint, Timetable } from './types';

/** Планувальник на один день */
export interface DayPlanner {
  plan(from: Endpoint, to: Endpoint): DayPlan;
  stopName(stopId: string): string;
  stopCoords(stopId: string): [number, number] | null;
  /**
   * Відправлення маршруту за день, згруповані за кінцевою: із зупинки `stopId` або (без неї) з початкової.
   * Рейси, для яких ця зупинка остання, не рахуються — з кінцевої автобус уже нікуди не везе.
   */
  routeDepartures(routeId: string, stopId?: string | null): RouteDepartures[];
}

export interface RouteDepartures {
  fromStopId: string;
  towardStopId: string;
  /** хвилини від півночі, за зростанням */
  mins: number[];
}

export interface PlannerRoute {
  id: string;
  /** номер для показу («11/1»); порожній shortName → id */
  no: string;
  fromName: string;
  toName: string;
}

export interface PlannerModel {
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** Зупинки датасету міста (id і назва, разом із технічними точками) — для словників поза /transport */
  stops: Array<{ id: string; name: string }>;
  /** Маршрути міста, які показує сайт (без «ненадійних») */
  routes: PlannerRoute[];
  /** Планувальник на дату 'YYYY-MM-DD'; null — датасет ще не завантажено */
  plannerFor(isoDate: string): DayPlanner | null;
}

function serviceDayOfIso(isoDate: string): ServiceDay {
  const [y, m, d] = isoDate.split('-').map(Number);
  return serviceDayForDate(new Date(y, m - 1, d));
}

export function usePlannerModel(city: string): PlannerModel {
  const { dataset, loading, error } = useTransportDataset(city);
  const viewModel = useMemo(() => {
    if (!dataset) return null;
    const vm = datasetToLocalViewModel(dataset, city);
    configureSegmentDurations(vm.segmentDurations, vm.defaultSec);
    return vm;
  }, [dataset, city]);

  const plannerFor = useMemo(() => {
    const data = viewModel?.data ?? null;
    if (!viewModel || !data) return () => null;
    const routes = buildRoutesFromData(data);
    const { stopsByRoute, variantsByRoute } = routeChainSources(data);
    const coords = viewModel.coords.stops ?? null;
    const catalog = getStopsCatalog(data);
    const byDay = new Map<ServiceDay, Timetable>();
    return (isoDate: string): DayPlanner => {
      const serviceDay = serviceDayOfIso(isoDate);
      let tt = byDay.get(serviceDay);
      if (!tt) {
        tt = buildTimetable({ routes, stopsByRoute, variantsByRoute, coords, serviceDay });
        byDay.set(serviceDay, tt);
      }
      const timetable = tt;
      return {
        plan: (from, to) => planDay(timetable, from, to),
        stopName: (id) => displayNameForStopKey(id, catalog),
        stopCoords: (id) => coords?.[id] ?? null,
        routeDepartures: (routeId, stopId) => {
          const groups = new Map<string, RouteDepartures>();
          for (const p of timetable.patterns) {
            if (p.routeId !== routeId || p.stops.length < 2) continue;
            const pos = stopId ? p.stops.findIndex((i) => timetable.stops[i].id === stopId) : 0;
            if (pos < 0 || pos === p.stops.length - 1) continue;
            const fromStopId = timetable.stops[p.stops[pos]].id;
            const towardStopId = timetable.stops[p.stops[p.stops.length - 1]].id;
            const key = `${fromStopId}>${towardStopId}`;
            const g = groups.get(key) ?? { fromStopId, towardStopId, mins: [] };
            for (const t of p.trips) g.mins.push(t.times[pos]);
            groups.set(key, g);
          }
          return [...groups.values()].map((g) => ({ ...g, mins: [...new Set(g.mins)].sort((a, b) => a - b) }));
        },
      };
    };
  }, [viewModel]);

  const stops = useMemo(() => (dataset?.stops ?? []).map((s) => ({ id: s.id, name: s.name })), [dataset]);

  const routes = useMemo<PlannerRoute[]>(
    () =>
      (dataset?.routes ?? [])
        .filter((r) => !r.unreliable)
        .map((r) => ({ id: r.id, no: (r.shortName ?? '').trim() || r.id, fromName: (r.fromName ?? '').trim(), toName: (r.toName ?? '').trim() })),
    [dataset],
  );

  return { ready: viewModel != null, loading, error: error ? String(error) : null, stops, routes, plannerFor };
}
