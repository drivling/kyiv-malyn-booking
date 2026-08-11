"use strict";
/** Intercity trip helpers: points, legacy route keys, weekdays, arrival. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKDAY_PRESETS = exports.ALL_WEEKDAYS = exports.VEHICLE_TYPES = void 0;
exports.parseLegacyRoute = parseLegacyRoute;
exports.buildLegacyRouteKey = buildLegacyRouteKey;
exports.normalizeViaPointIds = normalizeViaPointIds;
exports.normalizeActiveWeekdays = normalizeActiveWeekdays;
exports.isoWeekdayFromDate = isoWeekdayFromDate;
exports.isScheduleActiveOnDate = isScheduleActiveOnDate;
exports.parseHhMm = parseHhMm;
exports.formatHhMm = formatHhMm;
exports.resolveArrivalTime = resolveArrivalTime;
exports.validateTripPointSelection = validateTripPointSelection;
exports.matchesTerminals = matchesTerminals;
exports.buildFromToPairs = buildFromToPairs;
exports.isVehicleType = isVehicleType;
exports.VEHICLE_TYPES = ['marshrutka', 'elektrichka'];
exports.ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]; // 1=Mon … 7=Sun
/** Parse legacy route string e.g. Kyiv-Malyn-Irpin → terminals + vias. */
function parseLegacyRoute(route) {
    const parts = String(route || '')
        .split('-')
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length < 2) {
        return { startCode: parts[0] || '', endCode: '', viaCodes: [] };
    }
    return {
        startCode: parts[0],
        endCode: parts[1],
        viaCodes: parts.slice(2),
    };
}
/** Build stable legacy route key for Booking / unique(route, departureTime). */
function buildLegacyRouteKey(startCode, endCode, viaCodes = []) {
    const vias = viaCodes.filter(Boolean);
    return vias.length > 0 ? `${startCode}-${endCode}-${vias.join('-')}` : `${startCode}-${endCode}`;
}
function normalizeViaPointIds(raw) {
    if (raw == null)
        return [];
    if (!Array.isArray(raw))
        return [];
    const ids = [];
    for (const item of raw) {
        const n = Number(item);
        if (Number.isInteger(n) && n > 0 && !ids.includes(n))
            ids.push(n);
    }
    return ids;
}
function normalizeActiveWeekdays(raw) {
    if (raw == null)
        return [...exports.ALL_WEEKDAYS];
    if (!Array.isArray(raw))
        return [...exports.ALL_WEEKDAYS];
    const days = raw
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    const unique = [...new Set(days)].sort((a, b) => a - b);
    return unique.length > 0 ? unique : [...exports.ALL_WEEKDAYS];
}
/** ISO date YYYY-MM-DD or Date → ISO weekday 1=Mon … 7=Sun */
function isoWeekdayFromDate(date) {
    const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00`) : date;
    const js = d.getDay(); // 0=Sun … 6=Sat
    return js === 0 ? 7 : js;
}
function isScheduleActiveOnDate(activeWeekdays, date) {
    const days = normalizeActiveWeekdays(activeWeekdays);
    return days.includes(isoWeekdayFromDate(date));
}
function parseHhMm(time) {
    const match = String(time || '')
        .trim()
        .match(/^(\d{1,2}):(\d{2})$/);
    if (!match)
        return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59)
        return null;
    return { h, m };
}
function formatHhMm(h, m) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** Resolve arrival HH:MM from explicit arrival or departure + durationMinutes. */
function resolveArrivalTime(departureTime, arrivalTime, durationMinutes) {
    if (arrivalTime && parseHhMm(arrivalTime))
        return arrivalTime.trim();
    if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes < 0)
        return null;
    const dep = parseHhMm(departureTime);
    if (!dep)
        return null;
    const total = dep.h * 60 + dep.m + Math.round(durationMinutes);
    const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    return formatHhMm(Math.floor(wrapped / 60), wrapped % 60);
}
function validateTripPointSelection(input) {
    const { startPointId, endPointId, pointsById } = input;
    const viaPointIds = normalizeViaPointIds(input.viaPointIds);
    if (!pointsById.has(startPointId))
        return { ok: false, error: 'Unknown startPointId' };
    if (!pointsById.has(endPointId))
        return { ok: false, error: 'Unknown endPointId' };
    if (startPointId === endPointId)
        return { ok: false, error: 'startPointId and endPointId must differ' };
    for (const id of viaPointIds) {
        if (!pointsById.has(id))
            return { ok: false, error: `Unknown via point id: ${id}` };
        if (id === startPointId || id === endPointId) {
            return { ok: false, error: 'Via points must not duplicate terminals' };
        }
    }
    const allIds = new Set([startPointId, endPointId, ...viaPointIds]);
    const required = [...pointsById.values()].filter((p) => p.requiredOnTrip);
    for (const p of required) {
        if (!allIds.has(p.id)) {
            return { ok: false, error: `Required point «${p.nameUk}» must be on the trip (start, end, or via)` };
        }
    }
    return { ok: true, viaPointIds };
}
/** Match trip terminals to from/to city codes (order matters). */
function matchesTerminals(startCode, endCode, fromCode, toCode) {
    return startCode === fromCode && endCode === toCode;
}
/** Valid from/to pairs: both appearInFromTo; at least one requiredOnTrip. */
function buildFromToPairs(points) {
    const terminals = points.filter((p) => p.appearInFromTo !== false);
    const pairs = [];
    for (const from of terminals) {
        for (const to of terminals) {
            if (from.id === to.id)
                continue;
            if (!from.requiredOnTrip && !to.requiredOnTrip)
                continue;
            pairs.push({ from, to });
        }
    }
    return pairs;
}
function isVehicleType(value) {
    return value === 'marshrutka' || value === 'elektrichka';
}
exports.WEEKDAY_PRESETS = {
    all: [1, 2, 3, 4, 5, 6, 7],
    weekdays: [1, 2, 3, 4, 5],
    exceptSat: [1, 2, 3, 4, 5, 7],
    exceptSun: [1, 2, 3, 4, 5, 6],
    onlySun: [7],
};
