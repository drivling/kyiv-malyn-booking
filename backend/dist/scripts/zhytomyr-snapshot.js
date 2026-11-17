"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Знімок zt.rozklad.in.ua (сайт власника з графіками міського транспорту Житомира) у репозиторій
 * (Docs/dovede-roadmap.md, «Житомир зі свого сайту»):
 *   data/zhytomyr-transport/source/home.json        — маршрути з головної сторінки
 *   data/zhytomyr-transport/source/html/<id>.html   — частина сторінки кожного напрямку (extractZtFragment)
 *   data/zhytomyr-transport/routes.json             — розібрані напрямки (zhytomyr-site-parser.ts)
 *
 * npm run zhytomyr:snapshot              — без мережі: routes.json зі збережених сторінок
 *   data/zhytomyr-transport/osm/stops.json          — названі зупинки з OpenStreetMap (ODbL)
 *   data/zhytomyr-transport/google/stop-geocode.json — точки Google для зупинок, яких немає в OSM
 *   data/zhytomyr-transport/stops.json              — координати зупинок сайту (zhytomyr-stops.ts)
 *   data/zhytomyr-transport/REPORT.md               — наші маршрути проти Google
 *   backend/src/dovede/zhytomyr-own-data.ts         — дані для сервера «Доведе» (каталогу data/ на сервері немає)
 *
 * npm run zhytomyr:snapshot                    — без мережі: routes.json і stops.json зі збережених файлів
 * npm run zhytomyr:snapshot -- --fetch         — завантажити сторінки заново (один запит на напрямок, з паузою)
 * npm run zhytomyr:snapshot -- --fetch-osm     — оновити знімок зупинок OSM (Overpass)
 * npm run zhytomyr:snapshot -- --google-stops  — спитати в Google зупинки, яких немає в OSM (GOOGLE_MAPS_API_KEY;
 *                                                зберігаємо за договором власника з Google — Docs/dovede-roadmap.md)
 * npm run zhytomyr:snapshot -- --google        — звірити маршрути з Google Routes: спершу три великі відрізки кожного
 *                                                напрямку, далі перегони; уже звірене не питає вдруге, ZT_GOOGLE_LIMIT
 *                                                (типово 400) — скільки запитів за запуск → google/checks.json, REPORT.md
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const zhytomyr_site_parser_1 = require("../zhytomyr-site-parser");
const zhytomyr_routes_1 = require("../zhytomyr-routes");
const zhytomyr_google_check_1 = require("../zhytomyr-google-check");
const zhytomyr_stops_1 = require("../zhytomyr-stops");
const ROOT = node_path_1.default.resolve(__dirname, '../../../data/zhytomyr-transport');
const SOURCE = node_path_1.default.join(ROOT, 'source');
const HTML = node_path_1.default.join(SOURCE, 'html');
const BASE = 'https://zt.rozklad.in.ua';
/** Сайт відмовляє запитам без браузерного заголовка */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'uk' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!res.ok)
        throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
}
async function fetchAll() {
    node_fs_1.default.mkdirSync(HTML, { recursive: true });
    const home = (0, zhytomyr_site_parser_1.parseZtHome)(await get(`${BASE}/`));
    if (home.length < 5)
        throw new Error(`на головній лише ${home.length} маршрутів — розмітка змінилась?`);
    node_fs_1.default.writeFileSync(node_path_1.default.join(SOURCE, 'home.json'), `${JSON.stringify({ source: `${BASE}/`, fetchedAt: new Date().toISOString().slice(0, 10), routes: home }, null, 2)}\n`);
    const queue = home.map((r) => r.dirId);
    const done = new Set();
    while (queue.length) {
        const id = queue.shift();
        if (done.has(id))
            continue;
        done.add(id);
        await sleep(700);
        const fragment = (0, zhytomyr_site_parser_1.extractZtFragment)(await get(`${BASE}/home/schedule/${id}`));
        const dir = (0, zhytomyr_site_parser_1.parseZtDirection)(fragment, id);
        node_fs_1.default.writeFileSync(node_path_1.default.join(HTML, `${id}.html`), fragment);
        console.log(`${id}: №${dir.number} ${dir.name} — зупинок ${dir.stops.length}, рейсів ${dir.workdays.length} / ${dir.weekend.length}`);
        if (dir.reverseId != null && !done.has(dir.reverseId))
            queue.push(dir.reverseId);
    }
    // сторінки напрямків, яких на сайті вже немає, у знімку не лишаємо
    for (const f of node_fs_1.default.readdirSync(HTML)) {
        if (!done.has(Number(node_path_1.default.basename(f, '.html'))))
            node_fs_1.default.rmSync(node_path_1.default.join(HTML, f));
    }
}
const BBOX = '50.19,28.55,50.33,28.80';
const OVERPASS_URLS = (process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter').split(',');
async function fetchOsm() {
    const query = `[out:json][timeout:60];(node["highway"="bus_stop"](${BBOX});node["public_transport"="platform"](${BBOX});node["public_transport"="stop_position"](${BBOX});node["railway"="tram_stop"](${BBOX}););out body;`;
    const got = [];
    // --osm-file <шлях> — відповідь Overpass, збережена раніше (сервери Overpass часто перевантажені)
    const saved = process.argv.indexOf('--osm-file');
    if (saved >= 0)
        got.push(JSON.parse(node_fs_1.default.readFileSync(process.argv[saved + 1], 'utf8')).elements);
    for (const url of got.length ? [] : OVERPASS_URLS) {
        try {
            const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(90000) });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            got.push((await res.json()).elements);
            break;
        }
        catch (e) {
            console.warn(`Overpass ${url}: ${e instanceof Error ? e.message : e}`);
        }
    }
    if (!got.length)
        throw new Error('жоден сервер Overpass не відповів');
    const elements = got[0];
    const stops = elements
        .filter((e) => e.tags?.name && e.lat != null && e.lon != null)
        .map((e) => ({ name: e.tags.name.trim(), lat: Math.round(e.lat * 1e6) / 1e6, lng: Math.round(e.lon * 1e6) / 1e6 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'uk') || a.lat - b.lat || a.lng - b.lng);
    node_fs_1.default.mkdirSync(node_path_1.default.join(ROOT, 'osm'), { recursive: true });
    node_fs_1.default.writeFileSync(node_path_1.default.join(ROOT, 'osm/stops.json'), `${JSON.stringify({ _license: '© OpenStreetMap contributors, ODbL 1.0', fetchedAt: new Date().toISOString().slice(0, 10), bbox: BBOX, stops })}\n`);
    console.log(`osm/stops.json: ${stops.length} названих зупинок`);
}
/** Зупинки, яких немає в OSM, — у Google за назвою (Places Text Search). Уже спитане не питаємо вдруге */
async function googleStops() {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key)
        throw new Error('потрібен GOOGLE_MAPS_API_KEY');
    const file = node_path_1.default.join(ROOT, 'google/stop-geocode.json');
    const state = node_fs_1.default.existsSync(file) ? JSON.parse(node_fs_1.default.readFileSync(file, 'utf8')) : { found: {}, asked: {} };
    const osm = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(ROOT, 'osm/stops.json'), 'utf8')).stops;
    const { stops, missing } = (0, zhytomyr_stops_1.locateZhytomyrStops)((0, zhytomyr_routes_1.loadZhytomyrRoutes)(ROOT), osm);
    const need = new Map();
    for (const s of [...stops.filter((x) => x.source === 'interpolated'), ...missing]) {
        const k = (0, zhytomyr_stops_1.stopKey)(s.name);
        if (k && !(k in state.asked))
            need.set(k, s.name.replace(/\s*\(на вимогу\)/, '').replace(/\s+\[?0\d{1,2}\]?\s*$/, ''));
    }
    const limit = Number(process.env.ZT_GOOGLE_LIMIT ?? 400);
    let n = 0;
    for (const [k, name] of need) {
        if (n++ >= limit)
            break;
        await sleep(120);
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.location,places.types' },
            body: JSON.stringify({ textQuery: `зупинка ${name}, Житомир`, languageCode: 'uk', maxResultCount: 5, locationRestriction: { rectangle: { low: { latitude: 50.19, longitude: 28.55 }, high: { latitude: 50.33, longitude: 28.8 } } } }),
            signal: AbortSignal.timeout(20000),
        });
        if (!res.ok)
            throw new Error(`Places: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        const places = (await res.json()).places ?? [];
        // лише зупинки транспорту: крамниця чи вулиця з такою назвою — не те
        const hits = places
            .filter((p) => p.location && (p.types ?? []).some((t) => t === 'bus_stop' || t === 'bus_station' || t === 'transit_station' || t === 'tram_stop'))
            .map((p) => ({ lat: Math.round(p.location.latitude * 1e6) / 1e6, lng: Math.round(p.location.longitude * 1e6) / 1e6, name: p.displayName?.text ?? '' }));
        state.asked[k] = name;
        if (hits.length)
            state.found[k] = hits;
        console.log(`${name}: ${hits.length ? hits.map((h) => h.name).join(' / ') : '—'}`);
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
        node_fs_1.default.writeFileSync(file, `${JSON.stringify(state)}\n`);
    }
}
/** Наступний будень, 10:00 за Києвом (взимку UTC+2, влітку UTC+3 — година різниці для звірки неважлива) */
function nextWeekdayTen() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
        d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(8, 0, 0, 0);
    return d.toISOString();
}
async function googleCheck() {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key)
        throw new Error('потрібен GOOGLE_MAPS_API_KEY');
    const file = node_path_1.default.join(ROOT, 'google/checks.json');
    const state = node_fs_1.default.existsSync(file) ? JSON.parse(node_fs_1.default.readFileSync(file, 'utf8')) : { checks: {} };
    const stops = JSON.parse((0, zhytomyr_routes_1.buildZhytomyrStops)(ROOT)).stops;
    const spans = (0, zhytomyr_google_check_1.checkSpans)((0, zhytomyr_routes_1.loadZhytomyrRoutes)(ROOT), stops).filter((s) => !state.checks[s.key]);
    const limit = Number(process.env.ZT_GOOGLE_LIMIT ?? 400);
    const departureTime = nextWeekdayTen();
    const point = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    let n = 0;
    for (const span of spans) {
        if (n++ >= limit)
            break;
        // у Routes є ліміт запитів за хвилину: їдемо повільно, а на 429 чекаємо хвилину й пробуємо ще (до трьох разів)
        let res = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            await sleep(attempt ? 65000 : Number(process.env.ZT_GOOGLE_PAUSE_MS ?? 6500));
            res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': key,
                    'X-Goog-FieldMask': 'routes.legs.steps.staticDuration,routes.legs.steps.transitDetails.stopCount,routes.legs.steps.transitDetails.stopDetails,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.name',
                },
                body: JSON.stringify({ origin: point(span.from), destination: point(span.to), travelMode: 'TRANSIT', computeAlternativeRoutes: true, departureTime, languageCode: 'uk', transitPreferences: { allowedTravelModes: ['BUS'] } }),
                signal: AbortSignal.timeout(20000),
            });
            if (res.status !== 429)
                break;
        }
        if (!res || !res.ok) {
            console.warn(`Routes: HTTP ${res?.status} ${(await res?.text())?.slice(0, 160)} — зупиняюсь, продовжити можна пізніше`);
            break;
        }
        const v = (0, zhytomyr_google_check_1.spanVerdict)(span, (0, zhytomyr_google_check_1.googleRides)(await res.json()), new Date().toISOString().slice(0, 10));
        state.checks[span.key] = v;
        console.log(`№${span.number} ${span.level} «${span.from.name}» → «${span.to.name}»: ${v.verdict}${v.google ? ` (наше ${span.minutes} хв / Google ${v.google.minutes} хв)` : v.otherLines ? ` (Google: ${v.otherLines.join(', ')})` : ''}`);
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
        node_fs_1.default.writeFileSync(file, `${JSON.stringify(state)}\n`);
    }
}
async function main() {
    if (process.argv.includes('--fetch'))
        await fetchAll();
    if (process.argv.includes('--fetch-osm') || process.argv.includes('--osm-file'))
        await fetchOsm();
    if (process.argv.includes('--google-stops'))
        await googleStops();
    if (process.argv.includes('--google'))
        await googleCheck();
    const json = (0, zhytomyr_routes_1.buildZhytomyrRoutes)(ROOT);
    node_fs_1.default.writeFileSync(node_path_1.default.join(ROOT, 'routes.json'), json);
    console.log(`routes.json: ${json.length} chars`);
    const stops = (0, zhytomyr_routes_1.buildZhytomyrStops)(ROOT);
    node_fs_1.default.writeFileSync(node_path_1.default.join(ROOT, 'stops.json'), stops);
    const parsed = JSON.parse(stops);
    const count = {};
    for (const s of parsed.stops)
        count[s.source] = (count[s.source] ?? 0) + 1;
    console.log(`stops.json: ${JSON.stringify(count)}, без координат ${parsed.missing.length}`);
    node_fs_1.default.writeFileSync(node_path_1.default.join(ROOT, 'REPORT.md'), (0, zhytomyr_routes_1.buildZhytomyrReport)(ROOT));
    node_fs_1.default.writeFileSync(node_path_1.default.resolve(__dirname, '../../src/dovede/zhytomyr-own-data.ts'), (0, zhytomyr_routes_1.buildZhytomyrOwnData)(ROOT));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
