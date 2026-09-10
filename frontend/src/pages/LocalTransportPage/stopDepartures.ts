/**
 * Розклад відправлень з однієї зупинки по всіх маршрутах і напрямках (хронологічно).
 */
import type { RouteStopWithOrder, TransportRecord, TransportData, SupplementRoute } from './types';
import { recordTiming } from './routeTiming';
import { getStopKey, invertNameToId, type StopsCatalog } from './stopCatalog';
import { sortTripsByDeparture } from './tripDeparture';

export type StopDepartureRow = {
  routeId: string;
  departureMins: number;
  direction: 'there' | 'back';
  /** Кінцева / табличка рейсу (як у даних) */
  destination: string;
  tripId: string;
};

function sortByTime(a: TransportRecord, b: TransportRecord): number {
  return sortTripsByDeparture(a, b);
}

function groupTripsByDirection(trips: TransportRecord[]): { dir0: TransportRecord[]; dir1: TransportRecord[] } {
  const dir0 = trips.filter((t) => t.direction_id === '0').sort(sortByTime);
  const dir1 = trips.filter((t) => t.direction_id === '1').sort(sortByTime);
  return { dir0, dir1 };
}

function getStopNames(stops: string[] | RouteStopWithOrder[]): string[] {
  if (!stops?.length) return [];
  const first = stops[0];
  return typeof first === 'string' ? (stops as string[]) : (stops as RouteStopWithOrder[]).map((s) => s.name);
}

function routeHasStop(
  routeId: string,
  stopKey: string,
  route: { from: string | null; to: string | null },
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>,
  catalog?: StopsCatalog
): boolean {
  const n2i = invertNameToId(catalog);
  if (route.from && (n2i.get(route.from) === stopKey || route.from === stopKey)) return true;
  if (route.to && (n2i.get(route.to) === stopKey || route.to === stopKey)) return true;
  const routeStops = stopsByRoute?.[routeId];
  if (!routeStops?.length) return false;
  const first = routeStops[0];
  if (typeof first === 'object' && 'order_there' in first) {
    const stop = (routeStops as RouteStopWithOrder[]).find((s) => getStopKey(s) === stopKey);
    if (!stop) return false;
    const ot = stop.order_there;
    const ob = stop.order_back;
    const thereOk = typeof ot === 'number' && ot > 0;
    const backOk = typeof ob === 'number' && ob > 0;
    return thereOk || backOk;
  }
  return getStopNames(routeStops).some((name) => {
    const id = n2i.get(name);
    return id === stopKey || name === stopKey;
  });
}

function normalizeStopsWithOrder(routeStops: string[] | RouteStopWithOrder[]): RouteStopWithOrder[] {
  if (!routeStops.length) return [];
  const first = routeStops[0];
  if (first && typeof first === 'object' && 'name' in first) {
    return routeStops as RouteStopWithOrder[];
  }
  const names = routeStops as unknown as string[];
  return names.map((name, i) => ({
    name,
    order_there: i + 1,
    order_back: names.length - i,
    belongs_to: 'both' as const,
  }));
}

function getOrderedForDirection(
  stopsWithOrder: RouteStopWithOrder[],
  dir: 'there' | 'back'
): RouteStopWithOrder[] {
  if (dir === 'there') {
    return [...stopsWithOrder]
      .filter((s) => (s.belongs_to ?? 'both') !== 'back' && (s.order_there ?? 0) > 0)
      .sort((a, b) => (a.order_there ?? 0) - (b.order_there ?? 0));
  }
  return [...stopsWithOrder]
    .filter((s) => (s.belongs_to ?? 'both') !== 'there' && (s.order_back ?? 0) > 0)
    .sort((a, b) => (a.order_back ?? 0) - (b.order_back ?? 0));
}

export type RouteBundle = {
  id: string;
  from: string | null;
  to: string | null;
  trips: TransportRecord[];
  supplement?: SupplementRoute;
};

