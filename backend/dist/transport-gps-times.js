"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIDENCE_FEW = exports.CONFIDENCE_OK = exports.TERMINAL_M = exports.STANDING_KMH = exports.PASS_MAX_KMH = exports.PASS_MIN_KMH = exports.PASS_MIN_M = exports.PASS_MAX_SEC = exports.PASS_MIN_SEC = exports.GPS_OFF_LINE_M = void 0;
exports.normalizeRouteNo = normalizeRouteNo;
exports.buildChainLine = buildChainLine;
exports.projectOnChain = projectOnChain;
exports.findPasses = findPasses;
exports.weightedMedian = weightedMedian;
exports.buildRunTimes = buildRunTimes;
/** точка далі від лінії — не на цьому маршруті */
exports.GPS_OFF_LINE_M = 60;
/** проміжок між точками одного проїзду, с */
exports.PASS_MIN_SEC = 60;
exports.PASS_MAX_SEC = 600;
/** коротший проїзд — шум GPS */
exports.PASS_MIN_M = 150;
/** швидкість проїзду поза цими межами — помилка проєкції, км/год */
exports.PASS_MIN_KMH = 4;
exports.PASS_MAX_KMH = 70;
/** стоянка біля кінцевої: швидкість нижча за це і до краю лінії ближче за TERMINAL_M */
exports.STANDING_KMH = 3;
exports.TERMINAL_M = 100;
exports.CONFIDENCE_OK = 8;
exports.CONFIDENCE_FEW = 3;
const R = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;
function toXY(lat, lng, lat0) {
    return [rad(lng) * R * Math.cos(rad(lat0)), rad(lat) * R];
}
/** «2-Б», «2 б», «2Б» → «2Б»: так номер із фіду збігається з номером чи id маршруту */
function normalizeRouteNo(value) {
    return String(value ?? '')
        .toUpperCase()
        .replace(/[\s\-–—._/]/g, '');
}
function buildChainLine(points) {
    const lat0 = points.length ? points[0].lat : 0;
    const xy = points.map((p) => toXY(p.lat, p.lng, lat0));
    const at = [0];
    for (let i = 1; i < xy.length; i++)
        at.push(at[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    return { ids: points.map((p) => p.id), technical: points.map((p) => p.technical), xy, at, lat0 };
}
/**
 * Проєкції точки на лінію: усі місця, де лінія проходить ближче `maxOff` (лінія може підходити до себе — петля,
 * заїзд і повернення тією самою вулицею), по одному на суцільну ділянку. `s` — відстань від початку лінії.
 */
function projectOnChain(line, lat, lng, maxOff = exports.GPS_OFF_LINE_M) {
    const [px, py] = toXY(lat, lng, line.lat0);
    const out = [];
    let cur = null;
    for (let i = 1; i < line.xy.length; i++) {
        const [ax, ay] = line.xy[i - 1];
        const [bx, by] = line.xy[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const off = Math.hypot(px - ax - t * dx, py - ay - t * dy);
        if (off > maxOff) {
            if (cur)
                out.push(cur);
            cur = null;
            continue;
        }
        const s = line.at[i - 1] + t * Math.sqrt(len2);
        if (!cur || off < cur.off)
            cur = { s, off };
    }
    if (cur)
        out.push(cur);
    return out;
}
/** Проїзди автобусів уздовж лінії: пари сусідніх точок одного автобуса, що рухаються лінією вперед */
function findPasses(line, points) {
    const total = line.at[line.at.length - 1] ?? 0;
    const byVehicle = new Map();
    for (const p of points) {
        const t = new Date(p.at).getTime();
        if (!Number.isFinite(t))
            continue;
        const list = byVehicle.get(p.vehicleId) ?? [];
        list.push({ t, lat: p.lat, lng: p.lng, speed: Number(p.speed) || 0 });
        byVehicle.set(p.vehicleId, list);
    }
    const passes = [];
    for (const list of byVehicle.values()) {
        list.sort((a, b) => a.t - b.t);
        for (let i = 1; i < list.length; i++) {
            const a = list[i - 1];
            const b = list[i];
            const sec = (b.t - a.t) / 1000;
            if (sec < exports.PASS_MIN_SEC || sec > exports.PASS_MAX_SEC)
                continue;
            const straight = Math.hypot(...sub(toXY(a.lat, a.lng, line.lat0), toXY(b.lat, b.lng, line.lat0)));
            let best = null;
            let count = 0;
            for (const pa of projectOnChain(line, a.lat, a.lng)) {
                for (const pb of projectOnChain(line, b.lat, b.lng)) {
                    const m = pb.s - pa.s;
                    if (m < exports.PASS_MIN_M)
                        continue;
                    const kmh = (m / sec) * 3.6;
                    if (kmh < exports.PASS_MIN_KMH || kmh > exports.PASS_MAX_KMH)
                        continue;
                    // лінією не може бути коротше, ніж навпростець, і навряд чи втричі довше
                    if (m < straight * 0.9 || m > straight * 3 + 300)
                        continue;
                    // стояв на кінцевій: проміжок містить відстій, а не дорогу
                    if (a.speed < exports.STANDING_KMH && pa.s < exports.TERMINAL_M)
                        continue;
                    if (b.speed < exports.STANDING_KMH && total - pb.s < exports.TERMINAL_M)
                        continue;
                    count++;
                    if (!best || m < best.to - best.from)
                        best = { from: pa.s, to: pb.s, sec };
                }
            }
            // кілька можливих проїздів (лінія підходить до себе) — не вгадуємо
            if (best && count === 1)
                passes.push(best);
        }
    }
    return passes;
}
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
}
/** Зважена медіана: значення, на якому накопичена вага проходить половину */
function weightedMedian(items) {
    const list = items.filter((i) => i.weight > 0 && Number.isFinite(i.value)).sort((a, b) => a.value - b.value);
    const total = list.reduce((n, i) => n + i.weight, 0);
    if (!total)
        return null;
    let acc = 0;
    for (const i of list) {
        acc += i.weight;
        if (acc >= total / 2)
            return i.value;
    }
    return list[list.length - 1].value;
}
function hms(value) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
    return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0) : null;
}
function median(values) {
    if (!values.length)
        return null;
    const s = [...values].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}
