/**
 * Перейменування зупинки в редакторі карти — чисті функції.
 *
 * Назва зупинки — рядковий «зовнішній ключ»: сайт резолвить кінцеві маршрутів (`routes.fromName/
 * toName`) назвою через `invertNameToId`, а headsign рейсів показується на картках як «→ Лікарня».
 * Тому перейменування пропагується при збереженні на все, що точно дорівнює старій назві. Пропагація
 * похідна від `baseDataset` (знімок бази), а не збережений стан: повернути назву з бази — і зупинка
 * зникає з мапи перейменувань; ланцюжок A→B→C стискається до A→C.
 */
import { getStopKey, type StopsCatalog } from '../LocalTransportPage/stopCatalog';
import type { TransportDataset, TransportRouteStopDto, TransportStopDto } from '@/api/transportDataset';
import type { RouteStop, TransportData } from './mapEditorModel';

export const MAX_STOP_NAME_LENGTH = 80;

/** trim + стиснути внутрішні пробіли */
export function normalizeStopName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function nameKey(name: string): string {
  return normalizeStopName(name).toLocaleLowerCase('uk');
}

/** null — назва прийнятна; інакше текст помилки для поля */
export function validateStopName(raw: string, catalog: StopsCatalog | undefined, stopId: string): string | null {
  const name = normalizeStopName(raw);
  if (!name) return 'Назва не може бути порожньою';
  if (name.length > MAX_STOP_NAME_LENGTH) return `Назва задовга (макс. ${MAX_STOP_NAME_LENGTH} символів)`;
  if (catalog) {
    const key = nameKey(name);
    for (const [id, v] of Object.entries(catalog)) {
      if (id === stopId || !v?.name) continue;
      if (nameKey(v.name) === key) return `Така назва вже є: ${v.name} (${id})`;
    }
  }
  return null;
}

/**
 * Нова назва в каталозі та в полі `name` зупинки в усіх маршрутах (ключ id не змінюється).
 * Повертає той самий об'єкт, якщо нормалізована назва не відрізняється від поточної.
 */
export function renameStopInEditor(transport: TransportData, stopId: string, newName: string): TransportData {
  const name = normalizeStopName(newName);
  if (!name) return transport;
  const catalog = transport.supplement?.stops?.stops_catalog ?? {};
  const current = catalog[stopId]?.name ?? stopId;
  if (name === current) return transport;
  const sbr = transport.supplement?.stops?.stops_by_route ?? {};
  const newSbr: Record<string, RouteStop[] | string[]> = {};
  for (const [routeId, stops] of Object.entries(sbr)) {
    if (!Array.isArray(stops) || stops.length === 0) {
      newSbr[routeId] = stops;
      continue;
    }
    const first = stops[0];
    if (typeof first === 'object' && first && 'name' in first) {
      newSbr[routeId] = (stops as RouteStop[]).map((s) => (getStopKey(s) === stopId ? { ...s, name } : s));
    } else {
      // Легасі-форма (масив назв): назва і є ключем
      newSbr[routeId] = (stops as string[]).map((n) => (n === stopId ? name : n));
    }
  }
  return {
    ...transport,
    supplement: {
      ...transport.supplement,
      stops: {
        ...transport.supplement?.stops,
        stops_catalog: { ...catalog, [stopId]: { name } },
        stops_by_route: newSbr,
      },
    },
  };
}

/** назва в базі → поточна назва, лише для зупинок, чия назва в редакторі відрізняється від бази */
export function buildStopRenameMap(baseStops: TransportStopDto[], catalog: StopsCatalog | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!catalog) return map;
  for (const s of baseStops) {
    const current = catalog[s.id]?.name;
    if (current && current !== s.name) map.set(s.name, current);
  }
  return map;
}

export interface RenamePropagationResult {
  dataset: TransportDataset;
  touchedRoutes: Array<{ routeId: string; field: 'fromName' | 'toName' }>;
  touchedTrips: number;
}

/**
 * Один прохід по `routes[].fromName/toName` і `trips[].headsign`: точний збіг зі СТАРИМ рядком.
 * Порожня мапа або жодного збігу — те саме посилання на датасет.
 */
export function applyStopRenamesToDataset(dataset: TransportDataset, renameMap: Map<string, string>): RenamePropagationResult {
  if (renameMap.size === 0) return { dataset, touchedRoutes: [], touchedTrips: 0 };
  const touchedRoutes: RenamePropagationResult['touchedRoutes'] = [];
  const routes = dataset.routes.map((r) => {
    let next = r;
    for (const field of ['fromName', 'toName'] as const) {
      const value = r[field];
      const renamed = value ? renameMap.get(value) : undefined;
      if (renamed === undefined) continue;
      next = { ...next, [field]: renamed };
      touchedRoutes.push({ routeId: r.id, field });
    }
    return next;
  });
  let touchedTrips = 0;
  const trips = dataset.trips.map((t) => {
    const renamed = t.headsign ? renameMap.get(t.headsign) : undefined;
    if (renamed === undefined) return t;
    touchedTrips += 1;
    return { ...t, headsign: renamed };
  });
  if (touchedRoutes.length === 0 && touchedTrips === 0) return { dataset, touchedRoutes, touchedTrips };
  return {
    dataset: {
      ...dataset,
      routes: touchedRoutes.length ? routes : dataset.routes,
      trips: touchedTrips ? trips : dataset.trips,
    },
    touchedRoutes,
    touchedTrips,
  };
}

