/**
 * Планувальник поїздок одного міста поза сторінкою /transport (перший споживач — «Доведе», Docs/dovede-roadmap.md).
 * Той самий порядок, що на /transport і табло: датасет → configureSegmentDurations (синхронно, у тому ж рендері)
 * → buildTimetable на тип дня. Модулі тривалостей, номерів і кольорів тримають «поточне місто», тому на екрані —
 * планувальник лише одного міста за раз.
 */
import { useMemo } from 'react';
import { useTransportDataset } from '../dataset/useTransportDataset';
import { datasetToLocalViewModel } from '../dataset/datasetAdapter';
import { DEFAULT_SEGMENT_DURATION_SEC, SEGMENT_DURATIONS_SEC, configureSegmentDurations } from '../segmentDurations';
import { buildRoutesFromData } from '../stopDepartures';
import { routeChainSources } from '../routeVariants';
import { setVerifiedRoutesCity, verifiedRoutesCity } from '../routeTiming';
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
  /** Ціна проїзду в міському автобусі, грн (`meta.fare`); null — у даних немає */
  fare: number | null;
  /** Планувальник на дату 'YYYY-MM-DD'; null — датасет ще не завантажено */
  plannerFor(isoDate: string): DayPlanner | null;
}

const DEFAULT_CITY = 'Malyn';

function serviceDayOfIso(isoDate: string): ServiceDay {
  const [y, m, d] = isoDate.split('-').map(Number);
  return serviceDayForDate(new Date(y, m - 1, d));
}

export interface PlannerModelOptions {
  /**
   * Другий планувальник на сторінці («Доведе»: Коростень поруч із Малином): не перемикає місто номерів і кольорів
   * сторінки й не лишає своїх тривалостей сегментів глобально — розклад дня будується з ними й одразу повертає
   * попередні
   */
  passive?: boolean;
}

/**
 * `city` null — планувальник ще не потрібен (нічого не вантажить, `ready: false`). Розклад дня (`Timetable`) будується
 * з тривалостями сегментів саме цього міста: на час `buildTimetable` вони стають глобальними, потім повертаються
 * попередні, тож два планувальники на сторінці не плутають сегменти (id маршрутів у містах повторюються).
 */
export function usePlannerModel(city: string | null, opts: PlannerModelOptions = {}): PlannerModel {
  const passive = opts.passive ?? false;
  const { dataset: loadedDataset, loading, error } = useTransportDataset(city ?? DEFAULT_CITY, { passive, enabled: city != null });
  const dataset = city ? loadedDataset : null;
  const viewModel = useMemo(() => {
    if (!dataset || !city) return null;
    const vm = datasetToLocalViewModel(dataset, city);
    if (!passive) configureSegmentDurations(vm.segmentDurations, vm.defaultSec);
    return vm;
  }, [dataset, city, passive]);

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
        // час рейсів рахується зі «своїми» сегментами й списком перевірених маршрутів свого міста (у Малина
        // неперевірені маршрути йдуть плоскими 2 хв на крок, в іншого міста — усі за сегментами)
        const prevSegments = SEGMENT_DURATIONS_SEC;
        const prevDefault = DEFAULT_SEGMENT_DURATION_SEC;
        const prevVerified = verifiedRoutesCity();
        configureSegmentDurations(viewModel.segmentDurations, viewModel.defaultSec);
        setVerifiedRoutesCity(city ?? DEFAULT_CITY);
        try {
          tt = buildTimetable({ routes, stopsByRoute, variantsByRoute, coords, serviceDay });
        } finally {
          if (passive) configureSegmentDurations(prevSegments, prevDefault);
          setVerifiedRoutesCity(prevVerified);
        }
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
  }, [viewModel, passive, city]);

  const stops = useMemo(() => (dataset?.stops ?? []).map((s) => ({ id: s.id, name: s.name })), [dataset]);

  const routes = useMemo<PlannerRoute[]>(
    () =>
      (dataset?.routes ?? [])
        .filter((r) => !r.unreliable)
        .map((r) => ({ id: r.id, no: (r.shortName ?? '').trim() || r.id, fromName: (r.fromName ?? '').trim(), toName: (r.toName ?? '').trim() })),
    [dataset],
  );

  const fare = useMemo(() => {
    const f = dataset?.meta?.fare as { amount?: unknown } | undefined;
    return typeof f?.amount === 'number' && f.amount > 0 ? f.amount : null;
  }, [dataset]);

  return { ready: viewModel != null, loading, error: error ? String(error) : null, stops, routes, fare, plannerFor };
}