function buildRunTimes(dataset, points) {
    const stops = new Map(dataset.stops.map((s) => [s.id, s]));
    const defaultSec = Number(dataset.meta?.defaultSec) > 0 ? Number(dataset.meta.defaultSec) : 120;
    const seg = new Map(dataset.segments.map((s) => [`${s.routeId}|${s.fromStopId}|${s.toStopId}`, s.seconds]));
    const segSec = (routeId, a, b) => seg.get(`${routeId}|${a}|${b}`) ?? seg.get(`${routeId}|${b}|${a}`) ?? defaultSec;
    const routeByNo = new Map();
    for (const r of dataset.routes) {
        routeByNo.set(normalizeRouteNo(r.id), r.id);
        const short = r.shortName;
        if (short)
            routeByNo.set(normalizeRouteNo(short), r.id);
    }
    const pointsByRoute = new Map();
    const unknown = new Set();
    for (const p of points) {
        const id = routeByNo.get(normalizeRouteNo(p.routeNo));
        if (!id) {
            unknown.add(p.routeNo);
            continue;
        }
        const list = pointsByRoute.get(id) ?? [];
        list.push(p);
        pointsByRoute.set(id, list);
    }
    const routes = [];
    for (const r of dataset.routes) {
        const rows = dataset.routeStops.filter((x) => x.routeId === r.id);
        const routePoints = pointsByRoute.get(r.id) ?? [];
        const directions = [];
        for (const direction of ['there', 'back']) {
            const key = direction === 'there' ? 'orderThere' : 'orderBack';
            const chain = rows
                .filter((x) => (x[key] ?? -1) > 0 && stops.has(x.stopId))
                .sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0))
                .map((x) => ({ id: x.stopId, lat: stops.get(x.stopId).lat, lng: stops.get(x.stopId).lng, technical: x.mapOnly === true }));
            if (chain.length < 2)
                continue;
            const line = buildChainLine(chain);
            const passes = findPasses(line, routePoints);
            const spans = [];
            let start = line.technical.findIndex((t) => !t);
            for (let i = start + 1; start >= 0 && i < line.ids.length; i++) {
                if (line.technical[i])
                    continue;
                const from = line.at[start];
                const to = line.at[i];
                const meters = to - from;
                let ourSec = 0;
                for (let k = start; k < i; k++)
                    ourSec += segSec(r.id, line.ids[k], line.ids[k + 1]);
                const obs = [];
                if (meters > 0) {
                    for (const p of passes) {
                        const overlap = Math.min(to, p.to) - Math.max(from, p.from);
                        if (overlap > 0)
                            obs.push({ value: p.sec / (p.to - p.from), weight: overlap / meters });
                    }
                }
                const weight = obs.reduce((n, o) => n + o.weight, 0);
                const confidence = weight >= exports.CONFIDENCE_OK ? 'ok' : weight >= exports.CONFIDENCE_FEW ? 'few' : 'none';
                const pace = confidence === 'none' ? null : weightedMedian(obs);
                spans.push({
                    fromStopId: line.ids[start],
                    toStopId: line.ids[i],
                    fromName: stops.get(line.ids[start])?.name ?? line.ids[start],
                    toName: stops.get(line.ids[i])?.name ?? line.ids[i],
                    meters: Math.round(meters),
                    ourSec,
                    gpsSec: pace === null ? null : Math.round(pace * meters),
                    passes: Math.round(weight * 10) / 10,
                    confidence,
                });
                start = i;
            }
            if (!spans.length)
                continue;
            const meters = spans.reduce((n, s) => n + s.meters, 0);
            const known = spans.filter((s) => s.gpsSec !== null);
            const timetable = dataset.trips
                .filter((t) => t.routeId === r.id && (String(t.directionId) === '1' ? 'there' : 'back') === direction && !t.variantId && !t.startStopId && !t.endStopId)
                .map((t) => {
                const dep = hms(t.departureTime);
                const arr = hms(t.arrivalTime);
                return dep !== null && arr !== null && arr > dep ? arr - dep : null;
            })
                .filter((v) => v !== null);
            directions.push({
                direction,
                meters,
                ourSec: spans.reduce((n, s) => n + s.ourSec, 0),
                gpsSec: known.length ? spans.reduce((n, s) => n + (s.gpsSec ?? s.ourSec), 0) : null,
                covered: meters ? Math.round((known.reduce((n, s) => n + s.meters, 0) / meters) * 100) / 100 : 0,
                timetableSec: median(timetable),
                passes: passes.length,
                spans,
            });
        }
        if (directions.length) {
            routes.push({ routeId: r.id, routeNo: r.shortName || r.id, points: routePoints.length, directions });
        }
    }
    return { routes, unknownRouteNos: [...unknown].sort() };
}