export function buildRoutesFromData(data: TransportData): RouteBundle[] {
  const byRoute: Record<
    string,
    { from: string | null; to: string | null; trips: TransportRecord[]; supplement?: SupplementRoute }
  > = {};

  for (const r of data.records) {
    const id = r.route_id;
    if (!byRoute[id]) byRoute[id] = { from: null, to: null, trips: [] };
    if (r.direction_id === '0') byRoute[id].from = r.trip_headsign;
    else byRoute[id].to = r.trip_headsign;
    byRoute[id].trips.push(r);
  }

  const supplementRoutes = data.supplement?.routes || {};
  if (supplementRoutes['9'] && !byRoute['9']) {
    byRoute['9'] = {
      from: supplementRoutes['9'].from ?? null,
      to: supplementRoutes['9'].to ?? null,
      trips: [],
      supplement: supplementRoutes['9'],
    };
  }

  return Object.entries(byRoute)
    .map(([id, v]) => {
      const sup = supplementRoutes[id] || v.supplement;
      return {
        id,
        from: (sup?.from ?? v.from) || null,
        to: (sup?.to ?? v.to) || null,
        trips: v.trips,
        supplement: sup,
      };
    })
    .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
}

/**
 * Усі відправлення з зупинки `stopKey` (id st_XXXX) по всіх маршрутах (обидва напрямки), відсортовані за часом.
 * Рейс дає рядок лише якщо обслуговує зупинку (start_stop_id/end_stop_id) і вона не його кінцева:
 * автобус, що прибув на кінцеву, нікуди не відправляється.
 */
export function buildStopDepartures(
  stopKey: string,
  routes: RouteBundle[],
  stopsByRoute: Record<string, string[] | RouteStopWithOrder[]> | undefined,
  catalog?: StopsCatalog
): StopDepartureRow[] {
  if (!stopKey || !stopsByRoute) return [];

  const rows: StopDepartureRow[] = [];

  for (const route of routes) {
    if (!route.trips.length) continue;
    if (!routeHasStop(route.id, stopKey, route, stopsByRoute, catalog)) continue;

    const raw = stopsByRoute[route.id];
    if (!raw?.length) continue;

    const stopsWithOrder = normalizeStopsWithOrder(raw);
    const chainThere = getOrderedForDirection(stopsWithOrder, 'there').map((s) => getStopKey(s));
    const chainBack = getOrderedForDirection(stopsWithOrder, 'back').map((s) => getStopKey(s));
    const { dir0, dir1 } = groupTripsByDirection(route.trips);

    const emit = (t: TransportRecord, direction: 'there' | 'back', chain: string[]) => {
      const timing = recordTiming(route.id, chain, t);
      if (!timing) return;
      const served = timing.stops.find((s) => s.stopId === stopKey);
      if (!served || served.index === timing.endIndex) return;
      const endName = t.end_stop_id ? catalog?.[t.end_stop_id]?.name : undefined;
      const routeEnd = direction === 'there' ? route.to : route.from;
      const dest = (t.trip_headsign || endName || routeEnd || '').trim() || '—';
      rows.push({
        routeId: route.id,
        departureMins: served.mins,
        direction,
        destination: dest,
        tripId: t.trip_id,
      });
    };

    dir1.forEach((t) => emit(t, 'there', chainThere));
    dir0.forEach((t) => emit(t, 'back', chainBack));
  }

  rows.sort((a, b) => {
    if (a.departureMins !== b.departureMins) return a.departureMins - b.departureMins;
    const na = parseInt(a.routeId, 10);
    const nb = parseInt(b.routeId, 10);
    if (na !== nb) return na - nb;
    return a.tripId.localeCompare(b.tripId);
  });

  return rows;
}

/** Години:хвилини з хвилин від півночі (для відображення та URL). */
export function formatMinsClock(minutes: number): string {
  const totalMins = Math.round(minutes);
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
