/**
 * Чернетка датасету міського транспорту Коростеня (Docs/korosten-transport-data-2026-11.md):
 *
 * npm run korosten:dataset                  — без мережі: data/korosten-transport/** → dataset/korosten-dataset.json і
 *                                             dataset/REPORT.md (перевірка тим самим валідатором, що й PUT)
 * npm run korosten:dataset -- --fetch-osm   — знімок OSM: зупинки й маршрути (osm/snapshot.json), середини вулиць
 *                                             з переліку ради через Nominatim (osm/streets.json); далі — генерація
 * npm run korosten:dataset -- --fetch-streets — лише середини вулиць (Nominatim)
 * npm run korosten:dataset -- --fetch-google — перевірка точок через Google Places (google/check.json: place_id і
 *                                             відстань, без координат Google); ключ — GOOGLE_MAPS_API_KEY
 * npm run korosten:dataset -- --fetch-google-coords — координати Google за place_id з check.json (Place Details)
 *                                             у google/coords.local.json (поза git)
 * npm run korosten:dataset -- --google-coords — ще й dataset/korosten-dataset.local.json (поза git): приблизні точки
 *                                             замінено точками з google/coords.local.json (тимчасово, до перевірки
 *                                             на місці); з --apply / --dry-run пишеться саме вона
 * npm run korosten:dataset -- --fetch-google --only-missing — пошук Google лише для зупинок, яких нема в check.json
 * npm run korosten:dataset -- --google-hops [--google-coords] [--refresh] — перевірка кожної трійки сусідніх зупинок
 *                                             через Routes TRANSIT; продовжує з місця зупинки, --refresh — заново
 * npm run korosten:dataset -- --apply       — записати чернетку в базу: GET → бекап → PUT ?city=Korosten з
 *                                             baseRevision → GET і порівняння. Токен — ADMIN_TOKEN або VIBER_ADMIN_TOKEN.
 *                                             Без --apply показує лише, що зміниться.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTransportDataset } from '../local-transport';
import { KOROSTEN_BBOX, distanceM, osmRouteFromFull, osmStopsFromOverpass, type OsmSnapshot, type OsmStop } from '../korosten-osm';
import { parseOfficialStops } from '../korosten-stop-aliases';
import type { GoogleCheck, GoogleCoords, GoogleHops, KorostenDataset, StreetPoint } from '../korosten-dataset';
import { coordsHash } from '../korosten-dataset';
import { datasetChains, decodePolyline, hopTriples, hopVerdict, type DatasetChain, type GoogleTransitStep, type HopTriple, type HopVerdict } from '../korosten-google';
type KStopLike = { lat: number; lng: number };
import {
  DATASET_FILE,
  GOOGLE_CHECK_FILE,
  GOOGLE_COORDS_FILE,
  GOOGLE_HOPS_FILE,
  GOOGLE_HOPS_LOCAL_FILE,
  LOCAL_DATASET_FILE,
  LOCAL_REPORT_FILE,
  OSM_SNAPSHOT_FILE,
  OSM_STREETS_FILE,
  REPORT_FILE,
  buildKorostenDatasetFiles,
} from '../korosten-dataset-files';

const ROOT = path.resolve(__dirname, '../../../data/korosten-transport');
const CITY = 'Korosten';
const UA = 'transport-data-snapshot/1.0';
const OVERPASS_URLS = (process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter').split(',');
const has = (flag: string): boolean => process.argv.includes(flag);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function write(file: string, content: string): void {
  const full = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log(`${file}: ${content.length} chars`);
}

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function overpass(query: string): Promise<{ elements: Array<Record<string, unknown>> }> {
  let last: unknown = null;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return (await getJson(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })) as {
          elements: Array<Record<string, unknown>>;
        };
      } catch (e) {
        last = e;
        await sleep(15_000 * (attempt + 1));
      }
    }
  }
  throw last;
}

async function fetchOsm(): Promise<void> {
  const b = KOROSTEN_BBOX;
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const res = await overpass(
    `[out:json][timeout:90];(node["highway"="bus_stop"](${bbox});node["public_transport"="platform"](${bbox});` +
      `way["public_transport"="platform"](${bbox});rel["type"="route"]["route"="bus"](${bbox}););out center tags;`,
  );
  type El = Parameters<typeof osmStopsFromOverpass>[0][number];
  const elements = res.elements as El[];
  const stops = new Map<string, OsmStop>(osmStopsFromOverpass(elements).map((s) => [s.id, s]));
  const relationIds = elements.filter((e) => e.type === 'relation').map((e) => e.id).sort((a, b) => a - b);
  const routes = [];
  for (const id of relationIds) {
    // повний маршрут (з платформами поза межами міста) — з основного API OSM
    const full = (await getJson(`https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`)) as { elements: El[] };
    const route = osmRouteFromFull(full.elements, id);
    routes.push(route);
    for (const p of route.platforms) if (p.name && !stops.has(p.id)) stops.set(p.id, p);
    await sleep(1_000);
  }
  const snapshot: OsmSnapshot = {
    fetchedAt: new Date().toISOString(),
    stops: [...stops.values()].sort((a, b) => a.id.localeCompare(b.id)),
    routes,
  };
  write(OSM_SNAPSHOT_FILE, `${JSON.stringify({ _license: '© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright', ...snapshot }, null, 2)}\n`);
}

async function fetchStreets(): Promise<void> {
  // середини вулиць із переліку ради (Nominatim: не частіше запиту на секунду)
  const official = parseOfficialStops(fs.readFileSync(path.join(ROOT, 'source', 'stops.csv'), 'utf8'));
  const streets: Record<string, StreetPoint | null> = {};
  for (const street of [...new Set(official.map((s) => s.street.trim()).filter((s) => s && s !== 'NA'))].sort()) {
    // «вул. І. Котляревського (Г. Сковороди)» → «вулиця Котляревського», «Котляревського», «Білокоровицьке шосе»…
    const bare = street.replace(/\([^)]*\)/g, ' ').replace(/^(вул|пров)\.\s*/i, '').replace(/^ім\.\s*/i, '').replace(/\s+/g, ' ').trim();
    const noInitials = bare.replace(/^(\p{Lu}\.\s*)+/u, '').trim();
    const kind = /^пров\./i.test(street) ? 'провулок' : 'вулиця';
    const queries = [...new Set([`${kind} ${noInitials}`, noInitials, bare])];
    let hit: StreetPoint | null = null;
    for (const q of queries) {
      const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ street: q, city: 'Коростень', country: 'Україна', format: 'jsonv2', limit: '3' })}`;
      const found = (await getJson(url)) as Array<{ lat: string; lon: string; category?: string }>;
      await sleep(1_100);
      const f = found.find((x) => x.category === 'highway');
      if (f) {
        hit = { lat: Math.round(Number(f.lat) * 1e7) / 1e7, lng: Math.round(Number(f.lon) * 1e7) / 1e7 };
        break;
      }
    }
    streets[street] = hit;
  }
  write(OSM_STREETS_FILE, `${JSON.stringify({ _license: '© OpenStreetMap contributors, ODbL 1.0 (Nominatim)', fetchedAt: new Date().toISOString(), streets }, null, 2)}\n`);
}

function readLocalJson<T>(file: string): T | null {
  const full = path.join(ROOT, file);
  return fs.existsSync(full) ? (JSON.parse(fs.readFileSync(full, 'utf8')) as T) : null;
}

/** Ключ Google: справжній — з оточення; у хмарній сесії — будь-який, проксі підставить свій (NODE_USE_ENV_PROXY=1) */
function googleKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  return key;
}

type RoutesStep = {
  travelMode?: string;
  polyline?: { encodedPolyline?: string };
  transitDetails?: {
    transitLine?: { nameShort?: string; name?: string };
    stopCount?: number;
    stopDetails?: { departureStop?: { location?: { latLng?: { latitude: number; longitude: number } } }; arrivalStop?: { location?: { latLng?: { latitude: number; longitude: number } } } };
  };
};
type RoutesResponse = { routes?: Array<{ legs?: Array<{ steps?: RoutesStep[] }> }> };

async function computeTransit(key: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }, when: Date, fieldMask: string): Promise<RoutesResponse> {
  return (await getJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'TRANSIT',
      computeAlternativeRoutes: true,
      departureTime: when.toISOString(),
      languageCode: 'uk',
    }),
  })) as RoutesResponse;
}

/** Найближчий будній день (від завтра), hh:mm за Києвом → момент UTC */
function nextWeekdayKyiv(minutes: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const ymd = d.toISOString().slice(0, 10);
  const probe = new Date(`${ymd}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value.match(/GMT([+-]\d+)/)?.[1];
  const hours = Number(offset ?? '2');
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)), 0, minutes - hours * 60));
}

