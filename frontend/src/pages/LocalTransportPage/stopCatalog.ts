/**
 * Каталог зупинок (st_XXXX) — стабільні ідентифікатори для URL, координат і сегментів.
 */
import type { RouteStopWithOrder, TransportData } from './types';

export type StopsCatalog = Record<string, { name: string }>;

/** Ключ зупинки: id з даних або назва (legacy без каталогу). */
export function getStopKey(s: { id?: string; name: string }): string {
  return (s.id && s.id.trim()) || s.name;
}

export function getStopsCatalog(data: TransportData | null | undefined): StopsCatalog | undefined {
  return data?.supplement?.stops?.stops_catalog;
}

/** Ім'я для відображення за id або повертає key, якщо каталогу немає. */
export function displayNameForStopKey(key: string, catalog?: StopsCatalog): string {
  if (catalog?.[key]?.name) return catalog[key].name;
  return key;
}

/** name → id (перший збіг; назви у каталозі унікальні). */
export function invertNameToId(catalog: StopsCatalog | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!catalog) return m;
  for (const [id, v] of Object.entries(catalog)) {
    if (v?.name) m.set(v.name, id);
  }
  return m;
}


/**
 * Фрагмент з URL — лише точний ключ каталогу (st_XXXX), після decodeURIComponent.
 */
export function resolveStopIdFromParam(
  param: string,
  catalog: StopsCatalog | undefined
): string | null {
  if (!param || !catalog) return null;
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    decoded = param;
  }
  return catalog[decoded] ? decoded : null;
}

/** Лише id зі списку або точний ключ у каталозі (без підбору за довгою назвою). */
export function resolveStopIdInList(
  raw: string,
  stopIds: string[],
  catalog: StopsCatalog | undefined
): string {
  if (!raw) return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  if (stopIds.includes(decoded)) return decoded;
  const byId = resolveStopIdFromParam(decoded, catalog);
  if (byId && stopIds.includes(byId)) return byId;
  return '';
}

/** Зібрати відсортовані id зупинок для комбобоксів. */
export function buildSortedStopIds(
  routes: Array<{ from: string | null; to: string | null }>,
  stopsByRoute: Record<string, string[] | RouteStopWithOrder[]> | undefined,
  catalog: StopsCatalog | undefined
): string[] {
  const nameToId = invertNameToId(catalog);
  const stopSet = new Set<string>();

  const addByName = (name: string | null) => {
    if (!name) return;
    const id = nameToId.get(name);
    if (id) stopSet.add(id);
    else stopSet.add(name);
  };

  routes.forEach((r) => {
    addByName(r.from);
    addByName(r.to);
  });

  if (stopsByRoute) {
    Object.values(stopsByRoute).forEach((stops) => {
      if (!stops?.length) return;
      const first = stops[0];
      if (typeof first === 'object' && first && 'name' in first) {
        (stops as RouteStopWithOrder[])
          .filter((s) => !s.map_only)
          .forEach((s) => stopSet.add(getStopKey(s)));
      } else {
        (stops as string[]).forEach((name) => {
          const id = nameToId.get(name);
          if (id) stopSet.add(id);
          else stopSet.add(name);
        });
      }
    });
  }

  ['Малинівка', 'Юрівка', 'БАМ', 'Царське село'].forEach((legacy) => {
    const id = nameToId.get(legacy);
    if (id) stopSet.add(id);
    else stopSet.add(legacy);
  });

  const list = [...stopSet];
  if (catalog) {
    return list.sort((a, b) => {
      const na = displayNameForStopKey(a, catalog);
      const nb = displayNameForStopKey(b, catalog);
      return na.localeCompare(nb, 'uk');
    });
  }
  return list.sort((a, b) => a.localeCompare(b, 'uk'));
}
