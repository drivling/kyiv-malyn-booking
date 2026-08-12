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
exports.corridorSlugFromRouteSlug = corridorSlugFromRouteSlug;
exports.defaultLabelUk = defaultLabelUk;
exports.resolveCorridorTripRouteId = resolveCorridorTripRouteId;
exports.findOrCreateTripRoute = findOrCreateTripRoute;
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
/** Corridor slug = first two segments of legacy/variant slug. */
function corridorSlugFromRouteSlug(slug) {
    const { startCode, endCode } = parseLegacyRoute(slug);
    return buildLegacyRouteKey(startCode, endCode, []);
}
function defaultLabelUk(startCode, endCode, viaCodes = []) {
    const map = {
        Kyiv: 'Київ',
        Malyn: 'Малин',
        Zhytomyr: 'Житомир',
        Korosten: 'Коростень',
        Irpin: 'Ірпінь',
        Bucha: 'Буча',
    };
    const base = `${map[startCode] || startCode} → ${map[endCode] || endCode}`;
    if (viaCodes.includes('Irpin'))
        return `${base} (через Ірпінь)`;
    if (viaCodes.includes('Bucha'))
        return `${base} (через Бучу)`;
    if (viaCodes.length)
        return `${base} (через ${viaCodes.map((c) => map[c] || c).join(', ')})`;
    return base;
}
/** Resolve corridor TripRoute by legacy slug (Kyiv-Malyn). */
async function resolveCorridorTripRouteId(prisma, routeSlug) {
    if (!prisma?.tripRoute?.findUnique)
        return null;
    const corridorSlug = corridorSlugFromRouteSlug(routeSlug);
    const row = await prisma.tripRoute.findUnique({ where: { slug: corridorSlug } });
    if (!row)
        return null;
    // Prefer corridor (no parent); if slug itself is corridor, ok
    if (row.corridorTripRouteId == null)
        return row.id;
    return row.corridorTripRouteId;
}
/** Find or create TripRoute from points; creates RouteStops. */
async function findOrCreateTripRoute(prisma, input) {
    const points = await prisma.tripPoint.findMany();
    const byId = new Map(points.map((p) => [p.id, p]));
    const validated = validateTripPointSelection({
        startPointId: input.startPointId,
        endPointId: input.endPointId,
        viaPointIds: input.viaPointIds ?? [],
        pointsById: byId,
    });
    if (!validated.ok) {
        throw new Error(validated.error);
    }
    const start = byId.get(input.startPointId);
    const end = byId.get(input.endPointId);
    const viaCodes = validated.viaPointIds.map((id) => byId.get(id).code);
    const slug = buildLegacyRouteKey(start.code, end.code, viaCodes);
    const existing = await prisma.tripRoute.findUnique({ where: { slug } });
    if (existing)
        return existing;
    const corridorSlug = buildLegacyRouteKey(start.code, end.code, []);
    let corridorTripRouteId = null;
    if (viaCodes.length > 0) {
        const corridor = await prisma.tripRoute.findUnique({ where: { slug: corridorSlug } });
        if (corridor)
            corridorTripRouteId = corridor.id;
        else {
            const createdCorridor = await prisma.tripRoute.create({
                data: {
                    slug: corridorSlug,
                    labelUk: defaultLabelUk(start.code, end.code),
                    startPointId: start.id,
                    endPointId: end.id,
                    corridorTripRouteId: null,
                },
            });
            await prisma.tripRouteStop.createMany({
                data: [
                    { tripRouteId: createdCorridor.id, pointId: start.id, position: 0, role: 'start' },
                    { tripRouteId: createdCorridor.id, pointId: end.id, position: 1, role: 'end' },
                ],
            });
            corridorTripRouteId = createdCorridor.id;
        }
    }
    const created = await prisma.tripRoute.create({
        data: {
            slug,
            labelUk: defaultLabelUk(start.code, end.code, viaCodes),
            startPointId: start.id,
            endPointId: end.id,
            corridorTripRouteId,
        },
    });
    const stopRows = [
        { tripRouteId: created.id, pointId: start.id, position: 0, role: 'start' },
        ...validated.viaPointIds.map((pid, i) => ({
            tripRouteId: created.id,
            pointId: pid,
            position: i + 1,
            role: 'via',
        })),
        {
            tripRouteId: created.id,
            pointId: end.id,
            position: 1 + validated.viaPointIds.length,
            role: 'end',
        },
    ];
    await prisma.tripRouteStop.createMany({ data: stopRows });
    return created;
}
