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
}

export interface PlannerModel {
  ready: boolean;
  loading: boolean;
  error: string | null;
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
      };
    };
  }, [viewModel]);

  return { ready: viewModel != null, loading, error: error ? String(error) : null, plannerFor };
}
