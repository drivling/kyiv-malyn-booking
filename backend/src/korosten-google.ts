/**
 * Перевірка прогонів чернетки Коростеня через Google Routes API (TRANSIT) — Docs/korosten-transport-data-2026-11.md.
 * Чисті функції: трійки сусідніх зупинок кожного ланцюжка, розбір лінії шляху Google (encoded polyline), відстані наших
 * точок до траси й висновок по трійці. Мережу кличе скрипт korosten-dataset (--google-hops); у репозиторій іде лише
 * висновок без координат Google (google/hops.json), повна відповідь — лише локально (google/hops.local.json).
 */
import { distanceM } from './korosten-osm';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Ланцюжок датасету: основний напрямок або варіант шляху */
export interface DatasetChain {
  routeId: string;
  /** Номер для показу (shortName або id) */
  routeNo: string;
  directionId: '0' | '1';
  variantId: string | null;
  stopIds: string[];
}

/** Трійка сусідніх зупинок ланцюжка A → B → C (для ланцюжка з двох зупинок — пара, b = null) */
export interface HopTriple {
  key: string;
  a: string;
  b: string | null;
  c: string;
  /** Маршрути, у ланцюжках яких є ця трійка: «7», «7 (через вул. Франка)» */
  routes: Array<{ routeId: string; routeNo: string; variantId: string | null }>;
}

type DatasetLike = {
  routes: Array<{ id: string; shortName?: string; variants?: Array<{ id: string; directionId: '0' | '1'; stops: Array<{ stopId: string; mapOnly?: boolean }> }> }>;
  routeStops: Array<{ routeId: string; stopId: string; orderThere: number; orderBack: number; mapOnly?: boolean }>;
};

/** Усі ланцюжки датасету: по два основні напрямки на маршрут і варіанти шляху (лише пасажирські зупинки) */
export function datasetChains(dataset: DatasetLike): DatasetChain[] {
  const out: DatasetChain[] = [];
  for (const r of dataset.routes) {
    const routeNo = r.shortName || r.id;
    for (const [key, directionId] of [['orderThere', '1'], ['orderBack', '0']] as const) {
      const stopIds = dataset.routeStops
        .filter((x) => x.routeId === r.id && x[key] > 0 && !x.mapOnly)
        .sort((x, y) => x[key] - y[key])
        .map((x) => x.stopId);
      if (stopIds.length >= 2) out.push({ routeId: r.id, routeNo, directionId, variantId: null, stopIds });
    }
    for (const v of r.variants ?? []) {
      const stopIds = v.stops.filter((s) => !s.mapOnly).map((s) => s.stopId);
      if (stopIds.length >= 2) out.push({ routeId: r.id, routeNo, directionId: v.directionId, variantId: v.id, stopIds });
    }
  }
  return out;
}

/** Трійки сусідніх зупинок усіх ланцюжків; спільна для кількох маршрутів трійка — одна, з усіма маршрутами */
export function hopTriples(chains: DatasetChain[]): HopTriple[] {
  const byKey = new Map<string, HopTriple>();
  const add = (a: string, b: string | null, c: string, ch: DatasetChain): void => {
    const key = b ? `${a}>${b}>${c}` : `${a}>${c}`;
    const t = byKey.get(key) ?? { key, a, b, c, routes: [] };
    if (!t.routes.some((r) => r.routeId === ch.routeId && r.variantId === ch.variantId)) {
      t.routes.push({ routeId: ch.routeId, routeNo: ch.routeNo, variantId: ch.variantId });
    }
    byKey.set(key, t);
  };
  for (const ch of chains) {
    if (ch.stopIds.length === 2) add(ch.stopIds[0], null, ch.stopIds[1], ch);
    for (let i = 0; i + 2 < ch.stopIds.length; i++) add(ch.stopIds[i], ch.stopIds[i + 1], ch.stopIds[i + 2], ch);
  }
  return [...byKey.values()];
}

/** Google encoded polyline → точки */
export function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && i < encoded.length + 1);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** Відстань від точки до відрізка (метри, локальна площина) */
function pointToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos((p.lat * Math.PI) / 180) * 111_195;
  const ax = (a.lng - p.lng) * k;
  const ay = (a.lat - p.lat) * 111_195;
  const bx = (b.lng - p.lng) * k;
  const by = (b.lat - p.lat) * 111_195;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Відстань від точки до лінії (метри) */
export function pointToPolylineM(p: LatLng, line: LatLng[]): number {
  if (!line.length) return Infinity;
  if (line.length === 1) return distanceM(p, line[0]);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, pointToSegmentM(p, line[i], line[i + 1]));
  return best;
}