async function fetchGoogle(dataset: KorostenDataset, onlyMissing: boolean): Promise<void> {
  const key = googleKey();
  const b = KOROSTEN_BBOX;
  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key };
  const prevCheck = onlyMissing ? readLocalJson<GoogleCheck>(GOOGLE_CHECK_FILE) : null;
  const prevCoords = onlyMissing ? readLocalJson<GoogleCoords>(GOOGLE_COORDS_FILE) : null;
  const check: GoogleCheck = { checkedAt: prevCheck?.checkedAt ?? new Date().toISOString(), stops: { ...(prevCheck?.stops ?? {}) }, transit: prevCheck?.transit };
  // Координати Google — лише в локальний файл поза git (репозиторій публічний, умови Google забороняють їх
  // публікувати); власник бере їх тимчасово, до перевірки зупинок на місці
  const coords: GoogleCoords = { fetchedAt: prevCoords?.fetchedAt ?? check.checkedAt, stops: { ...(prevCoords?.stops ?? {}) } };
  let asked = 0;
  for (const s of dataset.stops) {
    if (onlyMissing && check.stops[s.id]) continue;
    asked++;
    const body = {
      textQuery: `${s.name.replace(/\s*\(на вимогу\)$/, '')}, зупинка, Коростень`,
      languageCode: 'uk',
      pageSize: 1,
      includedType: 'bus_stop',
      locationRestriction: { rectangle: { low: { latitude: b.south, longitude: b.west }, high: { latitude: b.north, longitude: b.east } } },
    };
    const res = (await getJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { ...headers, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location' },
    })) as { places?: Array<{ id: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number } }> };
    const p = res.places?.[0];
    if (p?.location) coords.stops[s.id] = { lat: p.location.latitude, lng: p.location.longitude, placeId: p.id, name: p.displayName?.text ?? null };
    // у check.json — лише відстань і place_id
    check.stops[s.id] = {
      ours: [s.lat, s.lng],
      placeId: p?.id ?? null,
      name: p?.displayName?.text ?? null,
      distanceM: p?.location ? Math.round(distanceM(s, { lat: p.location.latitude, lng: p.location.longitude })) : null,
    };
    await sleep(200);
  }
  console.log(`Places: ${asked} запитів`);
  if (!onlyMissing || !check.transit) {
    // Routes API TRANSIT між кінцевими кожного маршруту: які лінії Google пропонує (лише номери, без геометрії)
    const stopById = new Map(dataset.stops.map((s) => [s.id, s] as const));
    check.transit = [];
    for (const r of dataset.routes) {
      const chain = dataset.routeStops.filter((x) => x.routeId === r.id && x.orderThere > 0).sort((a, b) => a.orderThere - b.orderThere);
      const from = stopById.get(chain[0]?.stopId ?? '');
      const to = stopById.get(chain[chain.length - 1]?.stopId ?? '');
      if (!from || !to) continue;
      const res = await computeTransit(key, from, to, nextWeekdayKyiv(9 * 60), 'routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.name');
      const lines = [
        ...new Set(
          (res.routes ?? []).flatMap((x) => (x.legs ?? []).flatMap((l) => (l.steps ?? []).map((st) => st.transitDetails?.transitLine?.nameShort ?? st.transitDetails?.transitLine?.name ?? '').filter(Boolean))),
        ),
      ].sort((a, b) => a.localeCompare(b, 'uk', { numeric: true }));
      check.transit.push({ routeId: r.id, from: from.id, to: to.id, lines });
      await sleep(200);
    }
  }
  write(GOOGLE_CHECK_FILE, `${JSON.stringify(check, null, 2)}\n`);
  write(GOOGLE_COORDS_FILE, `${JSON.stringify(coords, null, 2)}\n`);
}

