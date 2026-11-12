"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const local_transport_1 = require("../local-transport");
const korosten_osm_1 = require("../korosten-osm");
const korosten_stop_aliases_1 = require("../korosten-stop-aliases");
const korosten_dataset_files_1 = require("../korosten-dataset-files");
const ROOT = node_path_1.default.resolve(__dirname, '../../../data/korosten-transport');
const CITY = 'Korosten';
const UA = 'transport-data-snapshot/1.0';
const OVERPASS_URLS = (process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter').split(',');
const has = (flag) => process.argv.includes(flag);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function write(file, content) {
    const full = node_path_1.default.join(ROOT, file);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(full), { recursive: true });
    node_fs_1.default.writeFileSync(full, content);
    console.log(`${file}: ${content.length} chars`);
}
async function getJson(url, init = {}) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120000) });
    const text = await res.text();
    if (!res.ok)
        throw new Error(`${init.method ?? 'GET'} ${url.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text);
}
async function overpass(query) {
    let last = null;
    for (const url of OVERPASS_URLS) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return (await getJson(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
            }
            catch (e) {
                last = e;
                await sleep(15000 * (attempt + 1));
            }
        }
    }
    throw last;
}
async function fetchOsm() {
    const b = korosten_osm_1.KOROSTEN_BBOX;
    const bbox = `${b.south},${b.west},${b.north},${b.east}`;
    const res = await overpass(`[out:json][timeout:90];(node["highway"="bus_stop"](${bbox});node["public_transport"="platform"](${bbox});` +
        `way["public_transport"="platform"](${bbox});rel["type"="route"]["route"="bus"](${bbox}););out center tags;`);
    const elements = res.elements;
    const stops = new Map((0, korosten_osm_1.osmStopsFromOverpass)(elements).map((s) => [s.id, s]));
    const relationIds = elements.filter((e) => e.type === 'relation').map((e) => e.id).sort((a, b) => a - b);
    const routes = [];
    for (const id of relationIds) {
        // повний маршрут (з платформами поза межами міста) — з основного API OSM
        const full = (await getJson(`https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`));
        const route = (0, korosten_osm_1.osmRouteFromFull)(full.elements, id);
        routes.push(route);
        for (const p of route.platforms)
            if (p.name && !stops.has(p.id))
                stops.set(p.id, p);
        await sleep(1000);
    }
    const snapshot = {
        fetchedAt: new Date().toISOString(),
        stops: [...stops.values()].sort((a, b) => a.id.localeCompare(b.id)),
        routes,
    };
    write(korosten_dataset_files_1.OSM_SNAPSHOT_FILE, `${JSON.stringify({ _license: '© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright', ...snapshot }, null, 2)}\n`);
}
async function fetchStreets() {
    // середини вулиць із переліку ради (Nominatim: не частіше запиту на секунду)
    const official = (0, korosten_stop_aliases_1.parseOfficialStops)(node_fs_1.default.readFileSync(node_path_1.default.join(ROOT, 'source', 'stops.csv'), 'utf8'));
    const streets = {};
    for (const street of [...new Set(official.map((s) => s.street.trim()).filter((s) => s && s !== 'NA'))].sort()) {
        // «вул. І. Котляревського (Г. Сковороди)» → «вулиця Котляревського», «Котляревського», «Білокоровицьке шосе»…
        const bare = street.replace(/\([^)]*\)/g, ' ').replace(/^(вул|пров)\.\s*/i, '').replace(/^ім\.\s*/i, '').replace(/\s+/g, ' ').trim();
        const noInitials = bare.replace(/^(\p{Lu}\.\s*)+/u, '').trim();
        const kind = /^пров\./i.test(street) ? 'провулок' : 'вулиця';
        const queries = [...new Set([`${kind} ${noInitials}`, noInitials, bare])];
        let hit = null;
        for (const q of queries) {
            const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ street: q, city: 'Коростень', country: 'Україна', format: 'jsonv2', limit: '3' })}`;
            const found = (await getJson(url));
            await sleep(1100);
            const f = found.find((x) => x.category === 'highway');
            if (f) {
                hit = { lat: Math.round(Number(f.lat) * 1e7) / 1e7, lng: Math.round(Number(f.lon) * 1e7) / 1e7 };
                break;
            }
        }
        streets[street] = hit;
    }
    write(korosten_dataset_files_1.OSM_STREETS_FILE, `${JSON.stringify({ _license: '© OpenStreetMap contributors, ODbL 1.0 (Nominatim)', fetchedAt: new Date().toISOString(), streets }, null, 2)}\n`);
}
async function fetchGoogle(dataset) {
    const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
    if (!key)
        throw new Error('GOOGLE_MAPS_API_KEY is not set');
    const b = korosten_osm_1.KOROSTEN_BBOX;
    const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key };
    const check = { checkedAt: new Date().toISOString(), stops: {} };
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
        }));
        const p = res.places?.[0];
        // координати Google лише для відстані — у файл не пишемо
        check.stops[s.id] = {
            ours: [s.lat, s.lng],
            placeId: p?.id ?? null,
            name: p?.displayName?.text ?? null,
            distanceM: p?.location ? Math.round((0, korosten_osm_1.distanceM)(s, { lat: p.location.latitude, lng: p.location.longitude })) : null,
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
        }));
        const lines = [
            ...new Set((res.routes ?? []).flatMap((r) => (r.legs ?? []).flatMap((l) => (l.steps ?? []).map((st) => st.transitDetails?.transitLine?.nameShort ?? st.transitDetails?.transitLine?.name ?? '').filter(Boolean)))),
        ].sort();
        check.transit = {
            from: from.id,
            to: to.id,
            lines,
            note: lines.length ? `${from.name} → ${to.name}: лінії ${lines.join(', ')}` : `${from.name} → ${to.name}: міського транспорту Google не знає`,
        };
    }
    write(korosten_dataset_files_1.GOOGLE_CHECK_FILE, `${JSON.stringify(check, null, 2)}\n`);
}
function apiBase() {
    if (process.env.API_BASE)
        return process.env.API_BASE.replace(/\/$/, '');
    const src = node_fs_1.default.readFileSync(node_path_1.default.resolve(__dirname, '../../../frontend/scripts/api-base.mjs'), 'utf8');
    const m = /'(https:\/\/[^']+)'/.exec(src);
    if (!m)
        throw new Error('API base not found in frontend/scripts/api-base.mjs');
    return m[1];
}
/** JSON із ключами за абеткою: база (jsonb) повертає ключі варіантів не в тому порядку, у якому їх записали */
function stable(value) {
    if (Array.isArray(value))
        return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}
