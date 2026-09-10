"use strict";
/**
 * Час рейсу по зупинках: зріз ланцюжка [start..end], сума сегментів,
 * пропорційне стиснення під фіксований час прибуття на останню обслуговувану зупинку.
 *
 * MIRROR: keep byte-identical with backend/src/trip-timing.ts
 * (frontend copy: frontend/src/pages/TransportPage/tripTiming.ts). Чистий модуль без імпортів.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClockMins = parseClockMins;
exports.computeTripTiming = computeTripTiming;
exports.minutesAtStop = minutesAtStop;
exports.tripServesPair = tripServesPair;
exports.roundMonotonic = roundMonotonic;
/** HH:MM або HH:MM:SS → хвилини від півночі; інакше null. Секунди відкидаються. */
function parseClockMins(s) {
    if (!s)
        return null;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s).trim());
    if (!m)
        return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59)
        return null;
    return h * 60 + min;
}
/**
 * Обчислити час на кожній обслуговуваній зупинці рейсу.
 * null — коли ланцюжок коротший за 2, start/end не в ланцюжку або start не раніше end.
 */
function computeTripTiming(chainKeys, segSec, trip) {
    if (chainKeys.length < 2)
        return null;
    const startIndex = trip.startStopId ? chainKeys.indexOf(trip.startStopId) : 0;
    const endIndex = trip.endStopId ? chainKeys.indexOf(trip.endStopId) : chainKeys.length - 1;
    if (startIndex < 0 || endIndex < 0 || startIndex >= endIndex)
        return null;
    const cum = [0];
    for (let i = startIndex; i < endIndex; i++) {
        const sec = Number(segSec(chainKeys[i], chainKeys[i + 1]));
        cum.push(cum[cum.length - 1] + (Number.isFinite(sec) && sec > 0 ? sec : 0));
    }
    const neededSec = cum[cum.length - 1];
    const availableSec = trip.arrivalMins == null ? null : (trip.arrivalMins - trip.departureMins) * 60;
    const arrivalIgnored = availableSec != null && availableSec <= 0;
    const factor = availableSec != null && availableSec > 0 && neededSec > availableSec ? availableSec / neededSec : 1;
    const stops = [];
    const minsByStop = {};
    for (let k = 0; k < cum.length; k++) {
        const index = startIndex + k;
        const mins = trip.departureMins + (cum[k] * factor) / 60;
        stops.push({ stopId: chainKeys[index], index, mins });
        minsByStop[chainKeys[index]] = mins;
    }
    return { stops, startIndex, endIndex, neededSec, availableSec, factor, arrivalIgnored, minsByStop };
}
/** Хвилини на зупинці або null, якщо рейс її не обслуговує. */
function minutesAtStop(timing, stopId) {
    if (!timing)
        return null;
    return Object.prototype.hasOwnProperty.call(timing.minsByStop, stopId) ? timing.minsByStop[stopId] : null;
}
/** Чи рейс обслуговує обидві зупинки і fromId раніше за toId. */
function tripServesPair(timing, fromId, toId) {
    if (!timing || fromId === toId)
        return false;
    const from = timing.stops.find((s) => s.stopId === fromId);
    const to = timing.stops.find((s) => s.stopId === toId);
    return !!from && !!to && from.index < to.index;
}
/** Округлення до хвилин з гарантією неспадання (для GTFS stop_times). */
function roundMonotonic(mins) {
    const out = [];
    for (let i = 0; i < mins.length; i++) {
        const r = Math.round(mins[i]);
        out.push(i > 0 && r < out[i - 1] ? out[i - 1] : r);
    }
    return out;
}
