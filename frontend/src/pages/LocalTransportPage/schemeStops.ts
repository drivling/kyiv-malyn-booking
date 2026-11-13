import { hiddenTransportRouteIds, variantsStopAt, type TransportDataset } from '@/api/transportDataset';
import type { CityScheme, SchemeNode } from './scheme/registry';
import { currentScheme } from './routeColors';

type StopsDataset = Pick<TransportDataset, 'routes' | 'routeStops'>;

type SchemeIndex = { rank: ReadonlyMap<string, number>; nodeByStop: ReadonlyMap<string, SchemeNode> };
const indexes = new WeakMap<CityScheme, SchemeIndex>();

function indexOf(scheme: CityScheme): SchemeIndex {
  let ix = indexes.get(scheme);
  if (!ix) {
    ix = {
      rank: new Map(scheme.routes.map((r, i) => [r.id, i])),
      nodeByStop: new Map(scheme.nodes.flatMap((n) => n.stopIds.map((id) => [id, n] as const))),
    };
    indexes.set(scheme, ix);
  }
  return ix;
}

const byNumber = new Intl.Collator('uk', { numeric: true });

/**
 * Лінії в порядку легенди схеми (маршрути поза схемою відкидаються); у міста без схеми — усі лінії
 * за номером.
 */
function inLegendOrder(ids: Iterable<string>, scheme: CityScheme | null): string[] {
  const uniq = [...new Set(ids)];
  if (!scheme) return uniq.sort(byNumber.compare);
  const rank = indexOf(scheme).rank;
  return uniq.filter((id) => rank.has(id)).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/** Зупинка справді обслуговується маршрутом: є в ланцюжку хоча б одного напрямку (не -1 / -1 з адмінки). */
function servesStop(rs: StopsDataset['routeStops'][number]): boolean {
  return Number(rs.orderThere) > 0 || Number(rs.orderBack) > 0;
}

/**
 * Лінії через зупинку з routeStops датасету: без «лише для карти» (mapOnly), без ненадійних маршрутів
 * і без маршрутів, на яких зупинку вимкнено (-1 в обидва боки) — інакше схема підсвічує лінію там,
 * де автобус не зупиняється. Плюс маршрути, чий варіант шляху тут зупиняється (перший рейс №9 — вокзал).
 */
function rawRoutesAtStop(dataset: StopsDataset, stopId: string, hidden: Set<string>): string[] {
  const out: string[] = [];
  for (const rs of dataset.routeStops) {
    if (rs.stopId === stopId && !rs.mapOnly && !hidden.has(rs.routeId) && servesStop(rs)) out.push(rs.routeId);
  }
  for (const r of dataset.routes) {
    if (!hidden.has(r.id) && variantsStopAt(r, stopId)) out.push(r.id);
  }
  return out;
}

/**
 * Лінії схеми, що проходять через зупинку: з routeStops датасету, без «лише для карти»
 * (mapOnly), без ненадійних маршрутів і без вимкнених членств (-1 / -1); порядок — як у легенді
 * схеми міста (ROUTE_ORDER генератора).
 * Маршрути поза схемою (міжміські, без кольору) не повертаються; місто без схеми — усі лінії за номером.
 * `scheme` — схема міста сторінки (за замовчуванням — міста, чий датасет зараз завантажено).
 */
export function routesAtStop(dataset: StopsDataset, stopId: string, scheme: CityScheme | null = currentScheme()): string[] {
  if (!stopId) return [];
  return inLegendOrder(rawRoutesAtStop(dataset, stopId, hiddenTransportRouteIds(dataset)), scheme);
}

/**
 * Вузол схеми, якому належить зупинка (вузол = кілька фізичних зупинок, див. <місто>-scheme-nodes.ts),
 * або null, якщо зупинки на схемі немає (чи в міста нема схеми).
 */
export function schemeNodeForStop(stopId: string, scheme: CityScheme | null = currentScheme()): SchemeNode | null {
  return (stopId && scheme && indexOf(scheme).nodeByStop.get(stopId)) || null;
}

/** Лінії схеми через усі зупинки вузла — вузол «бачить» усі маршрути, а не лише головну зупинку. */
export function routesAtNode(dataset: StopsDataset, node: SchemeNode, scheme: CityScheme | null = currentScheme()): string[] {
  const hidden = hiddenTransportRouteIds(dataset);
  return inLegendOrder(
    node.stopIds.flatMap((id) => rawRoutesAtStop(dataset, id, hidden)),
    scheme
  );
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
  node: SchemeNode,
  scheme: CityScheme | null = currentScheme()
): SchemeNodeStop[] {
  const hidden = hiddenTransportRouteIds(dataset);
  const names = new Map(dataset.stops.map((s) => [s.id, s.name] as const));
  return node.stopIds
    .filter((id) => names.has(id))
    .map((id) => ({ stopId: id, name: names.get(id) || id, routeIds: inLegendOrder(rawRoutesAtStop(dataset, id, hidden), scheme) }));
}
