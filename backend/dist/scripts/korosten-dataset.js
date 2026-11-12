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
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const local_transport_1 = require("../local-transport");
const korosten_osm_1 = require("../korosten-osm");
const korosten_stop_aliases_1 = require("../korosten-stop-aliases");
const korosten_dataset_1 = require("../korosten-dataset");
const korosten_google_1 = require("../korosten-google");
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
function readLocalJson(file) {
    const full = node_path_1.default.join(ROOT, file);
    return node_fs_1.default.existsSync(full) ? JSON.parse(node_fs_1.default.readFileSync(full, 'utf8')) : null;
}
/** Ключ Google: справжній — з оточення; у хмарній сесії — будь-який, проксі підставить свій (NODE_USE_ENV_PROXY=1) */
function googleKey() {
    const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
    if (!key)
        throw new Error('GOOGLE_MAPS_API_KEY is not set');
    return key;
}
async function computeTransit(key, from, to, when, fieldMask) {
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
    }));
}
/** Найближчий будній день (від завтра), hh:mm за Києвом → момент UTC */
function nextWeekdayKyiv(minutes) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    while ([0, 6].includes(d.getUTCDay()))
        d.setUTCDate(d.getUTCDate() + 1);
    const ymd = d.toISOString().slice(0, 10);
    const probe = new Date(`${ymd}T12:00:00Z`);
    const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' })
        .formatToParts(probe)
        .find((p) => p.type === 'timeZoneName')?.value.match(/GMT([+-]\d+)/)?.[1];
    const hours = Number(offset ?? '2');
    return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)), 0, minutes - hours * 60));
}
async function fetchGoogle(dataset, onlyMissing) {
    const key = googleKey();
    const b = korosten_osm_1.KOROSTEN_BBOX;
    const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key };
    const prevCheck = onlyMissing ? readLocalJson(korosten_dataset_files_1.GOOGLE_CHECK_FILE) : null;
    const prevCoords = onlyMissing ? readLocalJson(korosten_dataset_files_1.GOOGLE_COORDS_FILE) : null;
    const check = { checkedAt: prevCheck?.checkedAt ?? new Date().toISOString(), stops: { ...(prevCheck?.stops ?? {}) }, transit: prevCheck?.transit };
    // Координати Google — лише в локальний файл поза git (репозиторій публічний, умови Google забороняють їх
    // публікувати); власник бере їх тимчасово, до перевірки зупинок на місці
    const coords = { fetchedAt: prevCoords?.fetchedAt ?? check.checkedAt, stops: { ...(prevCoords?.stops ?? {}) } };
    let asked = 0;
    for (const s of dataset.stops) {
        if (onlyMissing && check.stops[s.id])
            continue;
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
        }));
        const p = res.places?.[0];
        if (p?.location)
            coords.stops[s.id] = { lat: p.location.latitude, lng: p.location.longitude, placeId: p.id, name: p.displayName?.text ?? null };
        // у check.json — лише відстань і place_id
        check.stops[s.id] = {
            ours: [s.lat, s.lng],
            placeId: p?.id ?? null,
            name: p?.displayName?.text ?? null,
            distanceM: p?.location ? Math.round((0, korosten_osm_1.distanceM)(s, { lat: p.location.latitude, lng: p.location.longitude })) : null,
        };
        await sleep(200);
    }
    console.log(`Places: ${asked} запитів`);
    if (!onlyMissing || !check.transit) {
        // Routes API TRANSIT між кінцевими кожного маршруту: які лінії Google пропонує (лише номери, без геометрії)
        const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
        check.transit = [];
        for (const r of dataset.routes) {
            const chain = dataset.routeStops.filter((x) => x.routeId === r.id && x.orderThere > 0).sort((a, b) => a.orderThere - b.orderThere);
            const from = stopById.get(chain[0]?.stopId ?? '');
            const to = stopById.get(chain[chain.length - 1]?.stopId ?? '');
            if (!from || !to)
                continue;
            const res = await computeTransit(key, from, to, nextWeekdayKyiv(9 * 60), 'routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.name');
            const lines = [
                ...new Set((res.routes ?? []).flatMap((x) => (x.legs ?? []).flatMap((l) => (l.steps ?? []).map((st) => st.transitDetails?.transitLine?.nameShort ?? st.transitDetails?.transitLine?.name ?? '').filter(Boolean)))),
            ].sort((a, b) => a.localeCompare(b, 'uk', { numeric: true }));
            check.transit.push({ routeId: r.id, from: from.id, to: to.id, lines });
            await sleep(200);
        }
    }
    write(korosten_dataset_files_1.GOOGLE_CHECK_FILE, `${JSON.stringify(check, null, 2)}\n`);
    write(korosten_dataset_files_1.GOOGLE_COORDS_FILE, `${JSON.stringify(coords, null, 2)}\n`);
}
/**
 * Перевірка кожного прогону через Google (--google-hops): трійки сусідніх зупинок A → B → C усіх ланцюжків, Routes
 * TRANSIT від A до C у будній день о часі, коли наш маршрут там їде. Повна відповідь (з координатами Google) — у
 * google/hops.local.json (поза git, з продовженням з місця, де зупинились); висновки без координат Google —
 * google/hops.json (у git, для звіту).
 */
