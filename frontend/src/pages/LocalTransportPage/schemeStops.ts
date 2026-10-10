import { hiddenTransportRouteIds, type TransportDataset } from '@/api/transportDataset';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';
import { SCHEME_NODES, type SchemeNode } from './scheme/malyn-scheme-nodes';

type StopsDataset = Pick<TransportDataset, 'routes' | 'routeStops'>;

const ROUTE_RANK: ReadonlyMap<string, number> = new Map(SCHEME_ROUTES.map((r, i) => [r.id, i]));
const NODE_BY_STOP: ReadonlyMap<string, SchemeNode> = new Map(
  SCHEME_NODES.flatMap((n) => n.stopIds.map((id) => [id, n] as const))
);

/** Лінії схеми в порядку легенди (маршрути поза схемою відкидаються) */
function inLegendOrder(ids: Iterable<string>): string[] {
  return [...new Set(ids)]
    .filter((id) => ROUTE_RANK.has(id))
    .sort((a, b) => (ROUTE_RANK.get(a) ?? 0) - (ROUTE_RANK.get(b) ?? 0));
}

/** Зупинка справді обслуговується маршрутом: є в ланцюжку хоча б одного напрямку (не -1 / -1 з адмінки). */
function servesStop(rs: StopsDataset['routeStops'][number]): boolean {
  return Number(rs.orderThere) > 0 || Number(rs.orderBack) > 0;
}

/**
 * Лінії через зупинку з routeStops датасету: без «лише для карти» (mapOnly), без ненадійних маршрутів
 * і без маршрутів, на яких зупинку вимкнено (-1 в обидва боки) — інакше схема підсвічує лінію там,
 * де автобус не зупиняється.
 */
function rawRoutesAtStop(dataset: StopsDataset, stopId: string, hidden: Set<string>): string[] {
  const out: string[] = [];
  for (const rs of dataset.routeStops) {
    if (rs.stopId === stopId && !rs.mapOnly && !hidden.has(rs.routeId) && servesStop(rs)) out.push(rs.routeId);
  }
  return out;
}

/**
 * Лінії схеми, що проходять через зупинку: з routeStops датасету, без «лише для карти»
 * (mapOnly), без ненадійних маршрутів і без вимкнених членств (-1 / -1); порядок — як у легенді
 * схеми (ROUTE_ORDER генератора).
 * Маршрути поза схемою (міжміські, без кольору) не повертаються.
 */
export function routesAtStop(dataset: StopsDataset, stopId: string): string[] {
  if (!stopId) return [];
  return inLegendOrder(rawRoutesAtStop(dataset, stopId, hiddenTransportRouteIds(dataset)));
}

/**
 * Вузол схеми, якому належить зупинка (вузол = кілька фізичних зупинок, див. malyn-scheme-nodes.ts),
 * або null, якщо зупинки на схемі немає.
 */
export function schemeNodeForStop(stopId: string): SchemeNode | null {
  return (stopId && NODE_BY_STOP.get(stopId)) || null;
}

/** Лінії схеми через усі зупинки вузла — вузол «бачить» усі маршрути, а не лише головну зупинку. */
export function routesAtNode(dataset: StopsDataset, node: SchemeNode): string[] {
  const hidden = hiddenTransportRouteIds(dataset);
  return inLegendOrder(node.stopIds.flatMap((id) => rawRoutesAtStop(dataset, id, hidden)));
}

export type SchemeNodeStop = {
  stopId: string;
  /** Назва з датасету (для зупинки без запису — її id) */
  name: string;
  routeIds: string[];
};

/**
 * Зупинки вузла з назвами й лініями кожної — для картки «Ви тут» на схемі («Лікарня (2, 5, 9) ·
 * Поліклініка (2, 3, 5, 7, 12)»). Зупинки, яких немає в датасеті, пропускаються.
 */
export function stopsOfNode(
  dataset: StopsDataset & Pick<TransportDataset, 'stops'>,
  node: SchemeNode
): SchemeNodeStop[] {
  const hidden = hiddenTransportRouteIds(dataset);
  const names = new Map(dataset.stops.map((s) => [s.id, s.name] as const));
  return node.stopIds
    .filter((id) => names.has(id))
    .map((id) => ({ stopId: id, name: names.get(id) || id, routeIds: inLegendOrder(rawRoutesAtStop(dataset, id, hidden)) }));
}