/** Наскільки пряма A→B відходить від траси: найбільша відстань точок прямої (крок ~25 м) до лінії */
export function segmentDeviationM(a: LatLng, b: LatLng, line: LatLng[]): number {
  const n = Math.max(2, Math.ceil(distanceM(a, b) / 25));
  let worst = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    worst = Math.max(worst, pointToPolylineM({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, line));
  }
  return worst;
}

/** «2-Б», «2Б», «2б» → «2Б»: номер лінії Google проти нашого */
export function normalizeLine(no: string): string {
  return no.replace(/[\s-]/g, '').toUpperCase();
}

/** Що повернув Google на трійку: кроки громадського транспорту кожної альтернативи */
export interface GoogleTransitStep {
  line: string;
  stopCount: number | null;
  departure: LatLng | null;
  arrival: LatLng | null;
  polyline: LatLng[];
}

/** Висновок по трійці (без координат Google) — те, що йде в google/hops.json і звіт */
export interface HopVerdict {
  key: string;
  routes: string[];
  /** Лінії, які Google пропонує першим кроком (будь-які) */
  googleLines: string[];
  /** Чи є серед них наш маршрут (номер для показу) */
  ourLine: boolean;
  /** Перегонів від A до C за Google (stopCount: без A, з C) і в нашому ланцюжку (2 для трійки, 1 для пари) */
  stopCount: number | null;
  expected: number;
  /** Відстані наших точок до траси Google, м */
  aOffM: number | null;
  bOffM: number | null;
  cOffM: number | null;
  /** Наскільки наші прямі A→B→C зрізають трасу Google, м */
  cutM: number | null;
  /** Наші координати A, B, C на момент перевірки — щоб звіт бачив застарілу перевірку */
  ours: Array<[number, number]>;
  status: 'ok' | 'other-line' | 'stop-count' | 'off-route' | 'cut' | 'no-transit';
}

/** Точка зупинки далі цього від траси Google — не на трасі або не та зупинка */
export const OFF_ROUTE_M = 80;
/** Пряма між зупинками відходить від траси більше — тут поворот, на карті потрібні технічні точки */
export const CUT_M = 150;

export function hopVerdict(
  triple: HopTriple,
  ours: { a: LatLng; b: LatLng | null; c: LatLng },
  steps: GoogleTransitStep[][],
): HopVerdict {
  const ourNos = new Set(triple.routes.map((r) => normalizeLine(r.routeNo)));
  const firstSteps = steps.map((alt) => alt[0]).filter(Boolean) as GoogleTransitStep[];
  const googleLines = [...new Set(firstSteps.map((s) => s.line))].sort();
  const mine = steps.map((alt) => (alt.length === 1 ? alt[0] : null)).find((s) => s && ourNos.has(normalizeLine(s.line))) ?? null;
  const expected = triple.b ? 2 : 1;
  const r = (x: number): number => Math.round(x);
  const base = {
    key: triple.key,
    expected,
    routes: triple.routes.map((x) => (x.variantId ? `${x.routeNo} (${x.variantId})` : x.routeNo)),
    googleLines,
    ours: [ours.a, ...(ours.b ? [ours.b] : []), ours.c].map((p) => [p.lat, p.lng] as [number, number]),
  };
  if (!steps.length || !firstSteps.length) {
    return { ...base, ourLine: false, stopCount: null, aOffM: null, bOffM: null, cOffM: null, cutM: null, status: 'no-transit' };
  }
  if (!mine) {
    return { ...base, ourLine: false, stopCount: null, aOffM: null, bOffM: null, cOffM: null, cutM: null, status: 'other-line' };
  }
  const line = mine.polyline;
  const aOffM = line.length ? r(pointToPolylineM(ours.a, line)) : null;
  const bOffM = line.length && ours.b ? r(pointToPolylineM(ours.b, line)) : null;
  const cOffM = line.length ? r(pointToPolylineM(ours.c, line)) : null;
  const cutM = line.length
    ? r(ours.b ? Math.max(segmentDeviationM(ours.a, ours.b, line), segmentDeviationM(ours.b, ours.c, line)) : segmentDeviationM(ours.a, ours.c, line))
    : null;
  const off = [aOffM, bOffM, cOffM].some((x) => x !== null && x > OFF_ROUTE_M);
  const status: HopVerdict['status'] =
    mine.stopCount !== null && mine.stopCount !== expected ? 'stop-count' : off ? 'off-route' : cutM !== null && cutM > CUT_M ? 'cut' : 'ok';
  return { ...base, ourLine: true, stopCount: mine.stopCount, aOffM, bOffM, cOffM, cutM, status };
}
