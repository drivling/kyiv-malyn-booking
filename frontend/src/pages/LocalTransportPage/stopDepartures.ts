/**
 * Розклад відправлень з однієї зупинки по всіх маршрутах і напрямках (хронологічно).
 */
import type { RouteStopWithOrder, RouteVariantVm, TransportRecord, TransportData, SupplementRoute } from './types';
import { recordTiming } from './routeTiming';
import { routeStopChain } from './routeGeometry';
import { recordVariant, variantChain, variantEndStopId, type VariantsByRoute } from './routeVariants';
import { getStopKey, invertNameToId, type StopsCatalog } from './stopCatalog';
import { groupTripsByDirection } from './tripDeparture';

export type StopDepartureRow = {
  routeId: string;
  departureMins: number;
  direction: 'there' | 'back';
  /** Кінцева / табличка рейсу (як у даних) */
  destination: string;
  tripId: string;
  /** Варіант шляху рейсу (Docs/route-variants-2026-10.md); немає — основний ланцюжок */
  variantId?: string;
};

/**
 * Кінцева / табличка рейсу для показу людині:
 * headsign → назва кінцевої зупинки рейсу (скорочений рейс; для рейсу варіанта — кінець варіанта) →
 * кінець маршруту → «—».
 */
export function tripDestination(
  t: Pick<TransportRecord, 'trip_headsign' | 'end_stop_id'>,
  direction: 'there' | 'back',
  route: { from: string | null; to: string | null },
  catalog?: StopsCatalog,
  variant?: RouteVariantVm | null
): string {
  const headsign = (t.trip_headsign ?? '').trim();
  const endId = t.end_stop_id || (variant ? variantEndStopId(variant) : undefined);
  const endName = endId ? catalog?.[endId]?.name : undefined;
  const routeEnd = direction === 'there' ? route.to : route.from;
  return (headsign || endName || routeEnd || '').trim() || '—';
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
  catalog?: StopsCatalog,
  variantsByRoute?: VariantsByRoute
): boolean {
  const n2i = invertNameToId(catalog);
  if (route.from && (n2i.get(route.from) === stopKey || route.from === stopKey)) return true;
  if (route.to && (n2i.get(route.to) === stopKey || route.to === stopKey)) return true;
  if (variantsByRoute?.[routeId]?.some((v) => variantChain(v, { markersOnly: true }).includes(stopKey))) return true;
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

  const variantsByRoute = data.supplement?.stops?.variants_by_route;
  for (const r of data.records) {
    const id = r.route_id;
    if (!byRoute[id]) byRoute[id] = { from: null, to: null, trips: [] };
    // табличка рейсу варіанта (до вокзалу, до лікарні) — не кінцева маршруту
    if (!recordVariant(variantsByRoute, r)) {
      if (r.direction_id === '0') byRoute[id].from = r.trip_headsign;
      else byRoute[id].to = r.trip_headsign;
    }
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
 * автобус, що прибув на кінцеву, нікуди не відправляється. Рейс варіанта шляху рахується своїм ланцюжком.
 */
export function buildStopDepartures(
  stopKey: string,
  routes: RouteBundle[],
  stopsByRoute: Record<string, string[] | RouteStopWithOrder[]> | undefined,
  catalog?: StopsCatalog,
  variantsByRoute?: VariantsByRoute
): StopDepartureRow[] {
  if (!stopKey || !stopsByRoute) return [];

  const rows: StopDepartureRow[] = [];

  for (const route of routes) {
    if (!route.trips.length) continue;
    if (!routeHasStop(route.id, stopKey, route, stopsByRoute, catalog, variantsByRoute)) continue;

    const main = {
      there: routeStopChain(stopsByRoute, route.id, 'there'),
      back: routeStopChain(stopsByRoute, route.id, 'back'),
    };
    const { dir0, dir1 } = groupTripsByDirection(route.trips);

    const emit = (t: TransportRecord, direction: 'there' | 'back') => {
      const variant = recordVariant(variantsByRoute, t);
      const timing = recordTiming(route.id, variant ? variantChain(variant) : main[direction], t);
      if (!timing) return;
      const served = timing.stops.find((s) => s.stopId === stopKey);
      if (!served || served.index === timing.endIndex) return;
      rows.push({
        routeId: route.id,
        departureMins: served.mins,
        direction,
        destination: tripDestination(t, direction, route, catalog, variant),
        tripId: t.trip_id,
        ...(variant ? { variantId: variant.id } : {}),
      });
    };

    dir1.forEach((t) => emit(t, 'there'));
    dir0.forEach((t) => emit(t, 'back'));
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
