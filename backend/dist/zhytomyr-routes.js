"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadZhytomyrRoutes = loadZhytomyrRoutes;
exports.buildZhytomyrRoutes = buildZhytomyrRoutes;
exports.buildZhytomyrStops = buildZhytomyrStops;
exports.buildZhytomyrReport = buildZhytomyrReport;
exports.zhytomyrTimedDirections = zhytomyrTimedDirections;
exports.ztStopSide = ztStopSide;
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
 * Хвилини між зупинками — за Google там, де він їх знає (рішення власника 2026-11-17: розклад сайту давній,
 * «Google точно знає краще»). Відрізок із справді іншими хвилинами розтягуємо чи стискаємо до часу Google,
 * решту ланцюжка зсуваємо. Напрямок «звірено», коли всі три великі відрізки збіглись або виправлені.
 */
function zhytomyrTimedDirections(root) {
    const routes = loadZhytomyrRoutes(root);
    const stops = JSON.parse(buildZhytomyrStops(root)).stops;
    const verdicts = readJson(node_path_1.default.join(root, 'google/checks.json'), { checks: {} }).checks;
    const thirds = (0, zhytomyr_google_check_1.checkSpans)(routes, stops).filter((sp) => sp.level === 'thirds');
    const dirs = routes.routes.flatMap((r) => r.directions.map((d) => {
        const minutes = d.stops.map((x) => x.minutes);
        const mine = thirds.filter((sp) => sp.dirId === d.dirId);
        let checked = mine.length > 0;
        for (const sp of mine) {
            const v = verdicts[sp.key];
            if (v?.verdict === 'match')
                continue;
            if (v?.verdict !== 'differs' || v.cause !== 'minutes' || !v.google) {
                checked = false;
                continue;
            }
            const i0 = d.stops.findIndex((x) => x.id === sp.from.id);
            const i1 = d.stops.findIndex((x) => x.id === sp.to.id);
            const a = v.compared ? d.stops.findIndex((x, i) => i >= i0 && i <= i1 && (0, zhytomyr_stops_1.sameStopName)(x.name, v.compared.from)) : i0;
            const b = v.compared ? d.stops.findIndex((x, i) => i > a && i <= i1 && (0, zhytomyr_stops_1.sameStopName)(x.name, v.compared.to)) : i1;
            const span = a >= 0 && b > a ? minutes[b] - minutes[a] : 0;
            if (span <= 0) {
                checked = false;
                continue;
            }
            const k = v.google.minutes / span;
            const shift = v.google.minutes - span;
            const base = minutes[a];
            for (let i = a + 1; i < minutes.length; i++)
                minutes[i] = i <= b ? base + (minutes[i] - base) * k : minutes[i] + shift;
        }
        // цілі хвилини, що не йдуть назад
        const whole = minutes.map((m) => Math.round(m));
        for (let i = 1; i < whole.length; i++)
            whole[i] = Math.max(whole[i], whole[i - 1]);
        return { route: r, dir: d, minutes: whole, checked };
    }));
    return { routes, stops, dirs };
}
/** Назва зупинки без номера боку дороги: «Панчішна фабрика 01» → «Панчішна фабрика» */
function ztStopSide(name) {
    return name.replace(/\s+\[?0\d{1,2}\]?\s*$/, '').trim();
}
/**
 * backend/src/dovede/zhytomyr-own-data.ts — те, з чого сервер «Доведе» складає пряму поїздку Житомиром без Google:
 * зупинки з хвилинами (виправленими за Google) й координатами та відправлення від першої зупинки. Каталогу `data/`
 * на сервері немає, тому дані їдуть модулем. `checked` — три великі відрізки напрямку збіглися з Google або
 * виправлені за ним (REPORT.md); лише такі напрямки йдуть у відповідь людині. Рейси «у депо» сюди не потрапляють: вони не йдуть до кінцевої.
 */
function buildZhytomyrOwnData(root) {
    const { routes, stops, dirs: timed } = zhytomyrTimedDirections(root);
    const byId = new Map(stops.map((s) => [s.id, s]));
    const times = (list) => list.filter((d) => !d.note?.includes('depot')).map((d) => d.time);
    const dirs = timed.map(({ route: r, dir: d, minutes: whole, checked }) => ({
        id: d.dirId,
        no: r.number,
        name: d.name,
        checked,
        stops: d.stops.map((x, i) => {
            const at = byId.get(x.id);
            // приблизна координата (між сусідами) для пошуку «поруч» не годиться
            return at && at.source !== 'interpolated' ? [ztStopSide(x.name), whole[i], at.lat, at.lng] : [ztStopSide(x.name), whole[i], null, null];
        }),
        wd: times(d.workdays),
        we: times(d.weekend),
    }));
    const validFrom = routes.routes.flatMap((r) => r.directions.map((d) => d.validFrom)).find(Boolean) ?? null;
    return [
        '/**',
        ' * ЗГЕНЕРОВАНО: `npm run zhytomyr:snapshot` у backend/ (zhytomyr-routes.ts → buildZhytomyrOwnData). Руками не редагувати.',
        ' * Маршрути Житомира із zt.rozklad.in.ua (сайт власника): зупинки [назва, хвилин від початку, lat, lng] і',
        ' * відправлення від першої зупинки (wd — робочі дні, we — вихідні). Хвилини виправлено за Google; checked —',
        ' * напрямок звірено.',
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
