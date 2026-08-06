/** Каталог зупинок (st_XXXX). */
export type StopsCatalog = Record<string, { name: string }>;

export function getStopKey(s: { id?: string; name: string; stopId?: string }): string {
  if (s.stopId) return s.stopId;
  return (s.id && s.id.trim()) || s.name;
}

export function displayNameForStopKey(key: string, catalog?: StopsCatalog): string {
  if (catalog?.[key]?.name) return catalog[key].name;
  return key;
}

export function invertNameToId(catalog: StopsCatalog | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!catalog) return m;
  for (const [id, v] of Object.entries(catalog)) {
    if (v?.name) m.set(v.name, id);
  }
  return m;
}

export function resolveStopIdFromParam(param: string, catalog: StopsCatalog | undefined): string | null {
  if (!param || !catalog) return null;
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    decoded = param;
  }
  return catalog[decoded] ? decoded : null;
}
