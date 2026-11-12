/**
 * Чернетка датасету міського транспорту Коростеня з джерел у репозиторії (Docs/korosten-transport-data-2026-11.md,
 * фаза 8 плану Docs/korosten-transport-2026-11.md). Чиста функція: джерела → датасет у форматі PUT /transport/dataset
 * і звіт «що перевірити руками». Мережі й бази не торкається; файли читає korosten-dataset-files.ts.
 *
 * - зупинки: перелік ради (stops.csv) + нові з розкладу; id z-0NN → st_10NN;
 * - порядок зупинок і хвилини між ними: проєкт власника 2025 року (chains.json) через stop-aliases.json;
 * - координати: OSM за назвою → середина вулиці (Nominatim) → між сусідами в ланцюжку → продовження ланцюжка;
 * - рейси: розклад ради 2026 року (timetable.json): напрямок за кінцевими, «*» → будні, «Графік» → blockId;
 * - ручні рішення (№2-Б, варіанти шляху, кольори, підказки OSM): data/korosten-transport/dataset-config.json.
 */
import type { ProjectDirection } from './korosten-project-parser';
import type { SourceRun, SourceTimetable } from './korosten-source-parser';
import type { OfficialStop, StopAliases } from './korosten-stop-aliases';
import { KOROSTEN_BBOX, distanceM, matchOsmStops, type OsmSnapshot } from './korosten-osm';

// ---------- вхід ----------

/** [код напрямку проєкту, від uid, до uid] або [uid] — окрема зупинка без хвилин */
export type ChainPart = [string, string, string] | [string];

export interface DatasetRouteConfig {
  id: string;
  shortName?: string;
  /** Номер маршруту в розкладі ради («2-Б») */
  rada: string;
  /** uid у routes.csv ради */
  csv: string;
  /** Код напрямку проєкту 2025 («11») — або thereParts/backParts для складеного ланцюжка */
  there?: string;
  back?: string;
  thereParts?: ChainPart[];
  backParts?: ChainPart[];
  /** Ланцюжок — припущення, перевірити руками */
  check?: boolean;
}

export interface DatasetVariantConfig {
  route: string;
  id: string;
  directionId: '0' | '1';
  name: string;
  parts: ChainPart[];
  when?: { italic?: boolean };
}

export interface KorostenDatasetConfig {
  sourceUrl: string;
  defaultSec: number;
  routes: DatasetRouteConfig[];
  colors: Record<string, string>;
  variants: DatasetVariantConfig[];
  osmHints: Record<string, string | null>;
}

export interface StreetPoint {
  lat: number;
  lng: number;
}

/** Перевірка точок через Google Places: лише place_id і відстань, без координат Google (умови Google Maps Platform) */
export interface GoogleCheck {
  checkedAt: string;
  stops: Record<string, { ours: [number, number]; placeId: string | null; name: string | null; distanceM: number | null }>;
  /** Routes API TRANSIT між кінцевими основного напрямку «туди»: які лінії пропонує Google */
  transit?: Array<{ routeId: string; from: string; to: string; lines: string[] }>;
}

/**
 * Координати Google (google/coords.local.json, поза git): власник бере їх тимчасово для приблизних точок, до
 * перевірки зупинок на місці. Ключ — id зупинки (st_10NN).
 */
export interface GoogleCoords {
  fetchedAt: string;
  stops: Record<string, { lat: number; lng: number; placeId: string; name: string | null }>;
}

export interface RouteCsvRow {
  uid: string;
  fullName: string;
  description: string;
}

export interface KorostenDatasetInput {
  official: OfficialStop[];
  aliases: StopAliases;
  directions: ProjectDirection[];
  timetable: SourceTimetable;
  routesCsv: RouteCsvRow[];
  config: KorostenDatasetConfig;
  osm: OsmSnapshot | null;
  /** Назва вулиці зі stops.csv → середня точка (Nominatim); null — не знайдено */
  streets: Record<string, StreetPoint | null> | null;
  google: GoogleCheck | null;
  /** Лише в локальній версії (--google-coords); закомічена чернетка — завжди null */
  googleCoords?: GoogleCoords | null;
}

// ---------- вихід (формат PUT /transport/dataset) ----------

export interface KStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}
export interface KRoute {
  id: string;
  fromName: string;
  toName: string;
  scheme: string;
  note: string;
  sourceUrl: string;
  schedule: null;
  unreliable: boolean;
  shortName: string;
  variants: Array<{ id: string; directionId: '0' | '1'; name: string; stops: Array<{ stopId: string }> }>;
}
export interface KRouteStop {
  routeId: string;
  stopId: string;
  orderThere: number;
  orderBack: number;
  mapOnly: boolean;
}
export interface KTrip {
  id: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  directionId: '0' | '1';
  departureTime: string;
  blockId: string;
  wheelchairAccessible: string;
  bikesAllowed: string;
  startStopId: string | null;
  endStopId: string | null;
  arrivalTime: string | null;
  variantId: string | null;
  timepoints: null;
}
export interface KSegment {
  routeId: string;
  fromStopId: string;
  toStopId: string;
  seconds: number;
}
export interface KorostenDataset {
  stops: KStop[];
  routes: KRoute[];
  routeStops: KRouteStop[];
  trips: KTrip[];
  segments: KSegment[];
  meta: { defaultSec: number; routeColors: Record<string, string>; source: string };
}

export type CoordSource = 'osm' | 'google' | 'street' | 'between' | 'extrapolated';

export interface KorostenDatasetResult {
  dataset: KorostenDataset;
  report: string;
  coordSource: Record<string, CoordSource>;
}

// ---------- допоміжне ----------

/** z-001 → st_1001, z-101 → st_1101 */
export function korostenStopId(uid: string): string {
  const m = /^z-(\d{3})$/.exec(uid);
  if (!m) throw new Error(`bad Korosten stop uid ${uid}`);
  return `st_1${m[1]}`;
}

