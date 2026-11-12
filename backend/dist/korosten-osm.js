"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAME_STOP_RADIUS_M = exports.KOROSTEN_BBOX = void 0;
exports.osmStopsFromOverpass = osmStopsFromOverpass;
exports.osmRouteFromFull = osmRouteFromFull;
exports.distanceM = distanceM;
exports.matchOsmStops = matchOsmStops;
/**
 * OpenStreetMap як чернетка координат зупинок Коростеня (Docs/korosten-transport-data-2026-11.md).
 * Знімок (data/korosten-transport/osm/*.json) робить скрипт korosten-dataset --fetch-osm; тут — чисті функції:
 * розбір відповідей Overpass / API OSM у знімок і зіставлення точок OSM з зупинками ради (z-0NN).
 * Дані OSM — © учасники OpenStreetMap, ODbL.
 */
const korosten_stop_aliases_1 = require("./korosten-stop-aliases");
/** Межі міста з околицями (Поліське водосховище — 50.906, ст. Житомирська — 28.59) */
exports.KOROSTEN_BBOX = { south: 50.88, west: 28.5, north: 51.02, east: 28.75 };
const round7 = (x) => Math.round(x * 1e7) / 1e7;
function point(e) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    return typeof lat === 'number' && typeof lng === 'number' ? { lat: round7(lat), lng: round7(lng) } : null;
}
/** Відповідь Overpass (out center tags) → зупинки з назвою, впорядковані за id */
function osmStopsFromOverpass(elements) {
    const out = [];
    for (const e of elements) {
        if (e.type === 'relation')
            continue;
        const name = e.tags?.name?.trim();
        const p = point(e);
        if (!name || !p)
            continue;
        out.push({ id: `${e.type}/${e.id}`, name, ...p });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
/** Відповідь API OSM `relation/<id>/full.json` → маршрут з платформами по порядку */
function osmRouteFromFull(elements, relationId) {
    const byKey = new Map(elements.map((e) => [`${e.type}/${e.id}`, e]));
    const rel = byKey.get(`relation/${relationId}`);
    if (!rel)
        throw new Error(`relation ${relationId} is missing in the response`);
    const platforms = [];
    for (const m of rel.members ?? []) {
        if (!m.role.startsWith('platform'))
            continue;
        const e = byKey.get(`${m.type}/${m.ref}`);
        if (!e)
            continue;
        let p = point(e);
        if (!p && e.type === 'way') {
            // платформа-лінія: середня точка її вузлів
            const nodes = e.nodes ?? [];
            const pts = nodes.map((n) => byKey.get(`node/${n}`)).map((n) => (n ? point(n) : null)).filter(Boolean);
            if (pts.length)
                p = { lat: round7(pts.reduce((s, q) => s + q.lat, 0) / pts.length), lng: round7(pts.reduce((s, q) => s + q.lng, 0) / pts.length) };
        }
        if (!p)
            continue;
        platforms.push({ id: `${m.type}/${m.ref}`, name: e.tags?.name?.trim() ?? '', ...p });
    }
    const t = rel.tags ?? {};
    return { id: `relation/${relationId}`, ref: t.ref ?? '', from: t.from ?? '', to: t.to ?? '', platforms };
}
/** Відстань у метрах (рівнокутна апроксимація — для міста досить) */
function distanceM(a, b) {
    const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    return Math.hypot((a.lat - b.lat) * 111195, (a.lng - b.lng) * 111195 * k);
}
/** Точки однієї зупинки по різні боки дороги — у межах цього радіуса */
exports.SAME_STOP_RADIUS_M = 200;
/**
 * Зупинки ради (uid) → координати OSM за назвою. `names` — усі відомі назви зупинки (офіційна, з проєкту, з розкладу);
 * `hints` — ручні: id точки OSM → uid (або null — точку не брати). Точка, назва якої дає кілька uid, без підказки
 * не береться. Кілька точок однієї зупинки → найбільша група в радіусі SAME_STOP_RADIUS_M, середня точка.
 */
function matchOsmStops(osm, names, hints = {}) {
    const byKey = new Map();
    for (const [uid, list] of names) {
        for (const n of list) {
            for (const k of (0, korosten_stop_aliases_1.stopNameKeys)(n)) {
                if (!byKey.has(k))
                    byKey.set(k, new Set());
                byKey.get(k)?.add(uid);
            }
        }
    }
    const points = new Map();
    const ambiguous = [];
    for (const s of osm) {
        let uid = null;
        if (s.id in hints)
            uid = hints[s.id];
        else {
            const c = new Set();
            for (const k of (0, korosten_stop_aliases_1.stopNameKeys)(s.name))
                for (const u of byKey.get(k) ?? [])
                    c.add(u);
            if (c.size === 1)
                uid = [...c][0];
            else if (c.size > 1)
                ambiguous.push({ osmId: s.id, name: s.name, uids: [...c].sort() });
        }
        if (!uid)
            continue;
        if (!points.has(uid))
            points.set(uid, []);
        points.get(uid)?.push(s);
    }
    const matches = new Map();
    for (const [uid, list] of points) {
        let best = [];
        for (const p of list) {
            const group = list.filter((q) => distanceM(p, q) <= exports.SAME_STOP_RADIUS_M);
            if (group.length > best.length)
                best = group;
        }
        best.sort((a, b) => a.id.localeCompare(b.id));
        const lat = round7(best.reduce((s, q) => s + q.lat, 0) / best.length);
        const lng = round7(best.reduce((s, q) => s + q.lng, 0) / best.length);
        const inBest = new Set(best.map((q) => q.id));
        matches.set(uid, { lat, lng, osmIds: [...inBest], outliers: list.filter((q) => !inBest.has(q.id)).map((q) => q.id).sort() });
    }
    return { matches, ambiguous: ambiguous.sort((a, b) => a.osmId.localeCompare(b.osmId)) };
}
