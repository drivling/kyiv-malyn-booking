"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STOP_REDIRECTS_META_KEY = void 0;
exports.parseStopRedirects = parseStopRedirects;
exports.stopRedirectsOf = stopRedirectsOf;
exports.lookupStop = lookupStop;
exports.STOP_REDIRECTS_META_KEY = 'stopRedirects';
const STOP_ID_RE = /^st_\d{1,8}$/;
/** Ланцюжок a→b→c стискається до a→c; довше за це — вважаємо циклом */
const MAX_CHAIN = 8;
/**
 * Розібрати `meta.stopRedirects`. Повертає лише коректні пари (старий id → чинна зупинка) і список проблем:
 * ключ не схожий на id, ключ — жива зупинка, ціль не рядок, ціль невідома, самопосилання або цикл.
 * Ланцюжки (старий → інший старий → чинний) стискаються до кінцевої чинної зупинки.
 */
function parseStopRedirects(raw, stopIds) {
    const live = new Set(stopIds);
    const problems = [];
    const redirects = {};
    if (raw === undefined || raw === null)
        return { redirects, problems };
    if (typeof raw !== 'object' || Array.isArray(raw))
        return { redirects, problems: ['stopRedirects must be an object { oldId: newId }'] };
    const entries = raw;
    const resolve = (start) => {
        let current = entries[start];
        const seen = new Set([start]);
        for (let i = 0; i < MAX_CHAIN; i++) {
            if (typeof current !== 'string')
                return null;
            const next = current.trim();
            if (live.has(next))
                return next;
            if (seen.has(next) || !(next in entries))
                return null;
            seen.add(next);
            current = entries[next];
        }
        return null;
    };
    for (const [key, value] of Object.entries(entries)) {
        if (!STOP_ID_RE.test(key)) {
            problems.push(`${key}: not a stop id (st_NNNN)`);
            continue;
        }
        if (live.has(key)) {
            problems.push(`${key}: is a live stop, cannot redirect it`);
            continue;
        }
        if (typeof value !== 'string' || !value.trim()) {
            problems.push(`${key}: target must be a stop id`);
            continue;
        }
        const target = resolve(key);
        if (!target) {
            problems.push(`${key}: target ${String(value).trim()} is not a live stop (unknown, self or a cycle)`);
            continue;
        }
        redirects[key] = target;
    }
    return { redirects, problems };
}
function stopRedirectsOf(dataset) {
    return parseStopRedirects(dataset.meta?.[exports.STOP_REDIRECTS_META_KEY], dataset.stops.map((s) => s.id)).redirects;
}
const compareRouteId = (a, b) => Number(a) - Number(b) || a.localeCompare(b);
/** Зупинка за id: чинна → її опис; старий id із stopRedirects → куди; інакше unknown. */
function lookupStop(dataset, id) {
    const stop = dataset.stops.find((s) => s.id === id);
    if (!stop) {
        const to = stopRedirectsOf(dataset)[id];
        return to ? { kind: 'redirect', to } : { kind: 'unknown' };
    }
    const hidden = new Set(dataset.routes.filter((r) => r.unreliable).map((r) => r.id));
    const routeIds = new Set();
    for (const rs of dataset.routeStops) {
        if (rs.stopId !== id || rs.mapOnly || hidden.has(rs.routeId))
            continue;
        if ((rs.orderThere ?? -1) > 0 || (rs.orderBack ?? -1) > 0)
            routeIds.add(rs.routeId);
    }
    for (const route of dataset.routes) {
        if (hidden.has(route.id))
            continue;
        for (const variant of route.variants ?? []) {
            if (variant.stops.some((s) => s.stopId === id && !s.mapOnly))
                routeIds.add(route.id);
        }
    }
    return {
        kind: 'stop',
        stop: { id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng, routeIds: [...routeIds].sort(compareRouteId) },
    };
}
