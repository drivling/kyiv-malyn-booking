"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECK_TOLERANCE_PCT = exports.CHECK_TOLERANCE_MIN = exports.CHECK_MIN_M = exports.CHECK_VERDICTS = void 0;
exports.checkPairs = checkPairs;
exports.checkVerdict = checkVerdict;
exports.checkReport = checkReport;
const transport_segments_1 = require("../transport-segments");
const korosten_google_1 = require("../korosten-google");
exports.CHECK_VERDICTS = ['same', 'google_faster', 'ours_faster', 'other_line', 'walk', 'none'];
/** Кінці пари ближче за це — пішки швидше, Google автобуса не дасть */
exports.CHECK_MIN_M = 400;
/** Збігається: різниця не більша за більше з двох — стільки хвилин і стільки відсотків нашого часу */
exports.CHECK_TOLERANCE_MIN = 2;
exports.CHECK_TOLERANCE_PCT = 20;
/** Година, біля якої шукаємо рейс для питання */
const TARGET_MIN = 10 * 60;
function straightM(a, b) {
    const r = 6371000;
    const p1 = (a.lat * Math.PI) / 180;
    const p2 = (b.lat * Math.PI) / 180;
    const dp = p2 - p1;
    const dl = ((b.lng - a.lng) * Math.PI) / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(h));
}
const minutesOf = (time) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** Тип дня й рейс для питання: будній, якщо маршрут у будні ходить, інакше субота; відправлення — найближче до 10:00 */
function pickTrip(trips) {
    const timed = trips.map((t) => ({ weekend: t.serviceId === 'weekends', min: minutesOf(t.departureTime) })).filter((t) => t.min !== null);
    if (!timed.length)
        return null;
    const weekday = timed.filter((t) => !t.weekend);
    const pool = weekday.length ? weekday : timed;
    const best = pool.reduce((a, b) => (Math.abs(b.min - TARGET_MIN) < Math.abs(a.min - TARGET_MIN) ? b : a));
    return { dayType: weekday.length ? 'weekday' : 'saturday', startMin: best.min };
}
/**
 * Пари зупинок для звірки: кожен маршрут (без ненадійних) × напрямок — початок → кінець, початок → середина,
 * середина → кінець головного ланцюжка. Однакова пара з кількох маршрутів — одна пара з кількома лініями.
 */
function checkPairs(dataset) {
    const stopById = new Map(dataset.stops.map((s) => [s.id, s]));
    const seconds = new Map(dataset.segments.map((s) => [`${s.routeId}|${s.fromStopId}|${s.toStopId}`, s.seconds]));
    const byKey = new Map();
    for (const route of dataset.routes) {
        if (route.unreliable)
            continue;
        const routeNo = (route.shortName ?? '').trim() || route.id;
        const routeStops = dataset.routeStops.filter((s) => s.routeId === route.id);
        for (const chain of (0, transport_segments_1.segmentChains)(routeStops)) {
            const direction = chain.label === 'there' ? 'there' : 'back';
            // рейси основного шляху цього напрямку: '1' — «туди» (як у GTFS-експорті)
            const trips = dataset.trips.filter((t) => t.routeId === route.id && !t.variantId && (String(t.directionId) === '1' ? 'there' : 'back') === direction);
            const trip = pickTrip(trips);
            if (!trip)
                continue;
            // секунди від початку ланцюжка до кожної точки; без сегмента — час невідомий, напрямок пропускаємо
            const offset = [0];
            let known = true;
            for (let i = 0; i < chain.ids.length - 1; i++) {
                const sec = seconds.get(`${route.id}|${chain.ids[i]}|${chain.ids[i + 1]}`);
                if (sec === undefined) {
                    known = false;
                    break;
                }
                offset.push(offset[i] + sec);
            }
            if (!known)
                continue;
            const real = chain.ids.map((id, i) => ({ id, i })).filter((p) => !chain.technical[p.i] && stopById.has(p.id));
            if (real.length < 2)
                continue;
            const first = real[0];
            const last = real[real.length - 1];
            const mid = real[Math.floor(real.length / 2)];
            const spans = real.length >= 3 ? [[first, last], [first, mid], [mid, last]] : [[first, last]];
            for (const [a, b] of spans) {
                const from = stopById.get(a.id);
                const to = stopById.get(b.id);
                if (a.id === b.id || straightM(from, to) < exports.CHECK_MIN_M)
                    continue;
                const ownMin = Math.max(1, Math.round((offset[b.i] - offset[a.i]) / 60));
                const key = `${a.id}|${b.id}`;
                const pair = byKey.get(key);
                if (pair) {
                    if (!pair.lines.some((l) => (0, korosten_google_1.normalizeLine)(l.routeNo) === (0, korosten_google_1.normalizeLine)(routeNo)))
                        pair.lines.push({ routeNo, ownMin });
                    continue;
                }
                const atFrom = trip.startMin + Math.floor(offset[a.i] / 60);
                byKey.set(key, { from: a.id, to: b.id, fromName: from.name, toName: to.name, lines: [{ routeNo, ownMin }], dayType: trip.dayType, hour: Math.min(23, Math.floor(atFrom / 60)) });
            }
        }
    }
    return [...byKey.values()];
}
const rides = (steps) => (Array.isArray(steps) ? steps : [])
    .filter((s) => s && s.walk === undefined && typeof s.line === 'string')
    .map((s) => ({ line: String(s.line), min: Number(s.min) || 0 }));
