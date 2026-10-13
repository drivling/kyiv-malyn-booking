/**
 * Варіанти шляху маршруту (Docs/route-variants-2026-10.md): рейс з variant_id іде ланцюжком варіанта замість
 * основного ланцюжка свого напрямку. Тут — вибір ланцюжка рейсу й «які зупинки маршрут обслуговує» з урахуванням
 * варіантів; решта коду (час, табло, планер, карта) бере ланцюжок звідси.
 */
import type { RouteVariantVm, TransportData, TransportRecord } from './types';
import { routeStopChain, withOrder, type RouteDirection, type StopsByRoute } from './routeGeometry';
import { getStopKey } from './stopCatalog';

export type VariantsByRoute = Record<string, RouteVariantVm[] | undefined>;

/** Ланцюжки маршрутів з даних сайту: основні й варіанти */
export function routeChainSources(data: TransportData | null | undefined): {
  stopsByRoute: StopsByRoute | undefined;
  variantsByRoute: VariantsByRoute | undefined;
} {
  return {
    stopsByRoute: data?.supplement?.stops?.stops_by_route,
    variantsByRoute: data?.supplement?.stops?.variants_by_route,
  };
}

/** Напрямок рейсу: direction_id "0" — назад, інакше туди */
export function recordDirection(record: Pick<TransportRecord, 'direction_id'>): RouteDirection {
  return String(record.direction_id) === '0' ? 'back' : 'there';
}

/** Варіант рейсу, якщо він є серед варіантів маршруту й того самого напрямку; інакше null (основний ланцюжок). */
export function recordVariant(
  variantsByRoute: VariantsByRoute | undefined,
  record: Pick<TransportRecord, 'route_id' | 'direction_id' | 'variant_id'>
): RouteVariantVm | null {
  if (!record.variant_id) return null;
  const variant = variantsByRoute?.[record.route_id]?.find((v) => v.id === record.variant_id);
  return variant && variant.direction === recordDirection(record) ? variant : null;
}

/** Ключі точок варіанта в порядку руху (з технічними, якщо не markersOnly) */
export function variantChain(variant: RouteVariantVm, opts: { markersOnly?: boolean } = {}): string[] {
  return variant.stops.filter((p) => !opts.markersOnly || !p.map_only).map((p) => p.id);
}

/** Кінцева варіанта: остання пасажирська зупинка його ланцюжка */
export function variantEndStopId(variant: RouteVariantVm): string | undefined {
  const markers = variantChain(variant, { markersOnly: true });
  return markers[markers.length - 1];
}

/** Ланцюжок рейсу: варіант шляху або основний ланцюжок напрямку (з технічними точками, якщо не markersOnly). */
export function chainForRecord(
  stopsByRoute: StopsByRoute | undefined,
  variantsByRoute: VariantsByRoute | undefined,
  record: Pick<TransportRecord, 'route_id' | 'direction_id' | 'variant_id'>,
  opts: { markersOnly?: boolean } = {}
): string[] {
  const variant = recordVariant(variantsByRoute, record);
  if (variant) return variantChain(variant, opts);
  return routeStopChain(stopsByRoute, record.route_id, recordDirection(record), opts);
}

/** Пасажирські зупинки маршруту: основні ланцюжки (порядок > 0 хоч в одному напрямку, не map_only) ∪ варіанти. */
export function servedStopIds(
  stopsByRoute: StopsByRoute | undefined,
  variantsByRoute: VariantsByRoute | undefined,
  routeId: string
): Set<string> {
  const ids = new Set<string>();
  for (const s of withOrder(stopsByRoute?.[routeId] ?? [])) {
    if (!s.map_only && ((s.order_there ?? 0) > 0 || (s.order_back ?? 0) > 0)) ids.add(getStopKey(s));
  }
  for (const v of variantsByRoute?.[routeId] ?? []) for (const id of variantChain(v, { markersOnly: true })) ids.add(id);
  return ids;
}

/** Ланцюжок маршруту, у якому зупинка «звідки» стоїть раніше за «куди» */
export interface ChainServingPair {
  direction: RouteDirection;
  /** null — основний ланцюжок напрямку */
  variantId: string | null;
  /** Ключі точок у порядку руху (з технічними) */
  chain: string[];
}

/**
 * Усі ланцюжки маршруту, що везуть від fromKey до toKey (обидві — пасажирські, from раніше за to):
 * спершу основні «туди» й «назад», потім варіанти шляху.
 */
export function chainsServingPair(
  stopsByRoute: StopsByRoute | undefined,
  variantsByRoute: VariantsByRoute | undefined,
  routeId: string,
  fromKey: string,
  toKey: string
): ChainServingPair[] {
  const out: ChainServingPair[] = [];
  const serves = (markers: string[]) => {
    const a = markers.indexOf(fromKey);
    const b = markers.indexOf(toKey);
    return a >= 0 && b >= 0 && a < b;
  };
  for (const direction of ['there', 'back'] as const) {
    if (serves(routeStopChain(stopsByRoute, routeId, direction, { markersOnly: true }))) {
      out.push({ direction, variantId: null, chain: routeStopChain(stopsByRoute, routeId, direction) });
    }
  }
  for (const v of variantsByRoute?.[routeId] ?? []) {
    if (serves(variantChain(v, { markersOnly: true }))) out.push({ direction: v.direction, variantId: v.id, chain: variantChain(v) });
  }
  return out;
}
