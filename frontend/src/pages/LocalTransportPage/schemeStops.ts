import { hiddenTransportRouteIds, type TransportDataset } from '@/api/transportDataset';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';

/**
 * Лінії схеми, що проходять через зупинку: з routeStops датасету, без «лише для карти»
 * (mapOnly) і без ненадійних маршрутів; порядок — як у легенді схеми (ROUTE_ORDER генератора).
 * Маршрути поза схемою (міжміські, без кольору) не повертаються.
 */
export function routesAtStop(
  dataset: Pick<TransportDataset, 'routes' | 'routeStops'>,
  stopId: string
): string[] {
  if (!stopId) return [];
  const hidden = hiddenTransportRouteIds(dataset);
  const present = new Set<string>();
  for (const rs of dataset.routeStops) {
    if (rs.stopId === stopId && !rs.mapOnly && !hidden.has(rs.routeId)) present.add(rs.routeId);
  }
  return SCHEME_ROUTES.filter((r) => present.has(r.id)).map((r) => r.id);
}