/**
 * Перевірка кожного прогону через Google (--google-hops): трійки сусідніх зупинок A → B → C усіх ланцюжків, Routes
 * TRANSIT від A до C у будній день о часі, коли наш маршрут там їде. Повна відповідь (з координатами Google) — у
 * google/hops.local.json (поза git, з продовженням з місця, де зупинились); висновки без координат Google —
 * google/hops.json (у git, для звіту).
 */
async function googleHops(dataset: KorostenDataset, refresh: boolean): Promise<void> {
  const key = googleKey();
  type Raw = { fetchedAt: string; departure: string; steps: GoogleTransitStep[][] };
  const raw: Record<string, Raw> = refresh ? {} : readLocalJson<Record<string, Raw>>(GOOGLE_HOPS_LOCAL_FILE) ?? {};
  const stopById = new Map(dataset.stops.map((s) => [s.id, s] as const));
  const chains = datasetChains(dataset);
  const triples = hopTriples(chains);
  const seg = new Map(dataset.segments.map((x) => [`${x.routeId}|${x.fromStopId}|${x.toStopId}`, x.seconds] as const));
  /** Коли наш маршрут проходить зупинку A: перший рейс ланцюжка від 07:00 (інакше перший) + сегменти до A */
  const minutesAt = (t: HopTriple): number => {
    const r = t.routes[0];
    const ch = chains.find((c) => c.routeId === r.routeId && c.variantId === r.variantId && c.stopIds.join('>').includes(t.b ? `${t.a}>${t.b}>${t.c}` : `${t.a}>${t.c}`)) as DatasetChain;
    const deps = dataset.trips
      .filter((x) => x.routeId === ch.routeId && x.directionId === ch.directionId && (x.variantId ?? null) === ch.variantId)
      .map((x) => Number(x.departureTime.slice(0, 2)) * 60 + Number(x.departureTime.slice(3, 5)))
      .sort((a, b) => a - b);
    const dep = deps.find((m) => m >= 7 * 60) ?? deps[0] ?? 9 * 60;
    let sec = 0;
    for (let i = 0; i + 1 < ch.stopIds.length && ch.stopIds[i] !== t.a; i++) {
      sec += seg.get(`${ch.routeId}|${ch.stopIds[i]}|${ch.stopIds[i + 1]}`) ?? dataset.meta.defaultSec;
    }
    return dep + Math.floor(sec / 60) - 5;
  };
  let asked = 0;
  for (const t of triples) {
    if (raw[t.key]) continue;
    const a = stopById.get(t.a) as KorostenDataset['stops'][number];
    const c = stopById.get(t.c) as KorostenDataset['stops'][number];
    const when = nextWeekdayKyiv(minutesAt(t));
    let res: RoutesResponse;
    try {
      res = await computeTransit(key, a, c, when, 'routes.legs.steps.travelMode,routes.legs.steps.polyline,routes.legs.steps.transitDetails');
    } catch (e) {
      console.error(`зупинились на ${t.key}: ${e instanceof Error ? e.message : e} — повторний запуск продовжить`);
      break;
    }
    const toLatLng = (p?: { location?: { latLng?: { latitude: number; longitude: number } } }) =>
      p?.location?.latLng ? { lat: p.location.latLng.latitude, lng: p.location.latLng.longitude } : null;
    raw[t.key] = {
      fetchedAt: new Date().toISOString(),
      departure: when.toISOString(),
      steps: (res.routes ?? []).map((r) =>
        (r.legs ?? []).flatMap((l) => l.steps ?? []).filter((st) => st.travelMode === 'TRANSIT' && st.transitDetails).map((st) => ({
          line: st.transitDetails?.transitLine?.nameShort ?? st.transitDetails?.transitLine?.name ?? '',
          stopCount: st.transitDetails?.stopCount ?? null,
          departure: toLatLng(st.transitDetails?.stopDetails?.departureStop),
          arrival: toLatLng(st.transitDetails?.stopDetails?.arrivalStop),
          polyline: st.polyline?.encodedPolyline ? decodePolyline(st.polyline.encodedPolyline) : [],
        })),
      ),
    };
    asked++;
    if (asked % 20 === 0) {
      write(GOOGLE_HOPS_LOCAL_FILE, `${JSON.stringify(raw)}\n`);
      console.log(`… ${asked} запитів`);
    }
    await sleep(150);
  }
  write(GOOGLE_HOPS_LOCAL_FILE, `${JSON.stringify(raw)}\n`);
  console.log(`Routes: ${asked} нових запитів, трійок ${triples.length}, перевірено ${triples.filter((t) => raw[t.key]).length}`);
  const verdicts: HopVerdict[] = [];
  for (const t of triples) {
    const r = raw[t.key];
    if (!r) continue;
    const at = (id: string | null) => (id ? { lat: (stopById.get(id) as KStopLike).lat, lng: (stopById.get(id) as KStopLike).lng } : null);
    verdicts.push(hopVerdict(t, { a: at(t.a) as { lat: number; lng: number }, b: at(t.b), c: at(t.c) as { lat: number; lng: number } }, r.steps));
  }
  const file: GoogleHops = { checkedAt: new Date().toISOString(), verdicts: verdicts.map(({ ours, ...rest }) => ({ ...rest, oursHash: coordsHash(ours) })) };
  write(GOOGLE_HOPS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Координати Google за place_id з google/check.json (Place Details — окрема від пошуку квота): коли пошук уже
 * зроблено, а координат у локальному файлі нема. Пишеться лише google/coords.local.json (поза git).
 */
async function fetchGoogleCoords(): Promise<void> {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const check = JSON.parse(fs.readFileSync(path.join(ROOT, GOOGLE_CHECK_FILE), 'utf8')) as GoogleCheck;
  const coords: GoogleCoords = { fetchedAt: new Date().toISOString(), stops: {} };
  for (const [stopId, c] of Object.entries(check.stops).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!c.placeId) continue;
    const p = (await getJson(`https://places.googleapis.com/v1/places/${encodeURIComponent(c.placeId)}?languageCode=uk`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName,location' },
    })) as { id: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number } };
    if (p.location) coords.stops[stopId] = { lat: p.location.latitude, lng: p.location.longitude, placeId: p.id, name: p.displayName?.text ?? null };
    await sleep(150);
  }
  write(GOOGLE_COORDS_FILE, `${JSON.stringify(coords, null, 2)}\n`);
}

