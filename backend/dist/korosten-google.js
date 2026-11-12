"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUT_M = exports.OFF_ROUTE_M = void 0;
exports.datasetChains = datasetChains;
exports.hopTriples = hopTriples;
exports.decodePolyline = decodePolyline;
exports.pointToPolylineM = pointToPolylineM;
exports.segmentDeviationM = segmentDeviationM;
exports.normalizeLine = normalizeLine;
exports.hopVerdict = hopVerdict;
/**
 * Перевірка прогонів чернетки Коростеня через Google Routes API (TRANSIT) — Docs/korosten-transport-data-2026-11.md.
 * Чисті функції: трійки сусідніх зупинок кожного ланцюжка, розбір лінії шляху Google (encoded polyline), відстані наших
 * точок до траси й висновок по трійці. Мережу кличе скрипт korosten-dataset (--google-hops); у репозиторій іде лише
 * висновок без координат Google (google/hops.json), повна відповідь — лише локально (google/hops.local.json).
 */
const korosten_osm_1 = require("./korosten-osm");
/** Усі ланцюжки датасету: по два основні напрямки на маршрут і варіанти шляху (лише пасажирські зупинки) */
function datasetChains(dataset) {
    const out = [];
    for (const r of dataset.routes) {
        const routeNo = r.shortName || r.id;
        for (const [key, directionId] of [['orderThere', '1'], ['orderBack', '0']]) {
            const stopIds = dataset.routeStops
                .filter((x) => x.routeId === r.id && x[key] > 0 && !x.mapOnly)
                .sort((x, y) => x[key] - y[key])
                .map((x) => x.stopId);
            if (stopIds.length >= 2)
                out.push({ routeId: r.id, routeNo, directionId, variantId: null, stopIds });
        }
        for (const v of r.variants ?? []) {
            const stopIds = v.stops.filter((s) => !s.mapOnly).map((s) => s.stopId);
            if (stopIds.length >= 2)
                out.push({ routeId: r.id, routeNo, directionId: v.directionId, variantId: v.id, stopIds });
        }
    }
    return out;
}
/** Трійки сусідніх зупинок усіх ланцюжків; спільна для кількох маршрутів трійка — одна, з усіма маршрутами */
function hopTriples(chains) {
    const byKey = new Map();
    const add = (a, b, c, ch) => {
        const key = b ? `${a}>${b}>${c}` : `${a}>${c}`;
        const t = byKey.get(key) ?? { key, a, b, c, routes: [] };
        if (!t.routes.some((r) => r.routeId === ch.routeId && r.variantId === ch.variantId)) {
            t.routes.push({ routeId: ch.routeId, routeNo: ch.routeNo, variantId: ch.variantId });
        }
        byKey.set(key, t);
    };
    for (const ch of chains) {
        if (ch.stopIds.length === 2)
            add(ch.stopIds[0], null, ch.stopIds[1], ch);
        for (let i = 0; i + 2 < ch.stopIds.length; i++)
            add(ch.stopIds[i], ch.stopIds[i + 1], ch.stopIds[i + 2], ch);
    }
    return [...byKey.values()];
}
/** Google encoded polyline → точки */
function decodePolyline(encoded) {
    const out = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
        let shift = 0;
        let result = 0;
        let byte;
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
function pointToSegmentM(p, a, b) {
    const k = Math.cos((p.lat * Math.PI) / 180) * 111195;
    const ax = (a.lng - p.lng) * k;
    const ay = (a.lat - p.lat) * 111195;
    const bx = (b.lng - p.lng) * k;
    const by = (b.lat - p.lat) * 111195;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
}
/** Відстань від точки до лінії (метри) */
function pointToPolylineM(p, line) {
    if (!line.length)
        return Infinity;
    if (line.length === 1)
        return (0, korosten_osm_1.distanceM)(p, line[0]);
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++)
        best = Math.min(best, pointToSegmentM(p, line[i], line[i + 1]));
    return best;
}
/** Наскільки пряма A→B відходить від траси: найбільша відстань точок прямої (крок ~25 м) до лінії */
function segmentDeviationM(a, b, line) {
    const n = Math.max(2, Math.ceil((0, korosten_osm_1.distanceM)(a, b) / 25));
    let worst = 0;
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        worst = Math.max(worst, pointToPolylineM({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, line));
    }
    return worst;
}
/** «2-Б», «2Б», «2б» → «2Б»: номер лінії Google проти нашого */
function normalizeLine(no) {
    return no.replace(/[\s-]/g, '').toUpperCase();
}
/** Точка зупинки далі цього від траси Google — не на трасі або не та зупинка */
exports.OFF_ROUTE_M = 80;
/** Пряма між зупинками відходить від траси більше — тут поворот, на карті потрібні технічні точки */
exports.CUT_M = 150;
function hopVerdict(triple, ours, steps) {
    const ourNos = new Set(triple.routes.map((r) => normalizeLine(r.routeNo)));
    const firstSteps = steps.map((alt) => alt[0]).filter(Boolean);
    const googleLines = [...new Set(firstSteps.map((s) => s.line))].sort();
    const mine = steps.map((alt) => (alt.length === 1 ? alt[0] : null)).find((s) => s && ourNos.has(normalizeLine(s.line))) ?? null;
    const expected = triple.b ? 2 : 1;
    const r = (x) => Math.round(x);
    const base = {
        key: triple.key,
        expected,
        routes: triple.routes.map((x) => (x.variantId ? `${x.routeNo} (${x.variantId})` : x.routeNo)),
        googleLines,
        ours: [ours.a, ...(ours.b ? [ours.b] : []), ours.c].map((p) => [p.lat, p.lng]),
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
    const off = [aOffM, bOffM, cOffM].some((x) => x !== null && x > exports.OFF_ROUTE_M);
    const status = mine.stopCount !== null && mine.stopCount !== expected ? 'stop-count' : off ? 'off-route' : cutM !== null && cutM > exports.CUT_M ? 'cut' : 'ok';
    return { ...base, ourLine: true, stopCount: mine.stopCount, aOffM, bOffM, cOffM, cutM, status };
}
