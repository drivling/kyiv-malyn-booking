/**
 * Зупинки зі статичними сторінками та маршрути в їхніх чіпах (prerender-transport-stops.mjs).
 *
 * Сторінку (і рядок у sitemap) має кожна зупинка, що стоїть хоча б на одному неприхованому маршруті
 * (рядок routeStops без mapOnly) — як і раніше, щоб не прибирати сторінки з індексу. У чіпах і в
 * описі — лише маршрути, де зупинку не вимкнено: -1 в обидва боки (orderThere ≤ 0 і orderBack ≤ 0)
 * означає, що автобус тут не зупиняється. Зупинка, вимкнена всюди, лишається зі сторінкою без чіпів
 * («наразі не проходить жоден активний маршрут»). Зупинки варіантів шляху (routes[].variants, без mapOnly)
 * теж дають сторінку й чіп маршруту: перший рейс №9 зупиняється на вокзалі, хоч основні ланцюжки — ні.
 * SPA рахує так само: schemeStops.ts.
 *
 * @param {Array<{ stopId?: string, routeId?: string, orderThere?: number, orderBack?: number, mapOnly?: boolean }>} routeStops
 * @param {Set<string>} hiddenRouteIds ненадійні (приховані) маршрути
 * @param {Array<{ id?: string | number, variants?: Array<{ stops?: Array<{ stopId?: string, mapOnly?: boolean }> }> | null }>} [routes]
 * @returns {Map<string, Set<string>>} stopId → маршрути, що справді обслуговують зупинку
 */
export function stopRoutesFromRouteStops(routeStops, hiddenRouteIds, routes) {
  const stopToRoutes = new Map();
  const add = (stopId, routeId) => {
    if (!stopToRoutes.has(stopId)) stopToRoutes.set(stopId, new Set());
    if (routeId != null) stopToRoutes.get(stopId).add(String(routeId));
  };
  for (const rs of routeStops || []) {
    if (!rs?.stopId || !rs?.routeId) continue;
    if (!String(rs.stopId).startsWith('st_')) continue;
    if (hiddenRouteIds.has(String(rs.routeId))) continue;
    if (rs.mapOnly === true) continue; // лише точка геометрії на карті, не зупинка маршруту
    add(rs.stopId, Number(rs.orderThere) > 0 || Number(rs.orderBack) > 0 ? rs.routeId : null);
  }
  for (const r of routes || []) {
    if (r?.id == null || hiddenRouteIds.has(String(r.id))) continue;
    for (const v of Array.isArray(r.variants) ? r.variants : []) {
      for (const p of Array.isArray(v?.stops) ? v.stops : []) {
        if (p?.stopId && String(p.stopId).startsWith('st_') && p.mapOnly !== true) add(p.stopId, r.id);
      }
    }
  }
  return stopToRoutes;
}

/**
 * Номери маршрутів для показу (TransportRoute.shortName: «11/1», «5А») — для чіпів і текстів статичних
 * сторінок. id лишається в адресах; без номера показуємо id (як routeNo() у SPA, frontend/src/utils/routeNames.ts).
 *
 * @param {Array<{ id?: string | number, shortName?: string | null }>} routes
 * @returns {Map<string, string>} id → номер (лише ті, що відрізняються від id)
 */
export function routeShortNames(routes) {
  const names = new Map();
  for (const r of routes || []) {
    const id = r?.id == null ? '' : String(r.id);
    const no = typeof r?.shortName === 'string' ? r.shortName.trim() : '';
    if (id && no && no !== id) names.set(id, no);
  }
  return names;
}