/** Назва з переліку ради → назва на сайті: «Зупинка на вимогу “Ощадбанк”» → «Ощадбанк (на вимогу)» */
export function cleanStopName(label: string): string {
  let s = label
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1-$2')
    .replace(/[“„]/g, '«')
    .replace(/”/g, '»')
    .replace(/"([^"]*)"/g, '«$1»');
  // \b у JS — лише для латиниці, тому межу слова задаємо явно
  const onDemand = /^Зупинка на вимогу(?=$|[\s«])/i.exec(s);
  if (!onDemand) return s;
  s = s.slice(onDemand[0].length).trim();
  if (!s) return 'Зупинка на вимогу';
  s = s.replace(/^«([^»]*)»/, '$1').trim();
  return `${s} (на вимогу)`;
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const hhmmss = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
};
const round7 = (x: number): number => Math.round(x * 1e7) / 1e7;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const inBbox = (p: StreetPoint): boolean =>
  p.lat >= KOROSTEN_BBOX.south && p.lat <= KOROSTEN_BBOX.north && p.lng >= KOROSTEN_BBOX.west && p.lng <= KOROSTEN_BBOX.east;

/** Зупинка ланцюжка: uid і хвилина від початку ланцюжка (null — невідомо) */
interface ChainStop {
  uid: string;
  minute: number | null;
}

interface Chain {
  routeId: string;
  /** main-1 / main-0 / id варіанта */
  key: string;
  directionId: '0' | '1';
  variantId: string | null;
  italic: boolean;
  stops: ChainStop[];
}

/** Точка Google приймається, якщо до кожного відомого сусіда не далі max(1 км, 15 м/с × час між ними) по прямій */
const GOOGLE_NEAR_MIN_M = 1000;
const GOOGLE_NEAR_MPS = 15;
/** Скільки сусідніх узгоджених точок Google приймаються без якоря з OSM */
const GOOGLE_RUN_MIN = 3;

/** Мінімальний сегмент, як у «Перерахувати час» */
const MIN_SEGMENT_SEC = 30;
/** Розбіжність часу в дорозі (рада проти сегментів), після якої рейс отримує arrivalTime */
const ARRIVAL_TOLERANCE_MIN = 3;
/** Крок продовження ланцюжка за останню відому точку */
const EXTRAPOLATE_STEP_M = 300;

// ---------- генератор ----------