function apiBase(): string {
  if (process.env.API_BASE) return process.env.API_BASE.replace(/\/$/, '');
  const src = fs.readFileSync(path.resolve(__dirname, '../../../frontend/scripts/api-base.mjs'), 'utf8');
  const m = /'(https:\/\/[^']+)'/.exec(src);
  if (!m) throw new Error('API base not found in frontend/scripts/api-base.mjs');
  return m[1];
}

/** JSON із ключами за абеткою: база (jsonb) повертає ключі варіантів не в тому порядку, у якому їх записали */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Порядок і поля, які повертає GET, — для порівняння «після PUT = кандидат» */
function canon(d: KorostenDataset | Record<string, unknown>): string {
  const x = d as unknown as KorostenDataset;
  const sort = <T>(xs: T[], key: (t: T) => string): T[] => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
  return JSON.stringify({
    stops: sort(x.stops, (s) => s.id).map((s) => [s.id, s.name, s.lat, s.lng]),
    routes: sort(x.routes, (r) => r.id).map((r) => [r.id, r.fromName, r.toName, r.shortName ?? '', stable(r.variants ?? [])]),
    routeStops: sort(x.routeStops, (r) => `${r.routeId}|${r.stopId}`).map((r) => [r.routeId, r.stopId, r.orderThere, r.orderBack]),
    trips: sort(x.trips, (t) => t.id).map((t) => [t.id, t.routeId, t.serviceId, t.directionId, t.departureTime, t.blockId, t.startStopId ?? null, t.endStopId ?? null, t.arrivalTime ?? null, t.variantId ?? null]),
    segments: sort(x.segments, (s) => `${s.routeId}|${s.fromStopId}|${s.toStopId}`).map((s) => [s.routeId, s.fromStopId, s.toStopId, s.seconds]),
    routeColors: stable((x.meta as { routeColors?: unknown })?.routeColors ?? null),
  });
}

