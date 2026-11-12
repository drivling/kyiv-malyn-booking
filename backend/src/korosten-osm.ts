/**
 * OpenStreetMap як чернетка координат зупинок Коростеня (Docs/korosten-transport-data-2026-11.md).
 * Знімок (data/korosten-transport/osm/*.json) робить скрипт korosten-dataset --fetch-osm; тут — чисті функції:
 * розбір відповідей Overpass / API OSM у знімок і зіставлення точок OSM з зупинками ради (z-0NN).
 * Дані OSM — © учасники OpenStreetMap, ODbL.
 */
import { stopNameKeys } from './korosten-stop-aliases';

/** Межі міста з околицями (Поліське водосховище — 50.906, ст. Житомирська — 28.59) */
export const KOROSTEN_BBOX = { south: 50.88, west: 28.5, north: 51.02, east: 28.75 } as const;

export interface OsmStop {
  /** node/123 або way/456 */
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface OsmRoute {
  /** relation/789 */
  id: string;
  ref: string;
  from: string;
  to: string;
  /** Платформи в порядку руху; id — як у OsmStop */
  platforms: OsmStop[];
}

export interface OsmSnapshot {
  fetchedAt: string;
  stops: OsmStop[];
  routes: OsmRoute[];
}

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  members?: Array<{ type: 'node' | 'way' | 'relation'; ref: number; role: string }>;
};

const round7 = (x: number): number => Math.round(x * 1e7) / 1e7;

function point(e: OverpassElement): { lat: number; lng: number } | null {
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat: round7(lat), lng: round7(lng) } : null;
}

/** Відповідь Overpass (out center tags) → зупинки з назвою, впорядковані за id */
export function osmStopsFromOverpass(elements: OverpassElement[]): OsmStop[] {
  const out: OsmStop[] = [];
  for (const e of elements) {
    if (e.type === 'relation') continue;
    const name = e.tags?.name?.trim();
    const p = point(e);
    if (!name || !p) continue;
    out.push({ id: `${e.type}/${e.id}`, name, ...p });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Відповідь API OSM `relation/<id>/full.json` → маршрут з платформами по порядку */
export function osmRouteFromFull(elements: OverpassElement[], relationId: number): OsmRoute {
  const byKey = new Map(elements.map((e) => [`${e.type}/${e.id}`, e] as const));
  const rel = byKey.get(`relation/${relationId}`);
  if (!rel) throw new Error(`relation ${relationId} is missing in the response`);
  const platforms: OsmStop[] = [];
  for (const m of rel.members ?? []) {
    if (!m.role.startsWith('platform')) continue;
    const e = byKey.get(`${m.type}/${m.ref}`);
    if (!e) continue;
    let p = point(e);
    if (!p && e.type === 'way') {
      // платформа-лінія: середня точка її вузлів
      const nodes = (e as OverpassElement & { nodes?: number[] }).nodes ?? [];
      const pts = nodes.map((n) => byKey.get(`node/${n}`)).map((n) => (n ? point(n) : null)).filter(Boolean) as Array<{ lat: number; lng: number }>;
      if (pts.length) p = { lat: round7(pts.reduce((s, q) => s + q.lat, 0) / pts.length), lng: round7(pts.reduce((s, q) => s + q.lng, 0) / pts.length) };
    }
    if (!p) continue;
    platforms.push({ id: `${m.type}/${m.ref}`, name: e.tags?.name?.trim() ?? '', ...p });
  }
  const t = rel.tags ?? {};
  return { id: `relation/${relationId}`, ref: t.ref ?? '', from: t.from ?? '', to: t.to ?? '', platforms };
}

/** Відстань у метрах (рівнокутна апроксимація — для міста досить) */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * 111_195, (a.lng - b.lng) * 111_195 * k);
}

/** Точки однієї зупинки по різні боки дороги — у межах цього радіуса */
export const SAME_STOP_RADIUS_M = 200;

export interface OsmMatch {
  lat: number;
  lng: number;
  /** id точок OSM, з яких узято середнє */
  osmIds: string[];
  /** Точки з тією самою назвою, які лишились осторонь (інша зупинка з такою ж назвою?) */
  outliers: string[];
}

/**
 * Зупинки ради (uid) → координати OSM за назвою. `names` — усі відомі назви зупинки (офіційна, з проєкту, з розкладу);
 * `hints` — ручні: id точки OSM → uid (або null — точку не брати). Точка, назва якої дає кілька uid, без підказки
 * не береться. Кілька точок однієї зупинки → найбільша група в радіусі SAME_STOP_RADIUS_M, середня точка.
 */
export function matchOsmStops(
  osm: OsmStop[],
  names: Map<string, string[]>,
  hints: Record<string, string | null> = {},
): { matches: Map<string, OsmMatch>; ambiguous: Array<{ osmId: string; name: string; uids: string[] }> } {
  const byKey = new Map<string, Set<string>>();
  for (const [uid, list] of names) {
    for (const n of list) {
      for (const k of stopNameKeys(n)) {
        if (!byKey.has(k)) byKey.set(k, new Set());
        byKey.get(k)?.add(uid);
      }
    }
  }
  const points = new Map<string, OsmStop[]>();
  const ambiguous: Array<{ osmId: string; name: string; uids: string[] }> = [];
  for (const s of osm) {
    let uid: string | null = null;
    if (s.id in hints) uid = hints[s.id];
    else {
      const c = new Set<string>();
      for (const k of stopNameKeys(s.name)) for (const u of byKey.get(k) ?? []) c.add(u);
      if (c.size === 1) uid = [...c][0];
      else if (c.size > 1) ambiguous.push({ osmId: s.id, name: s.name, uids: [...c].sort() });
    }
    if (!uid) continue;
    if (!points.has(uid)) points.set(uid, []);
    points.get(uid)?.push(s);
  }
  const matches = new Map<string, OsmMatch>();
  for (const [uid, list] of points) {
    let best: OsmStop[] = [];
    for (const p of list) {
      const group = list.filter((q) => distanceM(p, q) <= SAME_STOP_RADIUS_M);
      if (group.length > best.length) best = group;
    }
    best.sort((a, b) => a.id.localeCompare(b.id));
    const lat = round7(best.reduce((s, q) => s + q.lat, 0) / best.length);
    const lng = round7(best.reduce((s, q) => s + q.lng, 0) / best.length);
    const inBest = new Set(best.map((q) => q.id));
    matches.set(uid, { lat, lng, osmIds: [...inBest], outliers: list.filter((q) => !inBest.has(q.id)).map((q) => q.id).sort() });
  }
  return { matches, ambiguous: ambiguous.sort((a, b) => a.osmId.localeCompare(b.osmId)) };
}
