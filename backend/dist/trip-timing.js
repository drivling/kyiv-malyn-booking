"use strict";
/**
 * Час рейсу по зупинках: зріз ланцюжка [start..end], сума сегментів,
 * пропорційне стиснення під фіксований час прибуття на останню обслуговувану зупинку
 * або точні опорні часи на проміжних зупинках (timepoints).
 *
 * MIRROR: keep byte-identical with backend/src/trip-timing.ts
 * (frontend copy: frontend/src/pages/LocalTransportPage/dataset/tripTiming.ts). Чистий модуль без імпортів.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClockMins = parseClockMins;
exports.parseTimepoints = parseTimepoints;
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
/** Опорні часи з даних рейсу ([{ stopId, time: 'HH:MM[:SS]' }]) → хвилини; некоректні записи відкидаються. */
function parseTimepoints(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const tp of raw) {
        if (!tp || typeof tp !== 'object')
            continue;
        const stopId = tp.stopId;
        const time = tp.time;
        const mins = typeof time === 'string' ? parseClockMins(time) : null;
        if (typeof stopId === 'string' && stopId && mins != null)
            out.push({ stopId, mins });
    }
    return out;
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
    // Опори: відправлення + опорні часи по порядку ланцюжка в межах зрізу, час строго зростає
    const anchors = [{ k: 0, mins: trip.departureMins }];
    let timepointsIgnored = 0;
    for (const tp of trip.timepoints ?? []) {
        const k = chainKeys.indexOf(tp.stopId) - startIndex;
        const prev = anchors[anchors.length - 1];
        if (k <= prev.k || k > endIndex - startIndex || !(tp.mins > prev.mins)) {
            timepointsIgnored++;
            continue;
        }
        anchors.push({ k, mins: tp.mins });
    }
    const timepointIndexes = anchors.slice(1).map((a) => startIndex + a.k);
    const stops = [];
    const minsByStop = {};
    if (anchors.length === 1) {
        const availableSec = trip.arrivalMins == null ? null : (trip.arrivalMins - trip.departureMins) * 60;
        const arrivalIgnored = availableSec != null && availableSec <= 0;
        const factor = availableSec != null && availableSec > 0 && neededSec > availableSec ? availableSec / neededSec : 1;
        for (let k = 0; k < cum.length; k++) {
            const index = startIndex + k;
            const mins = trip.departureMins + (cum[k] * factor) / 60;
            stops.push({ stopId: chainKeys[index], index, mins });
            minsByStop[chainKeys[index]] = mins;
        }
        return {
            stops,
            startIndex,
            endIndex,
            neededSec,
            availableSec,
            factor,
            arrivalIgnored,
            minsByStop,
            timepointIndexes,
            timepointsIgnored,
        };
    }
    const last = anchors[anchors.length - 1];
    const endFixed = last.k === cum.length - 1;
    const availableSec = endFixed ? (last.mins - trip.departureMins) * 60 : null;
    const factor = availableSec != null && neededSec > 0 ? availableSec / neededSec : 1;
    let j = 0;
    for (let k = 0; k < cum.length; k++) {
        while (j < anchors.length - 1 && k > anchors[j + 1].k)
            j++;
        let mins;
        if (k >= last.k) {
            mins = last.mins + (cum[k] - cum[last.k]) / 60;
        }
        else {
            const a = anchors[j];
            const b = anchors[j + 1];
            const span = cum[b.k] - cum[a.k];
            const t = span > 0 ? (cum[k] - cum[a.k]) / span : (k - a.k) / (b.k - a.k);
            mins = a.mins + t * (b.mins - a.mins);
        }
        const index = startIndex + k;
        stops.push({ stopId: chainKeys[index], index, mins });
        minsByStop[chainKeys[index]] = mins;
    }
    return {
        stops,
        startIndex,
        endIndex,
        neededSec,
        availableSec,
        factor,
        arrivalIgnored: false,
        minsByStop,
        timepointIndexes,
        timepointsIgnored,
    };
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