/** Порядок і поля, які повертає GET, — для порівняння «після PUT = кандидат» */
function canon(d) {
    const x = d;
    const sort = (xs, key) => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
    return JSON.stringify({
        stops: sort(x.stops, (s) => s.id).map((s) => [s.id, s.name, s.lat, s.lng]),
        routes: sort(x.routes, (r) => r.id).map((r) => [r.id, r.fromName, r.toName, r.shortName ?? '', stable(r.variants ?? [])]),
        routeStops: sort(x.routeStops, (r) => `${r.routeId}|${r.stopId}`).map((r) => [r.routeId, r.stopId, r.orderThere, r.orderBack]),
        trips: sort(x.trips, (t) => t.id).map((t) => [t.id, t.routeId, t.serviceId, t.directionId, t.departureTime, t.blockId, t.startStopId ?? null, t.endStopId ?? null, t.arrivalTime ?? null, t.variantId ?? null]),
        segments: sort(x.segments, (s) => `${s.routeId}|${s.fromStopId}|${s.toStopId}`).map((s) => [s.routeId, s.fromStopId, s.toStopId, s.seconds]),
        routeColors: stable(x.meta?.routeColors ?? null),
    });
}
async function apply(candidate, dry) {
    const base = apiBase();
    const token = process.env.ADMIN_TOKEN || process.env.VIBER_ADMIN_TOKEN || '';
    if (!token)
        throw new Error('ADMIN_TOKEN (або VIBER_ADMIN_TOKEN) не задано');
    const auth = { Authorization: token };
    const url = `${base}/transport/dataset?city=${CITY}`;
    const current = (await getJson(url, { headers: auth }));
    const count = (d) => `зупинок ${d.stops?.length ?? 0}, маршрутів ${d.routes?.length ?? 0}, рейсів ${d.trips?.length ?? 0}, сегментів ${d.segments?.length ?? 0}`;
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
    const dir = node_path_1.default.join(node_os_1.default.homedir(), 'korosten-backups');
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const backup = node_path_1.default.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    node_fs_1.default.writeFileSync(backup, JSON.stringify(current, null, 2));
    console.log(`бекап: ${backup}`);
    const meta = { ...(current.meta ?? {}), ...candidate.meta };
    const put = (await getJson(url, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...candidate, meta, baseRevision: current.revision ?? undefined }),
    }));
    console.log(`PUT ok, ревізія ${put.revision ?? '—'}`);
    const after = (await getJson(url, { headers: auth }));
    if (canon(after) !== canon(candidate))
        throw new Error('після PUT база відрізняється від чернетки — перевірте бекап і звіт');
    console.log('перевірка: база = чернетка');
}
async function main() {
    if (has('--fetch-osm'))
        await fetchOsm();
    if (has('--fetch-osm') || has('--fetch-streets'))
        await fetchStreets();
    let { files, result } = (0, korosten_dataset_files_1.buildKorostenDatasetFiles)(ROOT);
    if (has('--fetch-google')) {
        await fetchGoogle(result.dataset);
        ({ files, result } = (0, korosten_dataset_files_1.buildKorostenDatasetFiles)(ROOT));
    }
    const { errors } = (0, local_transport_1.validateTransportDataset)(JSON.parse(JSON.stringify(result.dataset)));
    if (errors.length)
        throw new Error(`чернетка не проходить валідацію PUT:\n${errors.join('\n')}`);
    for (const [file, content] of Object.entries(files))
        write(file, content);
    const d = result.dataset;
    console.log(`${korosten_dataset_files_1.DATASET_FILE}: зупинок ${d.stops.length}, маршрутів ${d.routes.length}, рейсів ${d.trips.length}, сегментів ${d.segments.length}`);
    if (has('--apply') || has('--dry-run'))
        await apply(d, !has('--apply'));
}
main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
