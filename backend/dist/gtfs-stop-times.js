"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_MINS = exports.DEFAULT_SEC = void 0;
exports.toGtfsTime = toGtfsTime;
exports.minutesToGtfs = minutesToGtfs;
exports.parseMinutes = parseMinutes;
exports.tripDirection = tripDirection;
exports.orderedPassengerStops = orderedPassengerStops;
exports.orderedAllStops = orderedAllStops;
exports.makeSegSec = makeSegSec;
exports.buildTripStopTimes = buildTripStopTimes;
const trip_timing_1 = require("./trip-timing");
exports.DEFAULT_SEC = 120;
exports.FALLBACK_MINS = 2;
function toGtfsTime(raw) {
    const m = String(raw || '')
        .trim()
        .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m)
        return null;
    const hh = String(Number(m[1])).padStart(2, '0');
    return `${hh}:${m[2]}:${m[3] || '00'}`;
}
function minutesToGtfs(mins) {
    const total = Math.max(0, Math.round(mins));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
function parseMinutes(gtfsTime) {
    const m = gtfsTime.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!m)
        return 0;
    return Number(m[1]) * 60 + Number(m[2]);
}
/** direction_id "1" = туди (orderThere), інакше назад (orderBack) */
function tripDirection(directionId) {
    return String(directionId) === '1' ? 'there' : 'back';
}
function orderedPassengerStops(stops, direction) {
    const key = direction === 'there' ? 'orderThere' : 'orderBack';
    return stops
        .filter((s) => !s.mapOnly && (s[key] ?? -1) > 0)
        .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}
function orderedAllStops(stops, direction) {
    const key = direction === 'there' ? 'orderThere' : 'orderBack';
    return stops
        .filter((s) => (s[key] ?? -1) > 0)
        .sort((a, b) => (a[key] ?? -1) - (b[key] ?? -1));
}
/**
 * Тривалість перегону для маршруту: прямий ключ, зворотний ключ, defaultSec.
 * Маршрут без жодного сегмента — плоскі FALLBACK_MINS на перегін.
 */
function makeSegSec(segments, defaultSec, routeId) {
    const prefix = `${routeId}|`;
    const hasRouteSegments = Object.keys(segments).some((k) => k.startsWith(prefix));
    if (!hasRouteSegments)
        return () => exports.FALLBACK_MINS * 60;
    return (a, b) => segments[`${prefix}${a}|${b}`] ?? segments[`${prefix}${b}|${a}`] ?? defaultSec;
}
/**
 * stop_times рейсу або null, якщо рейс без часу / зріз не має ≥2 пасажирських зупинок.
 * knownStopIds — зупинки, що є в датасеті (без координат у фід не потрапляють).
 */
function buildTripStopTimes(trip, routeStops, segments, defaultSec, knownStopIds) {
    const dep = toGtfsTime(trip.departureTime);
    if (!dep)
        return null;
    const direction = tripDirection(trip.directionId);
    const chainKeys = orderedAllStops(routeStops, direction).map((s) => s.stopId);
    const passengerSet = new Set(orderedPassengerStops(routeStops, direction).map((s) => s.stopId));
    const arrivalMins = (0, trip_timing_1.parseClockMins)(trip.arrivalTime);
    const timing = (0, trip_timing_1.computeTripTiming)(chainKeys, makeSegSec(segments, defaultSec, trip.routeId), {
        departureMins: parseMinutes(dep),
        arrivalMins,
        startStopId: trip.startStopId || null,
        endStopId: trip.endStopId || null,
    });
    if (!timing)
        return null;
    const served = timing.stops.filter((s) => passengerSet.has(s.stopId) && knownStopIds.has(s.stopId));
    if (served.length < 2)
        return null;
    const rounded = (0, trip_timing_1.roundMonotonic)(served.map((s) => s.mins));
    const fixedArrival = arrivalMins != null && !timing.arrivalIgnored;
    const rows = served.map((s, i) => {
        const t = minutesToGtfs(rounded[i]);
        const last = i === served.length - 1;
        return {
            trip_id: trip.id,
            arrival_time: t,
            departure_time: t,
            stop_id: s.stopId,
            stop_sequence: i + 1,
            timepoint: i === 0 || (last && fixedArrival) ? 1 : 0,
        };
    });
    return {
        rows,
        direction,
        chainKeys,
        startIndex: timing.startIndex,
        endIndex: timing.endIndex,
        startStopId: chainKeys[timing.startIndex],
        endStopId: chainKeys[timing.endIndex],
        factor: timing.factor,
    };
}
