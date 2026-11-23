"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kyivHour = exports.MIN_SAMPLES = void 0;
exports.buildKptGpsReport = buildKptGpsReport;
const kyiv_kpt_data_1 = require("./kyiv-kpt-data");
exports.MIN_SAMPLES = 5;
const KYIV_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' });
const kyivHour = (d) => Number(KYIV_HOUR.format(d));
exports.kyivHour = kyivHour;
function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Наші хвилини між сусідніми точками i → i+1 о цій годині (найближча година, що є в розкладі) */
function ourSpan(dir, i, hour) {
    const hours = Object.keys(dir.run).map(Number);
    if (!hours.length)
        return null;
    const h = hours.reduce((a, b) => (Math.abs(b - hour) < Math.abs(a - hour) ? b : a));
    const run = dir.run[String(h)];
    return run[i + 1] != null && run[i] != null ? run[i + 1] - run[i] : null;
}
const round1 = (x) => Math.round(x * 10) / 10;
function buildKptGpsReport(passes, data = kyiv_kpt_data_1.KYIV_KPT) {
    const dirsByRoute = new Map();
    for (const d of data.dirs) {
        if (!d.id.endsWith('/0'))
            continue;
        const r = d.id.split('/')[0];
        dirsByRoute.set(r, [...(dirsByRoute.get(r) ?? []), d]);
    }
    const sorted = [...passes].sort((a, b) => (a.vehicleId === b.vehicleId ? a.firstAt.getTime() - b.firstAt.getTime() : a.vehicleId < b.vehicleId ? -1 : 1));
    const samples = new Map();
    for (let k = 0; k + 1 < sorted.length; k++) {
        const a = sorted[k];
        const b = sorted[k + 1];
        if (a.vehicleId !== b.vehicleId || a.routeId !== b.routeId || a.point === b.point)
            continue;
        const minutes = (b.firstAt.getTime() - a.lastAt.getTime()) / 60000;
        if (!(minutes > 0))
            continue;
        const hour = (0, exports.kyivHour)(a.lastAt);
        for (const dir of dirsByRoute.get(a.routeId) ?? []) {
            const i = dir.points.findIndex((p, j) => p[0] === a.point && dir.points[j + 1]?.[0] === b.point);
            if (i < 0)
                continue;
            const ours = ourSpan(dir, i, hour);
            // правдоподібно: не втричі швидше й не набагато довше за розклад (інакше — обідня перерва, депо, обрив стрічки)
            if (ours == null || ours <= 0 || minutes < ours * 0.3 || minutes > ours * 3 + 10)
                continue;
            const key = `${dir.id}|${i}`;
            const s = samples.get(key) ?? { gps: [], ours: [] };
            s.gps.push(minutes);
            s.ours.push(ours);
            samples.set(key, s);
        }
    }
    const routes = new Map();
    let measured = 0;
    let differs = 0;
    for (const [key, s] of samples) {
        if (s.gps.length < exports.MIN_SAMPLES)
            continue;
        const [dirId, iRaw] = key.split('|');
        const dir = data.dirs.find((d) => d.id === dirId);
        const i = Number(iRaw);
        const gpsMin = round1(median(s.gps));
        const ourMin = round1(median(s.ours));
        const diff = Math.abs(gpsMin - ourMin);
        const span = { dirId, from: dir.points[i][0], to: dir.points[i + 1][0], samples: s.gps.length, gpsMin, ourMin, differs: diff > 2 && diff > ourMin * 0.2 };
        measured++;
        if (span.differs)
            differs++;
        const routeId = dirId.split('/')[0];
        const route = routes.get(routeId) ?? { routeId, mode: dir.mode, no: dir.no, name: dir.name, spans: [] };
        route.spans.push(span);
        routes.set(routeId, route);
    }
    const list = [...routes.values()];
    for (const r of list)
        r.spans.sort((a, b) => Math.abs(b.gpsMin - b.ourMin) - Math.abs(a.gpsMin - a.ourMin));
    list.sort((a, b) => b.spans.filter((s) => s.differs).length - a.spans.filter((s) => s.differs).length || a.no.localeCompare(b.no, 'uk', { numeric: true }));
    return { passes: passes.length, vehicles: new Set(passes.map((p) => p.vehicleId)).size, measured, differs, routes: list };
}
