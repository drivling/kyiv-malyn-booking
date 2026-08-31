"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTimetablePages = parseTimetablePages;
exports.buildTimetablePreview = buildTimetablePreview;
exports.applyTimetablePreview = applyTimetablePreview;
exports._previewStoreSizeForTests = _previewStoreSizeForTests;
exports.fingerprintUrlList = fingerprintUrlList;
const crypto_1 = require("crypto");
const swrailway_eltrain_1 = require("./swrailway-eltrain");
const schedule_trip_1 = require("./schedule-trip");
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const previewStore = new Map();
function prunePreviewStore(now = Date.now()) {
    for (const [k, v] of previewStore) {
        if (v.expiresAt <= now)
            previewStore.delete(k);
    }
}
function weekdaysEqual(a, b) {
    const na = (0, schedule_trip_1.normalizeActiveWeekdays)(a);
    if (na.length !== b.length)
        return false;
    return na.every((d, i) => d === b[i]);
}
function buildBefore(s) {
    return {
        departureTime: s.departureTime,
        arrivalTime: s.arrivalTime,
        durationMinutes: s.durationMinutes,
        activeWeekdays: (0, schedule_trip_1.normalizeActiveWeekdays)(s.activeWeekdays),
        alightingPlace: s.alightingPlace,
        daysNote: null,
    };
}
function diffStatus(before, after) {
    const same = before.departureTime === after.departureTime &&
        (before.arrivalTime || null) === (after.arrivalTime || null) &&
        (before.durationMinutes ?? null) === (after.durationMinutes ?? null) &&
        weekdaysEqual(before.activeWeekdays, after.activeWeekdays) &&
        (before.alightingPlace || null) === (after.alightingPlace || null);
    return same ? 'unchanged' : 'changed';
}
const MAX_ELTRAIN_HTML_CHARS = 1500000;
function parseTimetablePages(raw) {
    if (raw == null)
        return [];
    if (!Array.isArray(raw)) {
        throw Object.assign(new Error('pages must be an array of { url, html }'), { status: 400 });
    }
    const pages = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            continue;
        const url = String(item.url || '').trim();
        const html = String(item.html || '');
        if (!url || !html)
            continue;
        if (html.length > MAX_ELTRAIN_HTML_CHARS) {
            throw Object.assign(new Error(`HTML too large for ${url}`), { status: 400 });
        }
        pages.push({ url, html });
    }
    return pages;
}
async function buildTimetablePreview(prisma, opts) {
    prunePreviewStore();
    const schedules = await prisma.schedule.findMany({
        where: {
            AND: [
                { timetableSourceUrl: { not: null } },
                { NOT: { timetableSourceUrl: '' } },
                { tripNumber: { not: null } },
                { NOT: { tripNumber: '' } },
            ],
        },
        include: { startPoint: true, endPoint: true },
        orderBy: [{ route: 'asc' }, { departureTime: 'asc' }],
    });
    const byUrl = new Map();
    for (const s of schedules) {
        const url = (s.timetableSourceUrl || '').trim();
        if (!url)
            continue;
        const list = byUrl.get(url) ?? [];
        list.push(s);
        byUrl.set(url, list);
    }
    const errors = [];
    const trainsByUrl = new Map();
    const htmlByUrl = new Map((opts?.pages ?? []).map((p) => [p.url.trim(), p.html]));
    for (const url of byUrl.keys()) {
        try {
            const provided = htmlByUrl.get(url);
            const html = provided ?? (await (0, swrailway_eltrain_1.fetchEltrainPage)(url));
            trainsByUrl.set(url, (0, swrailway_eltrain_1.parseEltrainTimetable)(html));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'fetch/parse failed';
            errors.push({
                url,
                error: htmlByUrl.has(url)
                    ? msg
                    : `${msg} — likely geo-blocked from EU hosting; upload the saved HTML page`,
            });
            trainsByUrl.set(url, []);
        }
    }
    const matchedTripKeys = new Set();
    const changes = [];
    const patches = new Map();
    for (const s of schedules) {
        const url = (s.timetableSourceUrl || '').trim();
        const tripNumber = (s.tripNumber || '').trim();
        const before = buildBefore(s);
        const emptyAfter = {
            departureTime: null,
            arrivalTime: null,
            durationMinutes: null,
            activeWeekdays: before.activeWeekdays,
            alightingPlace: before.alightingPlace,
            daysNote: null,
        };
        if (errors.some((e) => e.url === url)) {
            changes.push({
                scheduleId: s.id,
                tripNumber,
                route: s.route,
                timetableSourceUrl: url,
                status: 'not_found',
                before,
                after: emptyAfter,
            });
            continue;
        }
        const trains = trainsByUrl.get(url) ?? [];
        const boardNeedle = (s.boardingPlace || s.startPoint?.nameUk || '').trim();
        const alightNeedle = (s.alightingPlace || s.endPoint?.nameUk || '').trim();
        const resolved = (0, swrailway_eltrain_1.resolveTrainForSchedule)(trains, tripNumber, boardNeedle);
        if (resolved.status !== 'ok' || !resolved.train) {
            changes.push({
                scheduleId: s.id,
                tripNumber,
                route: s.route,
                timetableSourceUrl: url,
                status: resolved.status === 'ambiguous' ? 'ambiguous' : 'not_found',
                before,
                after: emptyAfter,
            });
            continue;
        }
        const train = resolved.train;
        matchedTripKeys.add(`${url}::${train.tripNumber}::${boardNeedle || train.destinationLabel}`);
        const picked = (0, swrailway_eltrain_1.pickStationTimes)(train, boardNeedle || 'Київ', alightNeedle || 'Малин');
        if (!picked.departureTime) {
            changes.push({
                scheduleId: s.id,
                tripNumber,
                route: s.route,
                timetableSourceUrl: url,
                status: 'no_board_time',
                before,
                after: { ...emptyAfter, daysNote: train.daysNote },
            });
            continue;
        }
        const after = {
            departureTime: picked.departureTime,
            arrivalTime: picked.arrivalTime,
            durationMinutes: (0, swrailway_eltrain_1.durationMinutesBetween)(picked.departureTime, picked.arrivalTime),
            activeWeekdays: train.activeWeekdays,
            alightingPlace: before.alightingPlace || picked.alightStation,
            daysNote: train.daysNote,
        };
        const status = diffStatus(before, after);
        changes.push({
            scheduleId: s.id,
            tripNumber,
            route: s.route,
            timetableSourceUrl: url,
            status,
            before,
            after,
        });
        if (status === 'changed') {
            patches.set(s.id, {
                ...after,
                route: s.route,
                tripRouteId: s.tripRouteId,
            });
        }
    }
    const pageTrainsUnmatched = [];
    for (const [url, trains] of trainsByUrl) {
        for (const t of trains) {
            const key = `${url}::${t.tripNumber}`;
            if (!matchedTripKeys.has(key)) {
                pageTrainsUnmatched.push({
                    url,
                    tripNumber: t.tripNumber,
                    daysNote: t.daysNote,
                    destinationLabel: t.destinationLabel,
                });
            }
        }
    }
    const previewToken = (0, crypto_1.randomBytes)(16).toString('hex');
    previewStore.set(previewToken, {
        expiresAt: Date.now() + PREVIEW_TTL_MS,
        patches,
    });
    const summary = {
        changed: changes.filter((c) => c.status === 'changed').length,
        unchanged: changes.filter((c) => c.status === 'unchanged').length,
        notFound: changes.filter((c) => c.status === 'not_found' || c.status === 'no_board_time').length,
        ambiguous: changes.filter((c) => c.status === 'ambiguous').length,
        errors: errors.length,
    };
    return { previewToken, changes, pageTrainsUnmatched, errors, summary };
}
async function applyTimetablePreview(prisma, previewToken, scheduleIds) {
    prunePreviewStore();
    const entry = previewStore.get(previewToken);
    if (!entry) {
        throw Object.assign(new Error('Preview expired or invalid — run preview again'), { status: 400 });
    }
    const selected = scheduleIds.filter((id) => entry.patches.has(id));
    if (selected.length === 0) {
        return { updated: 0, conflicts: [] };
    }
    // Fail-all on unique conflicts
    const conflicts = [];
    for (const id of selected) {
        const patch = entry.patches.get(id);
        if (!patch.departureTime) {
            conflicts.push({ scheduleId: id, error: 'Missing departureTime in patch' });
            continue;
        }
        const clash = await prisma.schedule.findFirst({
            where: {
                id: { not: id },
                OR: [
                    { route: patch.route, departureTime: patch.departureTime },
                    { tripRouteId: patch.tripRouteId, departureTime: patch.departureTime },
                ],
            },
            select: { id: true, tripNumber: true },
        });
        if (clash) {
            conflicts.push({
                scheduleId: id,
                error: `Time ${patch.departureTime} already used by schedule #${clash.id}${clash.tripNumber ? ` (${clash.tripNumber})` : ''}`,
            });
        }
    }
    if (conflicts.length > 0) {
        return { updated: 0, conflicts };
    }
    await prisma.$transaction(selected.map((id) => {
        const patch = entry.patches.get(id);
        return prisma.schedule.update({
            where: { id },
            data: {
                departureTime: patch.departureTime,
                arrivalTime: patch.arrivalTime,
                durationMinutes: patch.durationMinutes,
                activeWeekdays: patch.activeWeekdays,
                alightingPlace: patch.alightingPlace,
            },
        });
    }));
    previewStore.delete(previewToken);
    return { updated: selected.length, conflicts: [] };
}
/** Test helper */
function _previewStoreSizeForTests() {
    return previewStore.size;
}
function fingerprintUrlList(urls) {
    return (0, crypto_1.createHash)('sha1').update(urls.slice().sort().join('|')).digest('hex');
}