export interface RenamePropagationSummary {
  routeIds: string[];
  tripCount: number;
}

/** Що зачепить перейменування зупинки зі старою назвою `oldName` (по знімку бази) */
export function summarizeRenamePropagation(
  base: Pick<TransportDataset, 'routes' | 'trips'>,
  oldName: string
): RenamePropagationSummary {
  const routeIds: string[] = [];
  for (const r of base.routes) {
    if ((r.fromName === oldName || r.toName === oldName) && !routeIds.includes(r.id)) routeIds.push(r.id);
  }
  const tripCount = base.trips.filter((t) => t.headsign === oldName).length;
  return { routeIds, tripCount };
}

/** 1 зміна / 2 зміни / 5 змін */
export function pluralUk(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** «Також оновиться при збереженні: кінцева №5, №11 · 55 рейсів» або null, коли нічого */
export function formatPropagationSummary(s: RenamePropagationSummary): string | null {
  const parts: string[] = [];
  if (s.routeIds.length) parts.push(`кінцева ${s.routeIds.map((id) => `№${id}`).join(', ')}`);
  if (s.tripCount) parts.push(`${s.tripCount} ${pluralUk(s.tripCount, ['рейс', 'рейси', 'рейсів'])}`);
  if (parts.length === 0) return null;
  return `Також оновиться при збереженні: ${parts.join(' · ')}`;
}

export function formatChangesLabel(n: number): string {
  return `${n} ${pluralUk(n, ['зміна', 'зміни', 'змін'])}`;
}

export interface EditorChanges {
  renamedStops: string[];
  movedStops: string[];
  addedStops: string[];
  /** змінені / додані / прибрані записи «зупинка в маршруті» (порядок, map_only), без записів нових зупинок */
  routeStopChanges: number;
  total: number;
}

const EMPTY_CHANGES: EditorChanges = { renamedStops: [], movedStops: [], addedStops: [], routeStopChanges: 0, total: 0 };

function routeStopKey(rs: TransportRouteStopDto): string {
  return `${rs.routeId}|${rs.stopId}`;
}

/** Нормалізовано: datasetToEditor перетворює undefined на -1, щоб не було фантомних відмінностей */
function routeStopSignature(rs: TransportRouteStopDto): string {
  return `${rs.orderThere ?? -1}|${rs.orderBack ?? -1}|${rs.mapOnly === true ? 1 : 0}`;
}

/**
 * Різниця між тим, що піде в PUT (`editorToDataset(...)`), і знімком бази — вичерпна для всього,
 * що редагує вкладка: назви, координати, нові технічні зупинки, порядок і map_only у маршрутах.
 * Кінцеві/headsign, які зміняться через пропагацію, не рахуються окремо — вони наслідок перейменування.
 */
export function countEditorChanges(base: TransportDataset | null, next: TransportDataset | null): EditorChanges {
  if (!base || !next) return EMPTY_CHANGES;
  const baseStops = new Map(base.stops.map((s) => [s.id, s]));
  const renamedStops: string[] = [];
  const movedStops: string[] = [];
  const addedStops: string[] = [];
  for (const s of next.stops) {
    const b = baseStops.get(s.id);
    if (!b) {
      addedStops.push(s.id);
      continue;
    }
    if (b.name !== s.name) renamedStops.push(s.id);
    if (b.lat !== s.lat || b.lng !== s.lng) movedStops.push(s.id);
  }
  const added = new Set(addedStops);
  const baseRs = new Map(base.routeStops.map((rs) => [routeStopKey(rs), routeStopSignature(rs)]));
  const seen = new Set<string>();
  let routeStopChanges = 0;
  for (const rs of next.routeStops) {
    const key = routeStopKey(rs);
    seen.add(key);
    if (added.has(rs.stopId)) continue;
    const prev = baseRs.get(key);
    if (prev === undefined || prev !== routeStopSignature(rs)) routeStopChanges += 1;
  }
  for (const key of baseRs.keys()) {
    if (!seen.has(key)) routeStopChanges += 1;
  }
  return {
    renamedStops,
    movedStops,
    addedStops,
    routeStopChanges,
    total: renamedStops.length + movedStops.length + addedStops.length + routeStopChanges,
  };
}

/** Пошук у списку: по назві або id, без урахування регістру; порожній запит — список без змін */
export function filterStopIds(ids: string[], catalog: StopsCatalog | undefined, query: string): string[] {
  const q = normalizeStopName(query).toLocaleLowerCase('uk');
  if (!q) return ids;
  return ids.filter(
    (id) => id.toLocaleLowerCase('uk').includes(q) || (catalog?.[id]?.name ?? '').toLocaleLowerCase('uk').includes(q)
  );
}
