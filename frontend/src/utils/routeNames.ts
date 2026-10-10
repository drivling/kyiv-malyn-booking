/**
 * Номер міського маршруту для показу людям: «11/1», «5А». id маршруту лишається ключем — адреси
 * /transport/route/<id>, рейси, сегменти, кольори схеми, статті зупинок; показуємо TransportRoute.shortName
 * з датасету, а коли він порожній або його немає (старий бекенд) — id.
 *
 * Реєстр заповнює apiClient.getTransportDataset() при кожному завантаженні датасету (сайт, адмінка, стіна),
 * тож компонентам досить id: routeNo(id).
 */
let names: ReadonlyMap<string, string> = new Map();

type RouteNameSource = { id?: string | number | null; shortName?: string | null };

export function configureRouteNames(routes: ReadonlyArray<RouteNameSource> | null | undefined): void {
  const next = new Map<string, string>();
  for (const r of routes || []) {
    const id = r?.id == null ? '' : String(r.id);
    const no = typeof r?.shortName === 'string' ? r.shortName.trim() : '';
    if (id && no && no !== id) next.set(id, no);
  }
  names = next;
}

/** «11/1» для id «11»; без номера — сам id */
export function routeNo(routeId: string | number | null | undefined): string {
  const id = routeId == null ? '' : String(routeId);
  return names.get(id) ?? id;
}

/** Для адмінки: «11/1 (id 11)», коли номер відрізняється від id */
export function routeNoWithId(routeId: string): string {
  const no = routeNo(routeId);
  return no === routeId ? no : `${no} (id ${routeId})`;
}