/** Вердикт по парі; null — відповіді ще немає (питання в черзі чи не вдалося) */
function checkVerdict(meta, answer) {
    if (answer.status === 'no_route')
        return { verdict: 'none' };
    if (answer.status !== 'ok')
        return null;
    const ridden = rides(answer.steps);
    if (!ridden.length)
        return { verdict: 'walk' };
    const googleLines = [...new Set(ridden.map((r) => r.line).filter(Boolean))];
    const ours = ridden.length === 1 ? meta.lines.find((l) => (0, korosten_google_1.normalizeLine)(l.routeNo) === (0, korosten_google_1.normalizeLine)(ridden[0].line)) : undefined;
    if (!ours)
        return { verdict: 'other_line', googleLines };
    const googleMin = ridden[0].min;
    const diff = googleMin - ours.ownMin;
    const tolerance = Math.max(exports.CHECK_TOLERANCE_MIN, (ours.ownMin * exports.CHECK_TOLERANCE_PCT) / 100);
    const verdict = Math.abs(diff) <= tolerance ? 'same' : diff < 0 ? 'google_faster' : 'ours_faster';
    return { verdict, routeNo: ours.routeNo, ownMin: ours.ownMin, googleMin, googleLines };
}
/** Звіт звірки: `pairs` — пари плану з ключем `from|to` id, `answers` — відповіді за тим самим ключем */
function checkReport(pairs, answers) {
    const counts = Object.fromEntries(exports.CHECK_VERDICTS.map((v) => [v, 0]));
    const routes = new Map();
    const rows = [];
    let answered = 0;
    for (const { key, meta } of pairs) {
        const answer = answers.get(key);
        const result = answer ? checkVerdict(meta, answer) : null;
        if (!result)
            continue;
        answered++;
        counts[result.verdict]++;
        for (const line of meta.lines) {
            const r = routes.get(line.routeNo) ?? { routeNo: line.routeNo, pairs: 0, same: 0, googleFaster: 0, oursFaster: 0, other: 0 };
            r.pairs++;
            // вердикт про час стосується лише того маршруту, яким поїхав Google
            const mine = result.routeNo === undefined || (0, korosten_google_1.normalizeLine)(result.routeNo) === (0, korosten_google_1.normalizeLine)(line.routeNo);
            if (result.verdict === 'same' && mine)
                r.same++;
            else if (result.verdict === 'google_faster' && mine)
                r.googleFaster++;
            else if (result.verdict === 'ours_faster' && mine)
                r.oursFaster++;
            else
                r.other++;
            routes.set(line.routeNo, r);
        }
        if (result.verdict !== 'same')
            rows.push({ ...result, from: meta.fromName, to: meta.toName, routes: meta.lines.map((l) => l.routeNo), ours: Math.min(...meta.lines.map((l) => l.ownMin)) });
    }
    const weight = (r) => (r.googleMin !== undefined && r.ownMin !== undefined ? Math.abs(r.googleMin - r.ownMin) : -1);
    rows.sort((a, b) => weight(b) - weight(a) || exports.CHECK_VERDICTS.indexOf(a.verdict) - exports.CHECK_VERDICTS.indexOf(b.verdict) || a.from.localeCompare(b.from, 'uk'));
    return {
        pairs: pairs.length,
        answered,
        counts,
        byRoute: [...routes.values()].sort((a, b) => a.routeNo.localeCompare(b.routeNo, 'uk', { numeric: true })),
        rows: rows.slice(0, 200),
    };
}
