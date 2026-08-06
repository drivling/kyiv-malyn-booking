"use strict";
/**
 * OSRM-перерахунок тривалостей перегонів (TransportSegment) для міського транспорту.
 * Використовується CLI і POST /admin/transport/recalculate-segments.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERIFIED_ROUTE_IDS = void 0;
exports.recalculateSegmentDurations = recalculateSegmentDurations;
const local_transport_1 = require("./local-transport");
exports.VERIFIED_ROUTE_IDS = ['2', '3', '5', '7', '8', '9', '11', '12'];
const DEFAULT_SEC = 120;
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const DELAY_MS = 300;
const STOP_TIME_SEC = 12;
const SPEED_KMH_URBAN = 35;
const SPEED_KMH_FAST = 45;
const SEGMENT_LONG_M = 600;
const CORRELATION_SPEED_KMH = 24;
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function orderedStopIds(routeStops, direction) {
    const key = direction === 'there' ? 'orderThere' : 'orderBack';
    return routeStops
        .filter((s) => (s[key] ?? -1) > 0)
        .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1))
        .map((s) => s.stopId);
}
function segmentTimeSecFromDistanceM(distanceM, withStopPause) {
    const speedKmh = distanceM >= SEGMENT_LONG_M ? SPEED_KMH_FAST : SPEED_KMH_URBAN;
    const driveSec = (distanceM / 1000 / speedKmh) * 3600;
    const stopSec = withStopPause ? STOP_TIME_SEC : 0;
    return Math.round(stopSec + driveSec);
}
async function fetchOsrmRoute(lon1, lat1, lon2, lat2) {
    const coords = `${lon1},${lat1};${lon2},${lat2}`;
    const url = `${OSRM_BASE}/${coords}?overview=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok)
            return { distance: null };
        const data = (await res.json());
        if (data.code !== 'Ok' || !data.routes?.[0])
            return { distance: null };
        return { distance: data.routes[0].distance };
    }
    catch {
        clearTimeout(timeout);
        return { distance: null };
    }
}
async function recalculateSegmentDurations(prisma, options = {}) {
    const dataset = await (0, local_transport_1.loadTransportDataset)(prisma);
    if (dataset.stops.length === 0) {
        throw new Error('Transport dataset is empty');
    }
    const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
    const routeStopsByRoute = new Map();
    for (const rs of dataset.routeStops) {
        if (!routeStopsByRoute.has(rs.routeId))
            routeStopsByRoute.set(rs.routeId, []);
        routeStopsByRoute.get(rs.routeId).push(rs);
    }
    const routesInDb = dataset.routes.map((r) => r.id);
    const routeFilter = options.routeId?.trim() || null;
    let routesToProcess;
    if (routeFilter) {
        if (!routesInDb.includes(routeFilter)) {
            throw new Error(`Маршрут ${routeFilter} відсутній у БД. Є: ${routesInDb.join(', ')}`);
        }
        routesToProcess = [routeFilter];
    }
    else {
        routesToProcess = exports.VERIFIED_ROUTE_IDS.filter((id) => routesInDb.includes(id));
    }
    if (routesToProcess.length === 0) {
        throw new Error(`Немає маршрутів для обробки. Перевірені: ${exports.VERIFIED_ROUTE_IDS.join(', ')}`);
    }
    const newSegments = new Map();
    const segmentDistancesM = {};
    const corrections = [];
    let osrmRequested = 0;
    let osrmFailed = 0;
    for (const routeId of routesToProcess) {
        const routeStops = routeStopsByRoute.get(routeId) || [];
        for (const dir of ['there', 'back']) {
            const ids = orderedStopIds(routeStops, dir);
            for (let i = 0; i < ids.length - 1; i++) {
                const a = ids[i];
                const b = ids[i + 1];
                const key = `${routeId}|${a}|${b}`;
                const ca = stopById.get(a);
                const cb = stopById.get(b);
                const fromStop = routeStops.find((s) => s.stopId === a);
                const isTechnicalStop = fromStop?.mapOnly === true;
                if (!ca || !cb) {
                    newSegments.set(key, isTechnicalStop ? Math.max(30, DEFAULT_SEC - STOP_TIME_SEC) : DEFAULT_SEC);
                    continue;
                }
                osrmRequested++;
                const { distance: distM } = await fetchOsrmRoute(ca.lng, ca.lat, cb.lng, cb.lat);
                await sleep(DELAY_MS);
                if (distM != null && distM > 0) {
                    segmentDistancesM[key] = distM;
                    newSegments.set(key, Math.max(30, segmentTimeSecFromDistanceM(distM, !isTechnicalStop)));
                }
                else {
                    newSegments.set(key, isTechnicalStop ? Math.max(30, DEFAULT_SEC - STOP_TIME_SEC) : DEFAULT_SEC);
                    osrmFailed++;
                }
            }
        }
    }
    for (const routeId of routesToProcess) {
        const routeStops = routeStopsByRoute.get(routeId) || [];
        for (const dir of ['there', 'back']) {
            const ids = orderedStopIds(routeStops, dir);
            const keys = [];
            for (let i = 0; i < ids.length - 1; i++)
                keys.push(`${routeId}|${ids[i]}|${ids[i + 1]}`);
            let totalDistM = 0;
            let totalTimeSec = 0;
            for (const k of keys) {
                if (segmentDistancesM[k] != null)
                    totalDistM += segmentDistancesM[k];
                totalTimeSec += newSegments.get(k) || 0;
            }
            if (totalDistM <= 0 || totalTimeSec <= 0)
                continue;
            const timeAt24Sec = (totalDistM / 1000 / CORRELATION_SPEED_KMH) * 3600;
            if (timeAt24Sec > totalTimeSec) {
                const factor = timeAt24Sec / totalTimeSec;
                for (const k of keys) {
                    const v = newSegments.get(k);
                    if (v != null)
                        newSegments.set(k, Math.max(30, Math.round(v * factor)));
                }
                corrections.push(`${routeId} ${dir}: ${CORRELATION_SPEED_KMH} км/год ${Math.round(timeAt24Sec)} с > ${totalTimeSec} с → ×${factor.toFixed(3)}`);
            }
        }
    }
    const segmentsKept = dataset.segments.filter((s) => !routesToProcess.includes(s.routeId)).length;
    const created = [...newSegments.entries()].map(([key, seconds]) => {
        const [routeId, fromStopId, toStopId] = key.split('|');
        return { routeId, fromStopId, toStopId, seconds };
    });
    const defaultSec = Number(dataset.meta.defaultSec) || DEFAULT_SEC;
    const metaPayload = { ...dataset.meta, defaultSec };
    await prisma.$transaction([
        prisma.transportSegment.deleteMany({ where: { routeId: { in: routesToProcess } } }),
        prisma.transportSegment.createMany({ data: created }),
        prisma.transportMeta.upsert({
            where: { id: 1 },
            create: { id: 1, payload: metaPayload },
            update: { payload: metaPayload },
        }),
    ]);
    return {
        routes: routesToProcess,
        segmentsWritten: created.length,
        segmentsKept,
        osrmRequested,
        osrmFailed,
        corrections,
    };
}