async function apply(candidate: KorostenDataset, dry: boolean): Promise<void> {
  const base = apiBase();
  const token = process.env.ADMIN_TOKEN || process.env.VIBER_ADMIN_TOKEN || '';
  if (!token) throw new Error('ADMIN_TOKEN (або VIBER_ADMIN_TOKEN) не задано');
  const auth = { Authorization: token };
  const url = `${base}/transport/dataset?city=${CITY}`;
  const current = (await getJson(url, { headers: auth })) as KorostenDataset & { revision?: string | null };
  const count = (d: Partial<KorostenDataset>): string =>
    `зупинок ${d.stops?.length ?? 0}, маршрутів ${d.routes?.length ?? 0}, рейсів ${d.trips?.length ?? 0}, сегментів ${d.segments?.length ?? 0}`;
  console.log(`зараз у базі (${CITY}): ${count(current)}; ревізія ${current.revision ?? '—'}`);
  console.log(`чернетка: ${count(candidate)}`);
  if (canon(current) === canon(candidate)) {
    console.log('у базі вже ця чернетка — нічого не робимо');
    return;
  }
  if (dry) {
    console.log('без --apply нічого не записано');
    return;
  }
  const dir = path.join(os.homedir(), 'korosten-backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(current, null, 2));
  console.log(`бекап: ${backup}`);
  const meta = { ...(current.meta ?? {}), ...candidate.meta };
  const put = (await getJson(url, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...candidate, meta, baseRevision: current.revision ?? undefined }),
  })) as { revision?: string };
  console.log(`PUT ok, ревізія ${put.revision ?? '—'}`);
  const after = (await getJson(url, { headers: auth })) as KorostenDataset;
  if (canon(after) !== canon(candidate)) throw new Error('після PUT база відрізняється від чернетки — перевірте бекап і звіт');
  console.log('перевірка: база = чернетка');
}