async function googleHops(dataset, refresh) {
    const key = googleKey();
    const raw = refresh ? {} : readLocalJson(korosten_dataset_files_1.GOOGLE_HOPS_LOCAL_FILE) ?? {};
    const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
    const chains = (0, korosten_google_1.datasetChains)(dataset);
    const triples = (0, korosten_google_1.hopTriples)(chains);
    const seg = new Map(dataset.segments.map((x) => [`${x.routeId}|${x.fromStopId}|${x.toStopId}`, x.seconds]));
    /** Коли наш маршрут проходить зупинку A: перший рейс ланцюжка від 07:00 (інакше перший) + сегменти до A */
    const minutesAt = (t) => {
        const r = t.routes[0];
        const ch = chains.find((c) => c.routeId === r.routeId && c.variantId === r.variantId && c.stopIds.join('>').includes(t.b ? `${t.a}>${t.b}>${t.c}` : `${t.a}>${t.c}`));
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
        if (raw[t.key])
            continue;
        const a = stopById.get(t.a);
        const c = stopById.get(t.c);
        const when = nextWeekdayKyiv(minutesAt(t));
        let res;
        try {
            res = await computeTransit(key, a, c, when, 'routes.legs.steps.travelMode,routes.legs.steps.polyline,routes.legs.steps.transitDetails');
        }
        catch (e) {
            console.error(`зупинились на ${t.key}: ${e instanceof Error ? e.message : e} — повторний запуск продовжить`);
            break;
        }
        const toLatLng = (p) => p?.location?.latLng ? { lat: p.location.latLng.latitude, lng: p.location.latLng.longitude } : null;
        raw[t.key] = {
            fetchedAt: new Date().toISOString(),
            departure: when.toISOString(),
            steps: (res.routes ?? []).map((r) => (r.legs ?? []).flatMap((l) => l.steps ?? []).filter((st) => st.travelMode === 'TRANSIT' && st.transitDetails).map((st) => ({
                line: st.transitDetails?.transitLine?.nameShort ?? st.transitDetails?.transitLine?.name ?? '',
                stopCount: st.transitDetails?.stopCount ?? null,
                departure: toLatLng(st.transitDetails?.stopDetails?.departureStop),
                arrival: toLatLng(st.transitDetails?.stopDetails?.arrivalStop),
                polyline: st.polyline?.encodedPolyline ? (0, korosten_google_1.decodePolyline)(st.polyline.encodedPolyline) : [],
            }))),
        };
        asked++;
        if (asked % 20 === 0) {
            write(korosten_dataset_files_1.GOOGLE_HOPS_LOCAL_FILE, `${JSON.stringify(raw)}\n`);
            console.log(`… ${asked} запитів`);
        }
        await sleep(150);
    }
    write(korosten_dataset_files_1.GOOGLE_HOPS_LOCAL_FILE, `${JSON.stringify(raw)}\n`);
    console.log(`Routes: ${asked} нових запитів, трійок ${triples.length}, перевірено ${triples.filter((t) => raw[t.key]).length}`);
    const verdicts = [];
    for (const t of triples) {
        const r = raw[t.key];
        if (!r)
            continue;
        const at = (id) => (id ? { lat: stopById.get(id).lat, lng: stopById.get(id).lng } : null);
        verdicts.push((0, korosten_google_1.hopVerdict)(t, { a: at(t.a), b: at(t.b), c: at(t.c) }, r.steps));
    }
    const file = { checkedAt: new Date().toISOString(), verdicts: verdicts.map(({ ours, ...rest }) => ({ ...rest, oursHash: (0, korosten_dataset_1.coordsHash)(ours) })) };
    write(korosten_dataset_files_1.GOOGLE_HOPS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}
/**
 * Координати Google за place_id з google/check.json (Place Details — окрема від пошуку квота): коли пошук уже
 * зроблено, а координат у локальному файлі нема. Пишеться лише google/coords.local.json (поза git).
 */
async function fetchGoogleCoords() {
    const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
    if (!key)
        throw new Error('GOOGLE_MAPS_API_KEY is not set');
    const check = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(ROOT, korosten_dataset_files_1.GOOGLE_CHECK_FILE), 'utf8'));
    const coords = { fetchedAt: new Date().toISOString(), stops: {} };
    for (const [stopId, c] of Object.entries(check.stops).sort((a, b) => a[0].localeCompare(b[0]))) {
        if (!c.placeId)
            continue;
        const p = (await getJson(`https://places.googleapis.com/v1/places/${encodeURIComponent(c.placeId)}?languageCode=uk`, {
            headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName,location' },
        }));
        if (p.location)
            coords.stops[stopId] = { lat: p.location.latitude, lng: p.location.longitude, placeId: p.id, name: p.displayName?.text ?? null };
        await sleep(150);
    }
    write(korosten_dataset_files_1.GOOGLE_COORDS_FILE, `${JSON.stringify(coords, null, 2)}\n`);
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
    if (has('--fetch-google-coords'))
        await fetchGoogleCoords();
    if (has('--fetch-google'))
        await fetchGoogle((0, korosten_dataset_files_1.buildKorostenDatasetFiles)(ROOT).result.dataset, has('--only-missing'));
    const withGoogle = has('--google-coords');
    // прогони перевіряємо на тій версії, що піде в базу: з точками Google, якщо її просили
    if (has('--google-hops'))
        await googleHops((0, korosten_dataset_files_1.buildKorostenDatasetFiles)(ROOT, { withGoogleCoords: withGoogle }).result.dataset, has('--refresh'));
    const check = (d, label) => {
        const { errors } = (0, local_transport_1.validateTransportDataset)(JSON.parse(JSON.stringify(d)));
        if (errors.length)
            throw new Error(`${label} не проходить валідацію PUT:\n${errors.join('\n')}`);
    };
    const { files, result } = (0, korosten_dataset_files_1.buildKorostenDatasetFiles)(ROOT);
    check(result.dataset, 'чернетка');
    for (const [file, content] of Object.entries(files))
        write(file, content);
    const d = result.dataset;
    console.log(`${korosten_dataset_files_1.DATASET_FILE}: зупинок ${d.stops.length}, маршрутів ${d.routes.length}, рейсів ${d.trips.length}, сегментів ${d.segments.length}`);
    // --google-coords: та сама чернетка, але приблизні точки замінено точками Google — лише локально, поза git
    let target = d;
    if (withGoogle) {
        const local = (0, korosten_dataset_files_1.buildKorostenDatasetFiles)(ROOT, { withGoogleCoords: true });
        check(local.result.dataset, 'чернетка з Google');
        write(korosten_dataset_files_1.LOCAL_DATASET_FILE, local.files[korosten_dataset_files_1.DATASET_FILE]);
        write(korosten_dataset_files_1.LOCAL_REPORT_FILE, local.files[korosten_dataset_files_1.REPORT_FILE]);
        target = local.result.dataset;
    }
    if (has('--apply') || has('--dry-run'))
        await apply(target, !has('--apply'));
}
main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