export function buildKorostenDataset(input: KorostenDatasetInput): KorostenDatasetResult {
  const { official, aliases, directions, timetable, routesCsv, config } = input;
  const officialByUid = new Map(official.map((s) => [s.uid, s] as const));
  const newByUid = new Map(aliases.newStops.map((s) => [s.tempId, s] as const));
  const nameToUid = new Map<string, string>(Object.entries(aliases.stops).map(([n, a]) => [n, a.uid]));
  for (const s of aliases.newStops) nameToUid.set(s.name, s.tempId);
  const directionByCode = new Map(directions.map((d) => [d.code, d] as const));
  const uidLabel = (uid: string): string => {
    const o = officialByUid.get(uid);
    if (o) return o.label;
    const n = newByUid.get(uid);
    if (n) return n.name;
    throw new Error(`unknown stop uid ${uid}`);
  };
  const stopName = (uid: string): string => cleanStopName(uidLabel(uid));

  /** Шматок напрямку проєкту між двома зупинками (включно), хвилини від початку шматка */
  const slice = (code: string, from: string, to: string): ChainStop[] => {
    const d = directionByCode.get(code);
    if (!d) throw new Error(`project direction ${code} is missing`);
    const uids = d.stops.map((s) => {
      const uid = nameToUid.get(s.name);
      if (!uid) throw new Error(`project ${code}: stop «${s.name}» has no alias`);
      return uid;
    });
    const i = uids.indexOf(from);
    const j = uids.lastIndexOf(to);
    if (i < 0 || j < 0 || j < i) throw new Error(`project ${code}: no slice ${from}…${to}`);
    const base = d.stops[i].minute;
    return uids.slice(i, j + 1).map((uid, k) => ({ uid, minute: d.stops[i + k].minute - base }));
  };
  const fullDirection = (code: string): ChainStop[] => {
    const d = directionByCode.get(code);
    if (!d) throw new Error(`project direction ${code} is missing`);
    const first = nameToUid.get(d.stops[0].name);
    const last = nameToUid.get(d.stops[d.stops.length - 1].name);
    if (!first || !last) throw new Error(`project ${code}: termini have no alias`);
    return slice(code, first, last);
  };
  /** Склеїти шматки: спільна зупинка на стику — одна; хвилини продовжуються, після зупинки без хвилин — невідомо */
  const join = (parts: ChainPart[]): ChainStop[] => {
    const out: ChainStop[] = [];
    for (const part of parts) {
      const piece: ChainStop[] = part.length === 1 ? [{ uid: part[0], minute: null }] : slice(part[0], part[1], part[2]);
      const offset = out.length ? out[out.length - 1].minute : 0;
      const start = out.length && out[out.length - 1].uid === piece[0].uid ? 1 : 0;
      for (const s of piece.slice(start)) {
        out.push({ uid: s.uid, minute: s.minute === null || offset === null ? null : offset + s.minute });
      }
      if (part.length === 1 && out.length) out[out.length - 1].minute = null;
    }
    return out;
  };

  // ланцюжки: основні напрямки, далі варіанти
  const chains: Chain[] = [];
  for (const r of config.routes) {
    const there = r.thereParts ? join(r.thereParts) : fullDirection(r.there ?? '');
    const back = r.backParts ? join(r.backParts) : fullDirection(r.back ?? '');
    chains.push({ routeId: r.id, key: 'main-1', directionId: '1', variantId: null, italic: false, stops: there });
    chains.push({ routeId: r.id, key: 'main-0', directionId: '0', variantId: null, italic: false, stops: back });
  }
  for (const v of config.variants) {
    chains.push({ routeId: v.route, key: v.id, directionId: v.directionId, variantId: v.id, italic: v.when?.italic === true, stops: join(v.parts) });
  }
  for (const c of chains) {
    const seen = new Set<string>();
    for (const s of c.stops) {
      if (seen.has(s.uid)) throw new Error(`route ${c.routeId} ${c.key}: stop ${s.uid} repeats`);
      seen.add(s.uid);
    }
  }

  // зупинки, що потрапляють у датасет
  const usedUids = [...new Set(chains.flatMap((c) => c.stops.map((s) => s.uid)))].sort();

  // ---------- координати ----------
  const coords = new Map<string, StreetPoint>();
  const coordSource: Record<string, CoordSource> = {};
  const names = new Map<string, string[]>();
  for (const uid of usedUids) names.set(uid, [uidLabel(uid)]);
  for (const [name, a] of Object.entries(aliases.stops)) names.get(a.uid)?.push(name);
  const osm = input.osm ? matchOsmStops(input.osm.stops, names, config.osmHints) : null;
  for (const uid of usedUids) {
    const m = osm?.matches.get(uid);
    if (m) {
      coords.set(uid, { lat: m.lat, lng: m.lng });
      coordSource[uid] = 'osm';
    }
  }
  // Google (лише локальна версія): замість приблизної точки, якщо вона узгоджена з сусідами по ланцюжку, чиї точки
  // вже відомі (OSM або прийняті раніше точки Google): до кожного такого сусіда — не далі, ніж автобус проїде за
  // хвилини між ними. Інакше Google, найпевніше, знайшов однойменну зупинку деінде. Ідемо від точок OSM хвилями.
  const googleRejected: Array<{ uid: string; meters: number | null }> = [];
  if (input.googleCoords) {
    const candidates = new Map<string, StreetPoint>();
    for (const uid of usedUids) {
      const g = coords.has(uid) ? null : input.googleCoords.stops[korostenStopId(uid)];
      if (g) candidates.set(uid, { lat: g.lat, lng: g.lng });
    }
    const verdict = (uid: string, g: StreetPoint): { known: number; worst: number | null; ok: boolean } => {
      let known = 0;
      let worst: number | null = null;
      let ok = true;
      for (const c of chains) {
        const i = c.stops.findIndex((x) => x.uid === uid);
        if (i < 0) continue;
        for (const j of [i - 1, i + 1]) {
          const n = c.stops[j];
          const p = n ? coords.get(n.uid) : undefined;
          if (!n || !p) continue;
          known++;
          const a = c.stops[Math.min(i, j)].minute;
          const b = c.stops[Math.max(i, j)].minute;
          const seconds = a !== null && b !== null ? Math.max(60, (b - a) * 60) : config.defaultSec;
          const meters = distanceM(g, p);
          if (worst === null || meters > worst) worst = Math.round(meters);
          if (meters > Math.max(GOOGLE_NEAR_MIN_M, GOOGLE_NEAR_MPS * seconds)) ok = false;
        }
      }
      return { known, worst, ok };
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const [uid, g] of candidates) {
        const v = verdict(uid, g);
        if (!v.known || !v.ok) continue;
        coords.set(uid, { lat: round7(g.lat), lng: round7(g.lng) });
        coordSource[uid] = 'google';
        candidates.delete(uid);
        changed = true;
      }
    }
    // другий крок: три й більше сусідніх по ланцюжку точок Google, узгоджених між собою за тим самим правилом, —
    // випадково однойменні зупинки деінде так не вишикуються; після них ще хвиля від прийнятих
    const fits = (c: Chain, i: number, j: number): boolean => {
      const a = c.stops[Math.min(i, j)].minute;
      const b = c.stops[Math.max(i, j)].minute;
      const seconds = a !== null && b !== null ? Math.max(60, (b - a) * 60) : config.defaultSec;
      const p = candidates.get(c.stops[i].uid) as StreetPoint;
      const q = candidates.get(c.stops[j].uid) as StreetPoint;
      return distanceM(p, q) <= Math.max(GOOGLE_NEAR_MIN_M, GOOGLE_NEAR_MPS * seconds);
    };
    for (const c of chains) {
      let run: number[] = [];
      const flush = (): void => {
        if (run.length >= GOOGLE_RUN_MIN) {
          for (const k of run) {
            const uid = c.stops[k].uid;
            const g = candidates.get(uid);
            if (!g || coords.has(uid)) continue;
            coords.set(uid, { lat: round7(g.lat), lng: round7(g.lng) });
            coordSource[uid] = 'google';
          }
        }
        run = [];
      };
      c.stops.forEach((st, k) => {
        if (!candidates.has(st.uid)) return flush();
        if (run.length && !fits(c, run[run.length - 1], k)) flush();
        run.push(k);
      });
      flush();
    }
    for (const uid of [...candidates.keys()]) if (coords.has(uid)) candidates.delete(uid);
    changed = true;
    while (changed) {
      changed = false;
      for (const [uid, g] of candidates) {
        const v = verdict(uid, g);
        if (!v.known || !v.ok) continue;
        coords.set(uid, { lat: round7(g.lat), lng: round7(g.lng) });
        coordSource[uid] = 'google';
        candidates.delete(uid);
        changed = true;
      }
    }
    for (const [uid, g] of candidates) googleRejected.push({ uid, meters: verdict(uid, g).worst });
  }

  // середина вулиці: Nominatim дає одну точку на вулицю, тож якщо на ній кілька зупинок, точку отримує середня з
  // них за порядком у першому ланцюжку, де вони трапляються, а решта стає між сусідами (інакше — купа в одній точці)
  const streetOf = (uid: string): string => (officialByUid.get(uid)?.street ?? '').trim();
  const byStreet = new Map<string, string[]>();
  for (const uid of usedUids) {
    if (coords.has(uid)) continue;
    const street = streetOf(uid);
    const p = street ? input.streets?.[street] : null;
    if (!p || !inBbox(p)) continue;
    byStreet.set(street, [...(byStreet.get(street) ?? []), uid]);
  }
  for (const [street, uids] of byStreet) {
    const chain = chains.find((c) => uids.every((u) => c.stops.some((s) => s.uid === u))) ?? chains.find((c) => c.stops.some((s) => s.uid === uids[0]));
    const ordered = chain ? [...uids].sort((a, b) => chain.stops.findIndex((s) => s.uid === a) - chain.stops.findIndex((s) => s.uid === b)) : uids;
    const anchor = ordered[Math.floor((ordered.length - 1) / 2)];
    const p = input.streets?.[street] as StreetPoint;
    coords.set(anchor, { lat: round7(p.lat), lng: round7(p.lng) });
    coordSource[anchor] = 'street';
  }
  // між відомими сусідами (за хвилинами, інакше рівномірно)
  for (const c of chains) {
    const st = c.stops;
    for (let i = 0; i < st.length; i++) {
      if (coords.has(st[i].uid)) continue;
      let a = i - 1;
      while (a >= 0 && !coords.has(st[a].uid)) a--;
      let b = i + 1;
      while (b < st.length && !coords.has(st[b].uid)) b++;
      if (a < 0 || b >= st.length) continue;
      const pa = coords.get(st[a].uid) as StreetPoint;
      const pb = coords.get(st[b].uid) as StreetPoint;
      for (let k = a + 1; k < b; k++) {
        if (coords.has(st[k].uid)) continue;
        const ma = st[a].minute;
        const mb = st[b].minute;
        const mk = st[k].minute;
        const f = ma !== null && mb !== null && mk !== null && mb > ma ? (mk - ma) / (mb - ma) : (k - a) / (b - a);
        coords.set(st[k].uid, { lat: round7(pa.lat + (pb.lat - pa.lat) * f), lng: round7(pa.lng + (pb.lng - pa.lng) * f) });
        coordSource[st[k].uid] = 'between';
      }
    }
  }
  // за кінець ланцюжка: продовжити напрям двох останніх відомих точок
  for (let pass = 0; pass < 3; pass++) {
    for (const c of chains) {
      for (const dir of [1, -1]) {
        const st = dir === 1 ? c.stops : [...c.stops].reverse();
        for (let i = 0; i < st.length; i++) {
          if (coords.has(st[i].uid)) continue;
          const known = st.slice(0, i).filter((s) => coords.has(s.uid));
          if (!known.length) continue;
          const p1 = coords.get(known[known.length - 1].uid) as StreetPoint;
          const p0 = known.length > 1 ? (coords.get(known[known.length - 2].uid) as StreetPoint) : { lat: p1.lat - 0.001, lng: p1.lng };
          const len = distanceM(p0, p1) || 1;
          const k = EXTRAPOLATE_STEP_M / len;
          coords.set(st[i].uid, { lat: round7(p1.lat + (p1.lat - p0.lat) * k), lng: round7(p1.lng + (p1.lng - p0.lng) * k) });
          coordSource[st[i].uid] = 'extrapolated';
        }
      }
    }
  }
  const missing = usedUids.filter((u) => !coords.has(u));
  if (missing.length) throw new Error(`no coordinates for ${missing.join(', ')}`);

  // ---------- маршрути, ланцюжки, сегменти ----------
  const csvByUid = new Map(routesCsv.map((r) => [r.uid.trim(), r] as const));
  const routes: KRoute[] = [];
  const routeStops: KRouteStop[] = [];
  const segments = new Map<string, KSegment>();
  const segKey = (routeId: string, a: string, b: string): string => `${routeId}|${a}|${b}`;
  const unknownHops: Array<{ chain: Chain; from: string; to: string }> = [];

  for (const r of config.routes) {
    const there = chains.find((c) => c.routeId === r.id && c.key === 'main-1') as Chain;
    const back = chains.find((c) => c.routeId === r.id && c.key === 'main-0') as Chain;
    const csv = csvByUid.get(r.csv);
    routes.push({
      id: r.id,
      fromName: stopName(there.stops[0].uid),
      toName: stopName(there.stops[there.stops.length - 1].uid),
      scheme: 'city',
      note: csv ? csv.description.replace(/\s+/g, ' ').trim() : '',
      sourceUrl: config.sourceUrl,
      schedule: null,
      unreliable: false,
      shortName: r.shortName ?? '',
      variants: config.variants
        .filter((v) => v.route === r.id)
        .map((v) => ({
          id: v.id,
          directionId: v.directionId,
          name: v.name,
          stops: (chains.find((c) => c.key === v.id) as Chain).stops.map((s) => ({ stopId: korostenStopId(s.uid) })),
        })),
    });
    const order = new Map<string, { there: number; back: number }>();
    there.stops.forEach((s, i) => order.set(s.uid, { there: i + 1, back: -1 }));
    back.stops.forEach((s, i) => {
      const o = order.get(s.uid) ?? { there: -1, back: -1 };
      o.back = i + 1;
      order.set(s.uid, o);
    });
    for (const [uid, o] of [...order.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      routeStops.push({ routeId: r.id, stopId: korostenStopId(uid), orderThere: o.there, orderBack: o.back, mapOnly: false });
    }
  }
  // сегменти з хвилин: спершу основні ланцюжки, потім варіанти (перший запис перемагає)
  for (const c of chains) {
    for (let i = 0; i + 1 < c.stops.length; i++) {
      const a = c.stops[i];
      const b = c.stops[i + 1];
      const key = segKey(c.routeId, a.uid, b.uid);
      if (segments.has(key)) continue;
      if (a.minute === null || b.minute === null) {
        unknownHops.push({ chain: c, from: a.uid, to: b.uid });
        continue;
      }
      segments.set(key, {
        routeId: c.routeId,
        fromStopId: korostenStopId(a.uid),
        toStopId: korostenStopId(b.uid),
        seconds: Math.max(MIN_SEGMENT_SEC, (b.minute - a.minute) * 60),
      });
    }
  }

  // ---------- рейси ----------
  const routeByRada = new Map(config.routes.map((r) => [r.rada, r] as const));
  type Assigned = { run: SourceRun; chain: Chain; from: string; to: string; via: string[] };
  const assigned: Assigned[] = [];
  const deferred: Array<{ route: string; run: SourceRun; reason: string }> = [];
  const serves = (c: Chain, from: string, to: string, via: string[]): boolean => {
    const idx = (u: string): number => c.stops.findIndex((s) => s.uid === u);
    const seq = [from, ...via, to].map(idx);
    return seq.every((x) => x >= 0) && seq.every((x, i) => i === 0 || x > seq[i - 1]);
  };
  for (const route of timetable.routes) {
    const cfg = routeByRada.get(route.number);
    if (!cfg) {
      for (const run of route.runs) deferred.push({ route: route.number, run, reason: 'маршруту нема в dataset-config.json' });
      continue;
    }
    const routeChains = chains.filter((c) => c.routeId === cfg.id);
    for (const run of route.runs) {
      const from = nameToUid.get(run.from);
      const to = nameToUid.get(run.to);
      const via = run.via.map((v) => nameToUid.get(v));
      if (!from || !to || via.some((v) => !v)) {
        deferred.push({ route: route.number, run, reason: 'назва зупинки без відповідника в stop-aliases.json' });
        continue;
      }
      if (run.note) {
        deferred.push({ route: route.number, run, reason: `інший шлях («${run.note}») — шляху ще нема, фаза 9` });
        continue;
      }
      const viaUids = via as string[];
      const candidates = routeChains.filter((c) => c.italic === run.italic && serves(c, from, to, viaUids));
      const main = candidates.filter((c) => !c.variantId);
      const pick = main[0] ?? candidates.find((c) => c.stops[0].uid === from || c.stops[c.stops.length - 1].uid === to) ?? candidates[0];
      if (!pick) {
        deferred.push({
          route: route.number,
          run,
          reason: run.italic ? 'курсив (інший шлях) — варіанта нема' : 'кінцеві поза ланцюжками маршруту — потрібен варіант шляху, фаза 9',
        });
        continue;
      }
      assigned.push({ run, chain: pick, from, to, via: viaUids });
    }
  }

  // «головна пара» кінцевих основного ланцюжка: рада пише кінцеві грубо (Чигирі замість Проліскової) — рейси
  // з цією парою йдуть увесь ланцюжок; інші пари всередині ланцюжка — скорочені рейси
  const mainPair = new Map<Chain, { from: string; to: string }>();
  for (const c of chains.filter((x) => !x.variantId)) {
    const counts = new Map<string, number>();
    for (const a of assigned.filter((x) => x.chain === c)) counts.set(`${a.from}>${a.to}`, (counts.get(`${a.from}>${a.to}`) ?? 0) + 1);
    let best: string | null = null;
    let bestScore = -1;
    for (const [pair, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const [f, t] = pair.split('>');
      const score = (f === c.stops[0].uid && t === c.stops[c.stops.length - 1].uid ? 1000 : 0) + n;
      if (score > bestScore) {
        best = pair;
        bestScore = score;
      }
    }
    if (best) {
      const [from, to] = best.split('>');
      mainPair.set(c, { from, to });
    }
  }

  // час невідомих перегонів варіантів — з часу в дорозі за радою
  for (const hop of unknownHops) {
    const key = segKey(hop.chain.routeId, hop.from, hop.to);
    if (segments.has(key)) continue;
    const c = hop.chain;
    const full = assigned.filter((a) => a.chain === c && a.from === c.stops[0].uid && a.to === c.stops[c.stops.length - 1].uid);
    const hopsOf = (): Array<[string, string]> => c.stops.slice(1).map((s, i) => [c.stops[i].uid, s.uid]);
    let seconds = config.defaultSec;
    if (full.length) {
      const durations = full.map((a) => minutesOf(a.run.arrival) - minutesOf(a.run.departure)).filter((m) => m > 0);
      if (durations.length) {
        const known = hopsOf().reduce((sum, [x, y]) => sum + (segments.get(segKey(c.routeId, x, y))?.seconds ?? 0), 0);
        const unknown = hopsOf().filter(([x, y]) => !segments.has(segKey(c.routeId, x, y))).length;
        seconds = Math.max(60, Math.round((median(durations) * 60 - known) / Math.max(1, unknown)));
      }
    }
    for (const [x, y] of hopsOf()) {
      const k = segKey(c.routeId, x, y);
      if (!segments.has(k)) segments.set(k, { routeId: c.routeId, fromStopId: korostenStopId(x), toStopId: korostenStopId(y), seconds });
    }
  }

  const segSeconds = (routeId: string, a: string, b: string): number => segments.get(segKey(routeId, a, b))?.seconds ?? config.defaultSec;
  const tripsByRoute = new Map<string, Array<Omit<KTrip, 'id'>>>();
  const arrivalFixed: Array<{ routeId: string; departure: string; rada: number; ours: number }> = [];
  for (const a of assigned) {
    const c = a.chain;
    const uids = c.stops.map((s) => s.uid);
    const pair = mainPair.get(c);
    const startUid = (pair && a.from === pair.from) || a.from === uids[0] ? uids[0] : a.from;
    const endUid = (pair && a.to === pair.to) || a.to === uids[uids.length - 1] ? uids[uids.length - 1] : a.to;
    const i0 = uids.indexOf(startUid);
    const i1 = uids.indexOf(endUid);
    let ourMinutes = 0;
    for (let i = i0; i < i1; i++) ourMinutes += segSeconds(c.routeId, uids[i], uids[i + 1]) / 60;
    const radaMinutes = minutesOf(a.run.arrival) - minutesOf(a.run.departure);
    let arrivalTime: string | null = null;
    if (radaMinutes > 0 && Math.abs(radaMinutes - ourMinutes) > ARRIVAL_TOLERANCE_MIN) {
      arrivalTime = hhmmss(minutesOf(a.run.arrival));
      arrivalFixed.push({ routeId: c.routeId, departure: a.run.departure, rada: radaMinutes, ours: Math.round(ourMinutes) });
    }
    const list = tripsByRoute.get(c.routeId) ?? [];
    list.push({
      routeId: c.routeId,
      serviceId: a.run.days,
      headsign: stopName(endUid),
      directionId: c.directionId,
      departureTime: hhmmss(minutesOf(a.run.departure)),
      blockId: `${c.routeId}-g${a.run.block}`,
      wheelchairAccessible: '',
      bikesAllowed: '',
      startStopId: i0 > 0 ? korostenStopId(startUid) : null,
      endStopId: i1 < uids.length - 1 ? korostenStopId(endUid) : null,
      arrivalTime,
      variantId: c.variantId,
      timepoints: null,
    });
    tripsByRoute.set(c.routeId, list);
  }
  const trips: KTrip[] = [];
  for (const r of config.routes) {
    const list = (tripsByRoute.get(r.id) ?? []).sort(
      (x, y) => y.directionId.localeCompare(x.directionId) || x.departureTime.localeCompare(y.departureTime) || (x.blockId ?? '').localeCompare(y.blockId ?? ''),
    );
    const counter = { '1': 0, '0': 0 };
    for (const t of list) {
      counter[t.directionId] += 1;
      trips.push({ id: `${r.id}-${t.directionId === '1' ? 1 : 2}${String(counter[t.directionId]).padStart(2, '0')}`, ...t });
    }
  }

  const stops: KStop[] = usedUids
    .map((uid) => ({ id: korostenStopId(uid), name: stopName(uid), ...(coords.get(uid) as StreetPoint) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const dataset: KorostenDataset = {
    stops,
    routes,
    routeStops: routeStops.sort((a, b) => a.routeId.localeCompare(b.routeId) || a.stopId.localeCompare(b.stopId)),
    trips,
    segments: [...segments.values()].sort(
      (a, b) => a.routeId.localeCompare(b.routeId) || a.fromStopId.localeCompare(b.fromStopId) || a.toStopId.localeCompare(b.toStopId),
    ),
    meta: {
      defaultSec: config.defaultSec,
      routeColors: Object.fromEntries(Object.entries(config.colors).sort((a, b) => a[0].localeCompare(b[0]))),
      source: 'Чернетка: розклад Коростенської міської ради, проєкт 2025 року, схема 2019 року, OpenStreetMap (ODbL)',
    },
  };

  const coordFor = (uid: string): StreetPoint => coords.get(uid) as StreetPoint;
  const report = buildReport({
    input,
    usedUids,
    stopName,
    coordSource,
    coordFor,
    osmAmbiguous: osm?.ambiguous ?? [],
    googleRejected,
    osmOutliers: [...(osm?.matches.entries() ?? [])].filter(([, m]) => m.outliers.length).map(([uid, m]) => ({ uid, outliers: m.outliers })),
    chains,
    deferred,
    arrivalFixed,
    dataset,
    nameToUid,
  });
  return { dataset, report, coordSource };
}

// ---------- звіт ----------

interface ReportInput {
  input: KorostenDatasetInput;
  usedUids: string[];
  stopName: (uid: string) => string;
  coordSource: Record<string, CoordSource>;
  coordFor: (uid: string) => StreetPoint;
  osmAmbiguous: Array<{ osmId: string; name: string; uids: string[] }>;
  googleRejected: Array<{ uid: string; meters: number | null }>;
  osmOutliers: Array<{ uid: string; outliers: string[] }>;
  chains: Chain[];
  deferred: Array<{ route: string; run: SourceRun; reason: string }>;
  arrivalFixed: Array<{ routeId: string; departure: string; rada: number; ours: number }>;
  dataset: KorostenDataset;
  nameToUid: Map<string, string>;
}

const SOURCE_LABEL: Record<CoordSource, string> = {
  osm: 'OSM',
  google: 'Google (тимчасово)',
  street: 'середина вулиці',
  between: 'між сусідами',
  extrapolated: 'продовження лінії',
};

/** Рядок таблиці Markdown без зламу від «|» у даних */
const cell = (s: string): string => s.replace(/\|/g, '\\|');

function buildReport(r: ReportInput): string {
  const { input, dataset } = r;
  const lines: string[] = [];
  const bySource = (s: CoordSource): string[] => r.usedUids.filter((u) => r.coordSource[u] === s);
  lines.push('# Чернетка датасету Коростеня — звіт');
  lines.push('');
  lines.push('Згенеровано `npm run korosten:dataset` (backend) з джерел у `data/korosten-transport/`. Руками не редагувати:');
  lines.push('тест `korosten-dataset.test.ts` перевіряє, що файл відповідає джерелам. Правила — `Docs/korosten-transport-data-2026-11.md`.');
  lines.push('');
  lines.push('## Зведення');
  lines.push('');
  lines.push(`- Зупинок: ${dataset.stops.length}; маршрутів: ${dataset.routes.length}; варіантів шляху: ${dataset.routes.reduce((n, x) => n + x.variants.length, 0)}.`);
  lines.push(`- Рейсів: ${dataset.trips.length} (будні: ${dataset.trips.filter((t) => t.serviceId === 'weekdays').length}); відкладено: ${r.deferred.length}.`);
  lines.push(`- Сегментів: ${dataset.segments.length}.`);
  lines.push(
    `- Координати: OSM — ${bySource('osm').length}${input.googleCoords ? `, Google (тимчасово, до перевірки на місці) — ${bySource('google').length}` : ''}, середина вулиці — ${bySource('street').length}, між сусідами — ${bySource('between').length}, ` +
      `продовження лінії — ${bySource('extrapolated').length}.`,
  );
  lines.push(`- Знімок OSM: ${input.osm ? input.osm.fetchedAt : 'нема (`--fetch-osm`)'}; перевірка Google: ${input.google ? input.google.checkedAt : 'не запускалась (`--fetch-google`)'}.`);
  lines.push('');

  lines.push('## Маршрути');
  lines.push('');
  lines.push('| Маршрут | Напрямок | Зупинок | Хв за проєктом | Рейсів | Кінцеві |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of r.chains) {
    const label = c.variantId ? `варіант ${c.variantId}` : c.directionId === '1' ? 'туди' : 'назад';
    const last = c.stops[c.stops.length - 1];
    const minutes = last.minute === null ? '—' : String(last.minute);
    const n = dataset.trips.filter((t) => t.routeId === c.routeId && t.directionId === c.directionId && t.variantId === c.variantId).length;
    lines.push(`| ${routeLabel(dataset, c.routeId)} | ${label} | ${c.stops.length} | ${minutes} | ${n} | ${cell(r.stopName(c.stops[0].uid))} → ${cell(r.stopName(last.uid))} |`);
  }
  lines.push('');
  const checkRoutes = input.config.routes.filter((x) => x.check);
  if (checkRoutes.length || input.config.variants.length) {
    lines.push('Перевірити руками (складені з кількох джерел): ' + [...checkRoutes.map((x) => `№${x.shortName || x.id}`), ...input.config.variants.map((v) => `варіант ${v.id}`)].join(', ') + '.');
    lines.push('');
  }

  lines.push('## Координати, які треба поставити руками');
  lines.push('');
  lines.push('Усі точки не з OSM — приблизні. Поправити в «Редакторі карти» (місто Коростень), фаза 9.');
  lines.push('');
  if (input.googleCoords) {
    lines.push(`Локальна версія з точками Google (${input.googleCoords.fetchedAt}): у git не йде, відкритими даними не публікується; після перевірки на місці точки Google замінюються власними.`);
    lines.push('');
  }
  lines.push('| Зупинка | Назва | Звідки точка | Вулиця (рада) |');
  lines.push('|---|---|---|---|');
  const officialByUid = new Map(input.official.map((s) => [s.uid, s] as const));
  for (const uid of r.usedUids.filter((u) => r.coordSource[u] !== 'osm')) {
    lines.push(`| ${korostenStopId(uid)} (${uid}) | ${cell(r.stopName(uid))} | ${SOURCE_LABEL[r.coordSource[uid]]} | ${cell(officialByUid.get(uid)?.street ?? '—')} |`);
  }
  lines.push('');
  const fast = suspiciousHops(dataset);
  if (fast.length) {
    lines.push(`### Підозрілі перегони (швидше ${SUSPICIOUS_KMH} км/год за точками й хвилинами)`);
    lines.push('');
    lines.push('Здебільшого — одна з двох точок поставлена наугад (середина вулиці, продовження лінії).');
    lines.push('');
    for (const h of fast) lines.push(`- ${routeLabel(dataset, h.routeId)}: ${h.from} → ${h.to} — ${h.meters} м за ${h.seconds} с (${h.kmh} км/год)`);
    lines.push('');
  }
  if (r.googleRejected.length) {
    lines.push('### Google: точки, яких не взяли');
    lines.push('');
    lines.push(`Далі max(${GOOGLE_NEAR_MIN_M} м, ${GOOGLE_NEAR_MPS} м/с × хвилини між зупинками) від сусіда з відомою точкою або без жодного такого сусіда — Google, найпевніше, знайшов однойменну зупинку деінде.`);
    lines.push('');
    for (const g of r.googleRejected) lines.push(`- ${korostenStopId(g.uid)} ${r.stopName(g.uid)}: ${g.meters === null ? 'сусідів з відомою точкою нема' : `до найдальшого відомого сусіда ${g.meters} м`}`);
    lines.push('');
  }
  if (r.osmOutliers.length || r.osmAmbiguous.length) {
    lines.push('### OSM: що не взяли');
    lines.push('');
    for (const o of r.osmOutliers) lines.push(`- ${korostenStopId(o.uid)} ${r.stopName(o.uid)}: точки ${o.outliers.join(', ')} далі ніж 200 м від решти — інша зупинка з такою ж назвою?`);
    for (const a of r.osmAmbiguous) lines.push(`- ${a.osmId} «${a.name}» підходить до кількох зупинок (${a.uids.join(', ')}) — підказка в \`osmHints\`.`);
    lines.push('');
  }

  if (input.google) {
    lines.push('## Перевірка Google Places');
    lines.push('');
    lines.push('Лише відстань і `place_id` (координати Google не зберігаємо). «Застаріло» — нашу точку змінено після перевірки.');
    lines.push('');
    lines.push('| Зупинка | Назва | Відстань до Google, м | Примітка |');
    lines.push('|---|---|---|---|');
    for (const s of dataset.stops) {
      const g = input.google.stops[s.id];
      if (!g) continue;
      const stale = distanceM({ lat: g.ours[0], lng: g.ours[1] }, s) > 10;
      if (g.distanceM !== null && g.distanceM <= 150 && !stale) continue;
      const note = g.placeId ? (stale ? 'застаріло — перезапустити' : 'далеко') : 'Google не знайшов';
      lines.push(`| ${s.id} | ${cell(s.name)} | ${g.distanceM ?? '—'} | ${note} |`);
    }
    if (input.google.transit?.length) {
      const name = new Map(dataset.stops.map((x) => [x.id, x.name] as const));
      lines.push('', '### Routes API (громадський транспорт) між кінцевими', '');
      lines.push('Буднього ранку, з альтернативами. Номер лінії Google — як у Google Maps, не обов\'язково наш маршрут.', '');
      lines.push('| Маршрут | Від → до | Лінії Google |');
      lines.push('|---|---|---|');
      for (const t of input.google.transit) {
        lines.push(`| ${routeLabel(dataset, t.routeId)} | ${cell(`${name.get(t.from) ?? t.from} → ${name.get(t.to) ?? t.to}`)} | ${t.lines.join(', ') || '—'} |`);
      }
    }
    lines.push('');
  }

  lines.push('## Рейси, яких у чернетці нема');
  lines.push('');
  if (!r.deferred.length) lines.push('Нема.');
  else {
    lines.push('| Маршрут | Графік | Відправлення | Рядок розкладу | Чому |');
    lines.push('|---|---|---|---|---|');
    for (const d of r.deferred) {
      const via = d.run.via.length ? ` – ${d.run.via.join(' – ')}` : '';
      lines.push(`| №${d.route} | ${d.run.block} | ${d.run.departure} | ${cell(`${d.run.from}${via} – ${d.run.to}`)} | ${cell(d.reason)} |`);
    }
  }
  lines.push('');

  lines.push('## Рейси з фіксованим часом прибуття');
  lines.push('');
  lines.push(`Час у дорозі за радою відрізняється від суми хвилин проєкту більш ніж на ${ARRIVAL_TOLERANCE_MIN} хв — рейс отримав \`arrivalTime\`.`);
  lines.push('');
  if (!r.arrivalFixed.length) lines.push('Нема.');
  else {
    const grouped = new Map<string, string[]>();
    for (const a of r.arrivalFixed) {
      const k = `${routeLabel(dataset, a.routeId)}: рада ${a.rada} хв, сегменти ${a.ours} хв`;
      grouped.set(k, [...(grouped.get(k) ?? []), a.departure]);
    }
    for (const [k, deps] of grouped) lines.push(`- ${k} — ${deps.join(', ')}`);
  }
  lines.push('');

  lines.push('## Вихідні (фаза 7)');
  lines.push('');
  lines.push('Календар `weekends` ще не існує: рейси ради без зірочки йдуть щодня, із зірочкою — у будні. Рейси проєкту 2025, що є');
  lines.push('лише у вихідні:');
  lines.push('');
  let anyWeekend = false;
  for (const d of input.directions) {
    const weekdays = new Set(d.departures.weekdays.map((x) => x.time));
    const only = d.departures.weekends.filter((x) => !weekdays.has(x.time)).map((x) => x.time);
    if (only.length) {
      anyWeekend = true;
      lines.push(`- ${d.code} (№${d.route}): ${only.join(', ')}`);
    }
  }
  if (!anyWeekend) lines.push('- нема');
  lines.push('');

  if (input.osm?.routes.length) {
    lines.push('## Порядок зупинок проти маршрутів OSM');
    lines.push('');
    const osmToUid = new Map<string, string>();
    const names = new Map<string, string[]>();
    for (const uid of r.usedUids) names.set(uid, [input.official.find((s) => s.uid === uid)?.label ?? r.stopName(uid)]);
    for (const [name, uid] of r.nameToUid) names.get(uid)?.push(name);
    const all = input.osm.routes.flatMap((x) => x.platforms);
    for (const [uid, m] of matchOsmStops(all, names, input.config.osmHints).matches) for (const id of [...m.osmIds, ...m.outliers]) osmToUid.set(id, uid);
    for (const route of input.osm.routes) {
      const seq = route.platforms.map((p) => osmToUid.get(p.id) ?? null);
      const known = seq.filter((x): x is string => !!x);
      const routeId = input.config.routes.find((x) => x.id === route.ref)?.id;
      // основний напрямок, у якому найбільше спільних із маршрутом OSM зупинок ідуть у тому ж порядку
      const score = (c: Chain): number => {
        const idx = known.map((u) => c.stops.findIndex((s) => s.uid === u)).filter((i) => i >= 0);
        return idx.filter((i, k) => k > 0 && i > idx[k - 1]).length;
      };
      const chain = r.chains
        .filter((c) => c.routeId === routeId && !c.variantId)
        .sort((a, b) => score(b) - score(a))
        .find((c) => score(c) > 0);
      const ours = chain ? chain.stops.map((s) => s.uid) : [];
      const notOurs = known.filter((u) => !ours.includes(u));
      const notOsm = ours.filter((u) => !known.includes(u));
      const order = known.filter((u) => ours.includes(u));
      const ordered = order.every((u, i) => i === 0 || ours.indexOf(u) > ours.indexOf(order[i - 1]));
      const unnamed = seq.filter((x) => !x).length;
      lines.push(
        `- ${route.id} №${route.ref} ${route.from} → ${route.to}: ${chain ? `ланцюжок ${chain.key}` : 'ланцюжка не знайдено'}; ` +
          `у OSM, але не в нас: ${notOurs.map((u) => r.stopName(u)).join(', ') || '—'}; у нас, але не в OSM: ${notOsm.map((u) => r.stopName(u)).join(', ') || '—'}; ` +
          `порядок ${ordered ? 'збігається' : 'різниться'}${unnamed ? `; платформ без зупинки ради: ${unnamed}` : ''}.`,
      );
    }
    lines.push('');
  }

  lines.push('## Зупинки ради поза чернеткою');
  lines.push('');
  lines.push('Є в переліку ради, але в жодному ланцюжку: ' + (input.aliases.unusedOfficial.filter((u) => !r.usedUids.includes(u)).map((u) => `${u} ${cleanStopName(input.official.find((s) => s.uid === u)?.label ?? u)}`).join('; ') || 'нема') + '.');
  lines.push('');
  return `${lines.join('\n')}`;
}

const SUSPICIOUS_KMH = 45;

/** Перегони основних ланцюжків, де автобус мав би їхати швидше SUSPICIOUS_KMH */
export function suspiciousHops(dataset: KorostenDataset): Array<{ routeId: string; from: string; to: string; meters: number; seconds: number; kmh: number }> {
  const stops = new Map(dataset.stops.map((s) => [s.id, s] as const));
  const seg = new Map(dataset.segments.map((s) => [`${s.routeId}|${s.fromStopId}|${s.toStopId}`, s.seconds] as const));
  const out: Array<{ routeId: string; from: string; to: string; meters: number; seconds: number; kmh: number }> = [];
  for (const r of dataset.routes) {
    for (const key of ['orderThere', 'orderBack'] as const) {
      const chain = dataset.routeStops.filter((x) => x.routeId === r.id && x[key] > 0).sort((a, b) => a[key] - b[key]).map((x) => x.stopId);
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = stops.get(chain[i]) as KStop;
        const b = stops.get(chain[i + 1]) as KStop;
        const seconds = seg.get(`${r.id}|${a.id}|${b.id}`) ?? dataset.meta.defaultSec;
        const meters = Math.round(distanceM(a, b));
        const kmh = Math.round((meters / seconds) * 3.6);
        if (kmh > SUSPICIOUS_KMH) out.push({ routeId: r.id, from: `${a.id} ${a.name}`, to: `${b.id} ${b.name}`, meters, seconds, kmh });
      }
    }
  }
  return out;
}

function routeLabel(dataset: KorostenDataset, routeId: string): string {
  const r = dataset.routes.find((x) => x.id === routeId);
  return `№${r?.shortName || routeId}`;
}
