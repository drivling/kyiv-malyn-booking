"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_MINS = exports.DEFAULT_SEC = void 0;
exports.toGtfsTime = toGtfsTime;
exports.minutesToGtfs = minutesToGtfs;
exports.parseMinutes = parseMinutes;
exports.tripDirection = tripDirection;
exports.orderedPassengerStops = orderedPassengerStops;
exports.orderedAllStops = orderedAllStops;
exports.resolveTripChain = resolveTripChain;
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
/** Ланцюжок рейсу: варіант шляху (variantId того самого напрямку) або основний ланцюжок напрямку. */
function resolveTripChain(trip, routeStops, variants = []) {
    const direction = tripDirection(trip.directionId);
    const variant = trip.variantId
        ? variants.find((v) => v.id === trip.variantId && tripDirection(v.directionId) === direction)
        : undefined;
    if (variant) {
        return {
            direction,
            chainKeys: variant.stops.map((p) => p.stopId),
            passengerSet: new Set(variant.stops.filter((p) => !p.mapOnly).map((p) => p.stopId)),
            variantId: variant.id,
        };
    }
    return {
        direction,
        chainKeys: orderedAllStops(routeStops, direction).map((s) => s.stopId),
        passengerSet: new Set(orderedPassengerStops(routeStops, direction).map((s) => s.stopId)),
        variantId: null,
    };
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
function buildTripStopTimes(trip, routeStops, segments, defaultSec, knownStopIds, variants = []) {
    const dep = toGtfsTime(trip.departureTime);
    if (!dep)
        return null;
    const { direction, chainKeys, passengerSet, variantId } = resolveTripChain(trip, routeStops, variants);
    const arrivalMins = (0, trip_timing_1.parseClockMins)(trip.arrivalTime);
    const timepoints = (0, trip_timing_1.parseTimepoints)(trip.timepoints);
    const timing = (0, trip_timing_1.computeTripTiming)(chainKeys, makeSegSec(segments, defaultSec, trip.routeId), {
        departureMins: parseMinutes(dep),
        arrivalMins,
        startStopId: trip.startStopId || null,
        endStopId: trip.endStopId || null,
        timepoints,
    });
    if (!timing)
        return null;
    const served = timing.stops.filter((s) => passengerSet.has(s.stopId) && knownStopIds.has(s.stopId));
    if (served.length < 2)
        return null;
    const rounded = (0, trip_timing_1.roundMonotonic)(served.map((s) => s.mins));
    const fixedIndexes = new Set(timing.timepointIndexes);
    const fixedArrival = !fixedIndexes.size && arrivalMins != null && !timing.arrivalIgnored;
    const rows = served.map((s, i) => {
        const t = minutesToGtfs(rounded[i]);
        const last = i === served.length - 1;
        return {
            trip_id: trip.id,
            arrival_time: t,
            departure_time: t,
            stop_id: s.stopId,
            stop_sequence: i + 1,
            timepoint: i === 0 || fixedIndexes.has(s.index) || (last && fixedArrival) ? 1 : 0,
        };
    });
    return {
        rows,
        direction,
        variantId,
        chainKeys,
        startIndex: timing.startIndex,
        endIndex: timing.endIndex,
        startStopId: chainKeys[timing.startIndex],
        endStopId: chainKeys[timing.endIndex],
        factor: timing.factor,
    };
}
