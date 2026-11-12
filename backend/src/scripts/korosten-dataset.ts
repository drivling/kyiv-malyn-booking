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
import type { GoogleCheck, KorostenDataset, StreetPoint } from '../korosten-dataset';
import {
  DATASET_FILE,
  GOOGLE_CHECK_FILE,
  OSM_SNAPSHOT_FILE,
  OSM_STREETS_FILE,
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

async function fetchGoogle(dataset: KorostenDataset): Promise<void> {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const b = KOROSTEN_BBOX;
  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key };
  const check: GoogleCheck = { checkedAt: new Date().toISOString(), stops: {} };
  for (const s of dataset.stops) {
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
    // координати Google лише для відстані — у файл не пишемо
    check.stops[s.id] = {
      ours: [s.lat, s.lng],
      placeId: p?.id ?? null,
      name: p?.displayName?.text ?? null,
      distanceM: p?.location ? Math.round(distanceM(s, { lat: p.location.latitude, lng: p.location.longitude })) : null,
    };
    await sleep(200);
  }
  const from = dataset.stops.find((s) => s.id === 'st_1001');
  const to = dataset.stops.find((s) => s.id === 'st_1015');
  if (from && to) {
    const res = (await getJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { ...headers, 'X-Goog-FieldMask': 'routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.name' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'TRANSIT',
        languageCode: 'uk',
      }),
    })) as { routes?: Array<{ legs?: Array<{ steps?: Array<{ transitDetails?: { transitLine?: { nameShort?: string; name?: string } } }> }> }> };
    const lines = [
      ...new Set(
        (res.routes ?? []).flatMap((r) => (r.legs ?? []).flatMap((l) => (l.steps ?? []).map((st) => st.transitDetails?.transitLine?.nameShort ?? st.transitDetails?.transitLine?.name ?? '').filter(Boolean))),
      ),
    ].sort();
    check.transit = {
      from: from.id,
      to: to.id,
      lines,
      note: lines.length ? `${from.name} → ${to.name}: лінії ${lines.join(', ')}` : `${from.name} → ${to.name}: міського транспорту Google не знає`,
    };
  }
  write(GOOGLE_CHECK_FILE, `${JSON.stringify(check, null, 2)}\n`);
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
  let { files, result } = buildKorostenDatasetFiles(ROOT);
  if (has('--fetch-google')) {
    await fetchGoogle(result.dataset);
    ({ files, result } = buildKorostenDatasetFiles(ROOT));
  }
  const { errors } = validateTransportDataset(JSON.parse(JSON.stringify(result.dataset)));
  if (errors.length) throw new Error(`чернетка не проходить валідацію PUT:\n${errors.join('\n')}`);
  for (const [file, content] of Object.entries(files)) write(file, content);
  const d = result.dataset;
  console.log(`${DATASET_FILE}: зупинок ${d.stops.length}, маршрутів ${d.routes.length}, рейсів ${d.trips.length}, сегментів ${d.segments.length}`);
  if (has('--apply') || has('--dry-run')) await apply(d, !has('--apply'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
