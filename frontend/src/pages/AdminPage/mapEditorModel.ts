/**
 * Легасі-форма даних, з якою працює редактор карти (MapEditorTab) і його права панель:
 * `stops_catalog[id] = { name }`, `stops_by_route[routeId]` — об'єкти з id/порядком або (старий
 * формат) масив назв. Спільна для MapEditorTab, MapEditorStopsPanel і stopRename.
 */
import type { StopsCatalog } from '../LocalTransportPage/stopCatalog';

export interface StopsCoordsData {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

export interface RouteStop {
  /** Стабільний ключ (координати, сегменти) — як у public/data */
  id?: string;
  name: string;
  order_there?: number;
  order_back?: number;
  /** Точка тільки для карти й розрахунку (не показується в списку зупинок для пасажирів) */
  map_only?: boolean;
}

export interface SupplementRoute {
  from?: string;
  to?: string;
}

export interface TransportData {
  source?: string;
  records?: unknown[];
  supplement?: {
    stops?: {
      stops_by_route?: Record<string, RouteStop[] | string[]>;
      stops_catalog?: StopsCatalog;
    };
    routes?: Record<string, SupplementRoute>;
  };
  [key: string]: unknown;
}

export function getRouteStopsWithOrder(
  sbr: Record<string, RouteStop[] | string[]> | undefined,
  routeId: string
): RouteStop[] {
  const routeStops = sbr?.[routeId];
  if (!Array.isArray(routeStops) || routeStops.length === 0) return [];
  const first = routeStops[0];
  if (typeof first === 'object' && 'order_there' in first) {
    return routeStops as RouteStop[];
  }
  const names = routeStops as unknown as string[];
  return names.map((name, i) => ({
    name,
    order_there: i + 1,
    order_back: names.length - i,
  }));
}
