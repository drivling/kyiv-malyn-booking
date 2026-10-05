import type { RouteStopWithOrder } from './types';
import { getStopKey } from './stopCatalog';
import { isVerifiedRoute } from './routeTiming';
import { routeColor } from './routeColors';

export type StopsByRoute = Record<string, string[] | RouteStopWithOrder[]>;
export type RouteDirection = 'there' | 'back';
export type LatLng = [number, number];

/** Полілінія маршруту для карти: у кольорі лінії зі схеми, вершини — зупинки й технічні точки (map_only) */
export type RouteLine = {
  routeId: string;
  color: string;
  positions: LatLng[];
};

/** Старий формат (масив назв) → обʼєкти з порядком у напрямках */
export function withOrder(routeStops: string[] | RouteStopWithOrder[]): RouteStopWithOrder[] {
  if (!Array.isArray(routeStops) || routeStops.length === 0) return [];
  const first = routeStops[0];
  if (first && typeof first === 'object' && 'name' in first) return routeStops as RouteStopWithOrder[];
  const names = routeStops as string[];
  return names.map((name, i) => ({ name, order_there: i + 1, order_back: names.length - i, belongs_to: 'both' as const }));
}

export type ChainOptions = {
  /** Лише справжні зупинки (без map_only) — для маркерів і вибору З/До */
  markersOnly?: boolean;
  /** Без фільтрів напрямку/порядку — усі точки, відсортовані за напрямком (запасний варіант для карти) */
  all?: boolean;
};

/**
 * Ключі зупинок маршруту в порядку руху для напрямку: з урахуванням belongs_to і order > 0,
 * з технічними точками map_only (вершини полілінії), якщо не задано markersOnly.
 * Єдина реалізація для карти, таймлайну, розкладу й GTFS-подібних розрахунків.
 */
export function routeStopChain(
  stopsByRoute: StopsByRoute | undefined,
  routeId: string,
  direction: RouteDirection,
  opts: ChainOptions = {}
): string[] {
  if (!routeId || !stopsByRoute?.[routeId]) return [];
  const stops = withOrder(stopsByRoute[routeId]);
  if (!stops.length) return [];
  const orderKey = direction === 'there' ? 'order_there' : 'order_back';
  const excluded = direction === 'there' ? 'back' : 'there';
  let list = opts.all
    ? [...stops]
    : stops.filter((s) => (s.belongs_to ?? 'both') !== excluded).filter((s) => (s[orderKey] ?? 0) > 0);
  if (opts.markersOnly) list = list.filter((s) => !s.map_only);
  return list.sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0)).map((s) => getStopKey(s));
}

/**
 * Полілінії перевірених маршрутів (напрямок «туди», запасний варіант — усі точки) у кольорах схеми.
 * Маршрути без кольору й без двох точок із координатами пропускаються.
 */
export function buildRouteLines(
  stops: Record<string, LatLng>,
  stopsByRoute: StopsByRoute | undefined,
  routeIds: readonly string[]
): RouteLine[] {
  const out: RouteLine[] = [];
  for (const routeId of routeIds) {
    if (!isVerifiedRoute(routeId)) continue;
    const color = routeColor(routeId);
    if (!color) continue;
    let chain = routeStopChain(stopsByRoute, routeId, 'there');
    if (!chain.length) chain = routeStopChain(stopsByRoute, routeId, 'there', { all: true });
    const positions = chain.map((k) => stops[k]).filter((p): p is LatLng => Array.isArray(p));
    if (positions.length >= 2) out.push({ routeId, color, positions });
  }
  return out;
}

export type BoundsPick = {
  /** Зупинки, за якими підганяється видима область (порожньо — лишити центр міста) */
  names: string[];
  padding: [number, number];
};

/**
 * Що показати на карті після вибору З/До: відрізок лінії між ними (якщо обидві на ланцюжку з лінією),
 * інакше обидві/одну зупинку з координатами. Без вибору — нічого (центр Малина, зум 13).
 */
export function pickBoundsStops(params: {
  chain: string[];
  stops: Record<string, LatLng>;
  fromStopName?: string;
  toStopName?: string;
  hasLine: boolean;
}): BoundsPick {
  const { chain, stops, fromStopName, toStopName, hasLine } = params;
  const fromIdx = fromStopName ? chain.indexOf(fromStopName) : -1;
  const toIdx = toStopName ? chain.indexOf(toStopName) : -1;
  if (hasLine && fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
    return { names: chain.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1), padding: [50, 50] };
  }
  const hasFrom = !!(fromStopName && stops[fromStopName]);
  const hasTo = !!(toStopName && stops[toStopName]);
  if (hasFrom && hasTo) return { names: [fromStopName as string, toStopName as string], padding: [50, 50] };
  if (hasFrom) return { names: [fromStopName as string], padding: [40, 40] };
  if (hasTo) return { names: [toStopName as string], padding: [40, 40] };
  return { names: [], padding: [40, 40] };
}