async function main(): Promise<void> {
  if (has('--fetch-osm')) await fetchOsm();
  if (has('--fetch-osm') || has('--fetch-streets')) await fetchStreets();
  if (has('--fetch-google-coords')) await fetchGoogleCoords();
  if (has('--fetch-google')) await fetchGoogle(buildKorostenDatasetFiles(ROOT).result.dataset, has('--only-missing'));
  const withGoogle = has('--google-coords');
  // прогони перевіряємо на тій версії, що піде в базу: з точками Google, якщо її просили
  if (has('--google-hops')) await googleHops(buildKorostenDatasetFiles(ROOT, { withGoogleCoords: withGoogle }).result.dataset, has('--refresh'));
  const check = (d: KorostenDataset, label: string): void => {
    const { errors } = validateTransportDataset(JSON.parse(JSON.stringify(d)));
    if (errors.length) throw new Error(`${label} не проходить валідацію PUT:\n${errors.join('\n')}`);
  };
  const { files, result } = buildKorostenDatasetFiles(ROOT);
  check(result.dataset, 'чернетка');
  for (const [file, content] of Object.entries(files)) write(file, content);
  const d = result.dataset;
  console.log(`${DATASET_FILE}: зупинок ${d.stops.length}, маршрутів ${d.routes.length}, рейсів ${d.trips.length}, сегментів ${d.segments.length}`);
  // --google-coords: та сама чернетка, але приблизні точки замінено точками Google — лише локально, поза git
  let target = d;
  if (withGoogle) {
    const local = buildKorostenDatasetFiles(ROOT, { withGoogleCoords: true });
    check(local.result.dataset, 'чернетка з Google');
    write(LOCAL_DATASET_FILE, local.files[DATASET_FILE]);
    write(LOCAL_REPORT_FILE, local.files[REPORT_FILE]);
    target = local.result.dataset;
  }
  if (has('--apply') || has('--dry-run')) await apply(target, !has('--apply'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
