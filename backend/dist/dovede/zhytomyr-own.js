"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownZhytomyrRoute = ownZhytomyrRoute;
/**
 * «Доведе» · пряма поїздка Житомиром за власними даними (zt.rozklad.in.ua — сайт власника), без Google
 * (Docs/dovede-roadmap.md, «Житомир зі свого сайту»). Чиста функція над `ZT_OWN`.
 *
 * Лише напрямки, звірені з Google (`checked`), лише без пересадок, і лише коли обидві точки — це автовокзал
 * або місце, що зветься як наша зупинка («обласна лікарня», «вулиця Покровська»). Усе інше — справа бази й Google.
 */
const korosten_osm_1 = require("../korosten-osm");
const zhytomyr_stops_1 = require("../zhytomyr-stops");
const zhytomyr_own_data_1 = require("./zhytomyr-own-data");
/** Автовокзал Житомир-1 (вул. Київська, 93): куди привозять міжміські рейси */
const STATION = { lat: 50.2679, lng: 28.6919 };
/** Скільки йти від автовокзалу до зупинки, м — далі це вже не «біля автовокзалу» */
const NEAR_STATION_M = 350;
const WALK_M_PER_MIN = 75;
/** Чекати автобус довше — краще спитати Google: може, є інший транспорт */
const MAX_WAIT_MIN = 45;
const toMins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clock = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
function isWeekend(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd === 0 || wd === 6;
}
function endsOf(dir, point) {
    const at = [];
    dir.stops.forEach(([name, , lat, lng], i) => {
        if (point === 'zhytomyr.avtovokzal') {
            if (lat == null || lng == null)
                return;
            const m = (0, korosten_osm_1.distanceM)(STATION, { lat, lng });
            if (m <= NEAR_STATION_M)
                at.push({ i, walkM: Math.round(m / 10) * 10 });
        }
        else if ((0, zhytomyr_stops_1.sameStopName)(point, name))
            at.push({ i, walkM: 0 });
    });
    return { at };
}
/** Найраніша за прибуттям пряма поїздка; null — власними даними не доїхати (тоді база й Google) */
function ownZhytomyrRoute(q, labels, data = zhytomyr_own_data_1.ZT_OWN) {
    const start = toMins(q.time);
    const weekend = isWeekend(q.date);
    let best = null;
    for (const dir of data.dirs) {
        if (!dir.checked)
            continue;
        const from = endsOf(dir, q.from).at;
        const to = endsOf(dir, q.to).at;
        if (!from.length || !to.length)
            continue;
        const departures = (weekend ? dir.we : dir.wd).map(toMins);
        for (const a of from) {
            for (const b of to) {
                if (b.i <= a.i)
                    continue;
                const walkBefore = Math.ceil(a.walkM / WALK_M_PER_MIN);
                const walkAfter = Math.ceil(b.walkM / WALK_M_PER_MIN);
                const offset = dir.stops[a.i][1];
                const board = departures.map((d) => d + offset).find((t) => t >= start + walkBefore);
                if (board == null || board - start > MAX_WAIT_MIN)
                    continue;
                const ride = Math.max(1, dir.stops[b.i][1] - offset);
                const arrive = board + ride + walkAfter;
                if (best && best.arrive <= arrive)
                    continue;
                const steps = [];
                if (a.walkM >= 60)
                    steps.push({ kind: 'walk', minutes: walkBefore, meters: a.walkM });
                steps.push({ kind: 'transit', minutes: ride, mode: 'BUS', line: dir.no, headsign: dir.stops[dir.stops.length - 1][0], fromStop: dir.stops[a.i][0], toStop: dir.stops[b.i][0], stops: b.i - a.i, departs: clock(board) });
                if (b.walkM >= 60)
                    steps.push({ kind: 'walk', minutes: walkAfter, meters: b.walkM });
                best = { arrive, steps };
            }
        }
    }
    if (!best)
        return null;
    return { ok: true, source: 'own', city: 'Zhytomyr', fromLabel: labels.from, toLabel: labels.to, steps: best.steps, minutes: best.arrive - start, fetchedAt: `${data.fetchedAt}T00:00:00.000Z` };
}
