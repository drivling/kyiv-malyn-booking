"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSE_AFTER_MS = exports.NEAR_POINT_M = void 0;
exports.routePoints = routePoints;
exports.nearestPoint = nearestPoint;
exports.createVisitTracker = createVisitTracker;
/**
 * «Доведе» · онлайн-рух «Київпастрансу» → проходи контрольних точок (Docs/dovede-learning-roadmap.md, крок 8г).
 *
 * Сирі точки Києва (сотні машин щохвилини) у базу не пишемо: лише **візит** машини біля контрольної точки свого
 * маршруту (≤ 150 м) — коли прийшла (`firstAt`) і коли востаннє була поруч (`lastAt`). Візит закривається, коли
 * машину побачили деінде або не бачили `CLOSE_AFTER_MS`; закриті візити й пишемо. Час у дорозі A → B = прихід до B
 * мінус останній раз біля A. Держномерів тут немає. Чисті функції + невеликий стан у памʼяті процесу.
 */
const korosten_osm_1 = require("../korosten-osm");
const kyiv_kpt_data_1 = require("./kyiv-kpt-data");
/** Ближче за стільки — машина «біля точки» */
exports.NEAR_POINT_M = 150;
/** Не бачили машину біля точки стільки — візит закрито */
exports.CLOSE_AFTER_MS = 10 * 60000;
/** Точка старша — машина стоїть вимкнена чи стрічка віддає старе, не беремо */
const STALE_MS = 15 * 60000;
/** Контрольні точки кожного маршруту (route_id → унікальні за назвою точки всіх його напрямків) */
function routePoints(data = kyiv_kpt_data_1.KYIV_KPT) {
    const out = new Map();
    for (const d of data.dirs) {
        const routeId = d.id.split('/')[0];
        const list = out.get(routeId) ?? [];
        for (const [name, lat, lng] of d.points)
            if (!list.some((p) => p.name === name))
                list.push({ name, lat, lng });
        out.set(routeId, list);
    }
    return out;
}
/** Найближча контрольна точка маршруту в межах `NEAR_POINT_M`; null — машина між точками */
function nearestPoint(points, v) {
    let best = null;
    for (const p of points ?? []) {
        const m = (0, korosten_osm_1.distanceM)(p, v);
        if (m <= exports.NEAR_POINT_M && (!best || m < best.m))
            best = { p, m };
    }
    return best?.p ?? null;
}
/**
 * Відкриті візити по машинах. `feed` — одна стрічка; повертає візити, що закрилися (машина пішла від точки, змінила
 * маршрут або давно не з'являлась). `flush` закриває все (при зупинці процесу).
 */
function createVisitTracker(points = routePoints()) {
    const open = new Map();
    return {
        feed(vehicles, now) {
            const closed = [];
            const seen = new Set();
            for (const v of vehicles) {
                if (now.getTime() - v.at.getTime() > STALE_MS || v.at.getTime() - now.getTime() > 5 * 60000)
                    continue;
                seen.add(v.vehicleId);
                const cur = open.get(v.vehicleId);
                const near = nearestPoint(points.get(v.routeId), v);
                if (cur && near && cur.routeId === v.routeId && cur.point === near.name) {
                    if (v.at > cur.lastAt)
                        cur.lastAt = v.at;
                    continue;
                }
                if (cur) {
                    closed.push(cur);
                    open.delete(v.vehicleId);
                }
                if (near)
                    open.set(v.vehicleId, { routeId: v.routeId, vehicleId: v.vehicleId, point: near.name, firstAt: v.at, lastAt: v.at });
            }
            for (const [id, visit] of open) {
                if (!seen.has(id) && now.getTime() - visit.lastAt.getTime() > exports.CLOSE_AFTER_MS) {
                    closed.push(visit);
                    open.delete(id);
                }
            }
            return closed;
        },
        flush() {
            const all = [...open.values()];
            open.clear();
            return all;
        },
        openCount: () => open.size,
    };
}
