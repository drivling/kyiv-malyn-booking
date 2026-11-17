"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadZhytomyrRoutes = loadZhytomyrRoutes;
exports.buildZhytomyrRoutes = buildZhytomyrRoutes;
exports.buildZhytomyrStops = buildZhytomyrStops;
exports.buildZhytomyrReport = buildZhytomyrReport;
exports.buildZhytomyrOwnData = buildZhytomyrOwnData;
/**
 * data/zhytomyr-transport/routes.json зі збережених сторінок zt.rozklad.in.ua. Окремо від скрипта, щоб тест міг
 * перевірити: закомічений файл дорівнює розбору закомічених сторінок.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const zhytomyr_site_parser_1 = require("./zhytomyr-site-parser");
const zhytomyr_google_check_1 = require("./zhytomyr-google-check");
const zhytomyr_stops_1 = require("./zhytomyr-stops");
function loadZhytomyrRoutes(root) {
    const home = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'source/home.json'), 'utf8'));
    const dir = (id) => (0, zhytomyr_site_parser_1.parseZtDirection)(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'source/html', `${id}.html`), 'utf8'), id);
    const routes = home.routes.map((link) => {
        const there = dir(link.dirId);
        const directions = [there];
        if (there.reverseId != null && node_fs_1.default.existsSync(node_path_1.default.join(root, 'source/html', `${there.reverseId}.html`)))
            directions.push(dir(there.reverseId));
        return { number: link.number, mode: link.mode, name: link.name, directions };
    });
    return { source: home.source, fetchedAt: home.fetchedAt, routes };
}
function buildZhytomyrRoutes(root) {
    return `${JSON.stringify(loadZhytomyrRoutes(root))}\n`;
}
const readJson = (file, fallback) => (node_fs_1.default.existsSync(file) ? JSON.parse(node_fs_1.default.readFileSync(file, 'utf8')) : fallback);
/** data/zhytomyr-transport/stops.json: координати зупинок із OSM, Google й ручних підказок */
const stopsMemo = new Map();
function buildZhytomyrStops(root) {
    // звіт і дані сервера беруть ті самі зупинки — рахуємо їх раз на процес
    const cached = stopsMemo.get(root);
    if (cached)
        return cached;
    const built = computeZhytomyrStops(root);
    stopsMemo.set(root, built);
    return built;
}
function computeZhytomyrStops(root) {
    const osm = readJson(node_path_1.default.join(root, 'osm/stops.json'), { stops: [] }).stops;
    const hints = readJson(node_path_1.default.join(root, 'stops.hints.json'), {});
    const geocode = readJson(node_path_1.default.join(root, 'google/stop-geocode.json'), { found: {}, asked: {} });
    // Google на «зупинка Каракульна» повертає й сусідні зупинки — лишаємо лише ті, що звуться так само
    const google = {};
    for (const [key, hits] of Object.entries(geocode.found)) {
        const same = hits.filter((h) => (0, zhytomyr_stops_1.sameStopName)(geocode.asked[key] ?? '', h.name));
        if (same.length)
            google[key] = same;
    }
    const { stops, missing } = (0, zhytomyr_stops_1.locateZhytomyrStops)(loadZhytomyrRoutes(root), osm, hints, google);
    return `${JSON.stringify({ stops, missing })}\n`;
}
/** data/zhytomyr-transport/REPORT.md: наші маршрути проти Google (google/checks.json) */
function buildZhytomyrReport(root) {
    const routes = loadZhytomyrRoutes(root);
    const stops = JSON.parse(buildZhytomyrStops(root));
    const verdicts = readJson(node_path_1.default.join(root, 'google/checks.json'), { checks: {} }).checks;
    const osm = readJson(node_path_1.default.join(root, 'osm/stops.json'), { stops: [] }).stops;
    return (0, zhytomyr_google_check_1.buildCheckReport)(routes, stops, (0, zhytomyr_google_check_1.checkSpans)(routes, stops.stops), verdicts, osm);
}
/**
 * backend/src/dovede/zhytomyr-own-data.ts — те, з чого сервер «Доведе» складає пряму поїздку Житомиром без Google:
 * зупинки з хвилинами й координатами та відправлення від першої зупинки. Каталогу `data/` на сервері немає,
 * тому дані їдуть модулем. `checked` — три великі відрізки напрямку збіглися з Google (REPORT.md); лише такі
 * напрямки йдуть у відповідь людині. Рейси «у депо» сюди не потрапляють: вони не йдуть до кінцевої.
 */
function buildZhytomyrOwnData(root) {
    const routes = loadZhytomyrRoutes(root);
    const stops = JSON.parse(buildZhytomyrStops(root)).stops;
    const byId = new Map(stops.map((s) => [s.id, s]));
    const verdicts = readJson(node_path_1.default.join(root, 'google/checks.json'), { checks: {} }).checks;
    const status = new Map((0, zhytomyr_google_check_1.directionChecks)(routes, (0, zhytomyr_google_check_1.checkSpans)(routes, stops), verdicts).map((d) => [d.dirId, d.status]));
    const side = (name) => name.replace(/\s+\[?0\d{1,2}\]?\s*$/, '').trim();
    const times = (list) => list.filter((d) => !d.note?.includes('depot')).map((d) => d.time);
    const dirs = routes.routes.flatMap((r) => r.directions.map((d) => ({
        id: d.dirId,
        no: r.number,
        name: d.name,
        checked: status.get(d.dirId) === 'checked',
        stops: d.stops.map((s) => {
            const at = byId.get(s.id);
            // приблизна координата (між сусідами) для пошуку «поруч» не годиться
            return at && at.source !== 'interpolated' ? [side(s.name), s.minutes, at.lat, at.lng] : [side(s.name), s.minutes, null, null];
        }),
        wd: times(d.workdays),
        we: times(d.weekend),
    })));
    const validFrom = routes.routes.flatMap((r) => r.directions.map((d) => d.validFrom)).find(Boolean) ?? null;
    return [
        '/**',
        ' * ЗГЕНЕРОВАНО: `npm run zhytomyr:snapshot` у backend/ (zhytomyr-routes.ts → buildZhytomyrOwnData). Руками не редагувати.',
        ' * Маршрути Житомира із zt.rozklad.in.ua (сайт власника): зупинки [назва, хвилин від початку, lat, lng] і',
        ' * відправлення від першої зупинки (wd — робочі дні, we — вихідні). checked — напрямок звірено з Google.',
        ' */',
        'export interface ZtOwnDir {',
        '  id: number;',
        '  no: string;',
        '  name: string;',
        '  checked: boolean;',
        '  stops: Array<[string, number, number | null, number | null]>;',
        '  wd: string[];',
        '  we: string[];',
        '}',
        '',
        'export interface ZtOwnData {',
        '  fetchedAt: string;',
        '  validFrom: string | null;',
        '  dirs: ZtOwnDir[];',
        '}',
        '',
        '// prettier-ignore',
        `export const ZT_OWN: ZtOwnData = ${JSON.stringify({ fetchedAt: routes.fetchedAt, validFrom, dirs })} as unknown as ZtOwnData;`,
        '',
    ].join('\n');
}
