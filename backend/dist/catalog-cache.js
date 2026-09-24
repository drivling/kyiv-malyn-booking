"use strict";
/**
 * Кеш каталогів у процесі: TripPoint і TripRoute з упорядкованими зупинками.
 *
 * Це десятки рядків, які змінює лише адмінка, а гарячі шляхи (пошук попуток, мерж,
 * розклад, матчинг) перечитували їх з БД на кожен запит — по ~100 мс за round-trip
 * (Docs/poputky-search-performance-plan.md, D3 і Фаза 2.2).
 *
 * - Кеш прив'язаний до інстансу Prisma (WeakMap), тож тестові стаби не ділять стан.
 * - TTL 60 с + `invalidateCatalogCache()` з адмін-роутів після запису.
 * - У vitest TTL = 0: кожен get() перечитує зі стабу (поведінка тестів не змінюється),
 *   але паралельні виклики все одно ділять один inflight-запит.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCatalogPoints = getCatalogPoints;
exports.getCatalogRoutes = getCatalogRoutes;
exports.buildCatalogSnapshot = buildCatalogSnapshot;
exports.getCatalog = getCatalog;
exports.invalidateCatalogCache = invalidateCatalogCache;
const TTL_MS = process.env.VITEST ? 0 : 60000;
function createLoader(load, ttlMs) {
    let value = null;
    let loadedAt = 0;
    let inflight = null;
    return {
        get() {
            if (value !== null && ttlMs > 0 && Date.now() - loadedAt < ttlMs)
                return Promise.resolve(value);
            if (!inflight) {
                inflight = load()
                    .then((v) => {
                    value = v;
                    loadedAt = Date.now();
                    inflight = null;
                    return v;
                })
                    .catch((e) => {
                    inflight = null;
                    throw e;
                });
            }
            return inflight;
        },
        invalidate() {
            value = null;
            loadedAt = 0;
        },
    };
}
const caches = new WeakMap();
// Усі відомі інстанси — для invalidateCatalogCache() без аргументу (тести, адмінка). Їх одиниці.
const known = new Set();
function entryFor(prisma) {
    let entry = caches.get(prisma);
    if (!entry) {
        entry = {
            points: createLoader(async () => {
                const findMany = prisma.tripPoint?.findMany;
                if (!findMany)
                    return [];
                return findMany.call(prisma.tripPoint, { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
            }, TTL_MS),
            routes: createLoader(async () => {
                const findMany = prisma.tripRoute?.findMany;
                if (!findMany)
                    return [];
                const rows = await findMany.call(prisma.tripRoute, {
                    select: {
                        id: true,
                        slug: true,
                        corridorTripRouteId: true,
                        stops: { select: { pointId: true, position: true }, orderBy: { position: 'asc' } },
                    },
                    orderBy: [{ slug: 'asc' }],
                });
                return rows.map((r) => ({
                    id: r.id,
                    slug: r.slug,
                    corridorTripRouteId: r.corridorTripRouteId ?? null,
                    stops: Array.isArray(r.stops) ? r.stops : [],
                }));
            }, TTL_MS),
        };
        caches.set(prisma, entry);
        known.add(prisma);
    }
    return entry;
}
/** Усі TripPoint (для пошуку по коду/id). */
function getCatalogPoints(prisma) {
    return entryFor(prisma).points.get();
}
/** Усі TripRoute зі зупинками. */
function getCatalogRoutes(prisma) {
    return entryFor(prisma).routes.get();
}
const snapshots = new WeakMap();
function buildCatalogSnapshot(points, routes) {
    const pointById = new Map(points.map((p) => [p.id, p]));
    const byCode = new Map(points.map((p) => [p.code.trim().toLowerCase(), p]));
    const itineraryByRouteId = new Map();
    const corridorIdByRouteId = new Map();
    for (const r of routes) {
        const ordered = [...r.stops]
            .sort((a, b) => a.position - b.position || a.pointId - b.pointId)
            .map((s) => s.pointId);
        itineraryByRouteId.set(r.id, ordered);
        corridorIdByRouteId.set(r.id, r.corridorTripRouteId ?? r.id);
    }
    return {
        points,
        routes,
        pointById,
        itineraryByRouteId,
        corridorIdByRouteId,
        pointByCode: (code) => byCode.get(code.trim().toLowerCase()),
        routeIdsAlong: (fromPointId, toPointId) => {
            if (fromPointId === toPointId)
                return [];
            const out = [];
            for (const [id, ids] of itineraryByRouteId) {
                const fi = ids.indexOf(fromPointId);
                const ti = ids.indexOf(toPointId);
                if (fi >= 0 && ti >= 0 && fi < ti)
                    out.push(id);
            }
            return out;
        },
    };
}
/** Точки + маршрути + похідні мапи; знімок мемоізується на ті самі масиви з кешу. */
async function getCatalog(prisma) {
    const [points, routes] = await Promise.all([getCatalogPoints(prisma), getCatalogRoutes(prisma)]);
    let byPoints = snapshots.get(routes);
    if (!byPoints) {
        byPoints = new WeakMap();
        snapshots.set(routes, byPoints);
    }
    let snap = byPoints.get(points);
    if (!snap) {
        snap = buildCatalogSnapshot(points, routes);
        byPoints.set(points, snap);
    }
    return snap;
}
/** Після запису в TripPoint/TripRoute/TripRouteStop: один інстанс або всі відомі. */
function invalidateCatalogCache(prisma) {
    if (prisma) {
        const entry = caches.get(prisma);
        entry?.points.invalidate();
        entry?.routes.invalidate();
        return;
    }
    for (const target of known) {
        const entry = caches.get(target);
        entry?.points.invalidate();
        entry?.routes.invalidate();
    }
}
