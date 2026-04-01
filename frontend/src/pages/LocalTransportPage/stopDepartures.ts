/**
 * Розклад відправлень з однієї зупинки по всіх маршрутах і напрямках (хронологічно).
 */
import type { RouteStopWithOrder, TransportRecord, TransportData, SupplementRoute } from './types';
import { getDurationFromStartSec, getMinsBetweenStops, isVerifiedRoute } from './routeTiming';

export type StopDepartureRow = {
  routeId: string;
  departureMins: number;
  direction: 'there' | 'back';
  /** Кінцева / табличка рейсу (як у даних) */
  destination: string;
  tripId: string;
};

function parseTime(s: string | undefined): number {
  if (!s) return 0;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function sortByTime(a: TransportRecord, b: TransportRecord): number {
  return parseTime(a.block_id) - parseTime(b.block_id);
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

function getRealStops(stops: RouteStopWithOrder[]): RouteStopWithOrder[] {
  return stops.filter((s) => !s.map_only);
}

function routeHasStop(
  routeId: string,
  stopName: string,
  route: { from: string | null; to: string | null },
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>
): boolean {
  if (route.from === stopName || route.to === stopName) return true;
  const routeStops = stopsByRoute?.[routeId];
  if (!routeStops?.length) return false;
  const first = routeStops[0];
  if (typeof first === 'object' && 'order_there' in first) {
    const stop = (routeStops as RouteStopWithOrder[]).find((s) => s.name === stopName);
    if (!stop) return false;
    const ot = stop.order_there;
    const ob = stop.order_back;
    const thereOk = typeof ot === 'number' && ot > 0;
    const backOk = typeof ob === 'number' && ob > 0;
    return thereOk || backOk;
  }
  return getStopNames(routeStops).includes(stopName);
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

export function buildStopsList(
  routes: RouteBundle[],
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>
): string[] {
  const stopSet = new Set<string>();
  routes.forEach((r) => {
    if (r.from) stopSet.add(r.from);
    if (r.to) stopSet.add(r.to);
  });
  if (stopsByRoute) {
    Object.values(stopsByRoute).forEach((stops) => {
      const names =
        Array.isArray(stops) && stops[0] != null && typeof stops[0] === 'object' && 'name' in stops[0]
          ? getStopNames(getRealStops(stops as RouteStopWithOrder[]))
          : getStopNames(stops);
      names.forEach((s) => stopSet.add(s));
    });
  }
  ['Малинівка', 'Юрівка', 'БАМ', 'Царське село'].forEach((s) => stopSet.add(s));
  return [...stopSet].sort((a, b) => a.localeCompare(b));
}

/**
 * Усі відправлення з зупинки `stopName` по всіх маршрутах (обидва напрямки), відсортовані за часом.
 */
export function buildStopDepartures(
  stopName: string,
  routes: RouteBundle[],
  stopsByRoute: Record<string, string[] | RouteStopWithOrder[]> | undefined
): StopDepartureRow[] {
  if (!stopName || !stopsByRoute) return [];

  const rows: StopDepartureRow[] = [];

  for (const route of routes) {
    if (!route.trips.length) continue;
    if (!routeHasStop(route.id, stopName, route, stopsByRoute)) continue;

    const raw = stopsByRoute[route.id];
    if (!raw?.length) continue;

    const stopsWithOrder = normalizeStopsWithOrder(raw);
    const orderedThere = getOrderedForDirection(stopsWithOrder, 'there');
    const orderedBack = getOrderedForDirection(stopsWithOrder, 'back');
    const orderedNamesThere = orderedThere.map((s) => s.name);
    const orderedNamesBack = orderedBack.map((s) => s.name);

    const stopThere = orderedThere.find((s) => s.name === stopName);
    const stopBack = orderedBack.find((s) => s.name === stopName);

    const verified = isVerifiedRoute(route.id);
    const minsPerStop = getMinsBetweenStops(route.id);
    const { dir0, dir1 } = groupTripsByDirection(route.trips);

    if (stopThere && (stopThere.order_there ?? 0) > 0) {
      const order = stopThere.order_there;
      dir1.forEach((t) => {
        const mins = parseTime(t.block_id);
        if (mins <= 0) return;
        const depMins = verified
          ? mins + getDurationFromStartSec(route.id, orderedNamesThere, order - 1) / 60
          : mins + (order - 1) * minsPerStop;
        const dest = (t.trip_headsign || route.to || '').trim() || '—';
        rows.push({
          routeId: route.id,
          departureMins: depMins,
          direction: 'there',
          destination: dest,
          tripId: t.trip_id,
        });
      });
    }

    if (stopBack && (stopBack.order_back ?? 0) > 0) {
      const order = stopBack.order_back;
      dir0.forEach((t) => {
        const mins = parseTime(t.block_id);
        if (mins <= 0) return;
        const depMins = verified
          ? mins + getDurationFromStartSec(route.id, orderedNamesBack, order - 1) / 60
          : mins + (order - 1) * minsPerStop;
        const dest = (t.trip_headsign || route.from || '').trim() || '—';
        rows.push({
          routeId: route.id,
          departureMins: depMins,
          direction: 'back',
          destination: dest,
          tripId: t.trip_id,
        });
      });
    }
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
