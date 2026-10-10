/**
 * Зупинки зі статичними сторінками та маршрути в їхніх чіпах (prerender-transport-stops.mjs).
 *
 * Сторінку (і рядок у sitemap) має кожна зупинка, що стоїть хоча б на одному неприхованому маршруті
 * (рядок routeStops без mapOnly) — як і раніше, щоб не прибирати сторінки з індексу. У чіпах і в
 * описі — лише маршрути, де зупинку не вимкнено: -1 в обидва боки (orderThere ≤ 0 і orderBack ≤ 0)
 * означає, що автобус тут не зупиняється. Зупинка, вимкнена всюди, лишається зі сторінкою без чіпів
 * («наразі не проходить жоден активний маршрут»). SPA рахує так само: schemeStops.ts.
 *
 * @param {Array<{ stopId?: string, routeId?: string, orderThere?: number, orderBack?: number, mapOnly?: boolean }>} routeStops
 * @param {Set<string>} hiddenRouteIds ненадійні (приховані) маршрути
 * @returns {Map<string, Set<string>>} stopId → маршрути, що справді обслуговують зупинку
 */
export function stopRoutesFromRouteStops(routeStops, hiddenRouteIds) {
  const stopToRoutes = new Map();
  for (const rs of routeStops || []) {
    if (!rs?.stopId || !rs?.routeId) continue;
    if (!String(rs.stopId).startsWith('st_')) continue;
    if (hiddenRouteIds.has(String(rs.routeId))) continue;
    if (rs.mapOnly === true) continue; // лише точка геометрії на карті, не зупинка маршруту
    if (!stopToRoutes.has(rs.stopId)) stopToRoutes.set(rs.stopId, new Set());
    if (Number(rs.orderThere) > 0 || Number(rs.orderBack) > 0) stopToRoutes.get(rs.stopId).add(String(rs.routeId));
  }
  return stopToRoutes;
}
