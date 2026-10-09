"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPORT_DAYS = exports.MAX_WAITED_MIN = exports.MAX_MINUTES_AGO = exports.MISSED_LATE_MIN = exports.MISSED_EARLY_MIN = exports.ARRIVED_WINDOW_MIN = exports.ARRIVAL_SOURCES = exports.ARRIVAL_KINDS = void 0;
exports.parseArrivalReport = parseArrivalReport;
exports.kyivClock = kyivClock;
exports.hhmmToMins = hhmmToMins;
exports.minsToHhmm = minsToHhmm;
exports.clockDiff = clockDiff;
exports.buildArrivalRow = buildArrivalRow;
exports.parseReportDays = parseReportDays;
exports.arrivalReportStats = arrivalReportStats;
/**
 * Факт прибуття міського автобуса від пасажирів (frontend: довге натискання на час рейсу на
 * /transport/route/:id і на картку табло /transport/stop/:id → ArrivalReportSheet).
 *
 * Поки лише збираємо статистику для точніших графіків: `arrived` — «автобус тут» (фактичний час
 * бере сервер за київським годинником мінус `minutesAgo`, а не телефон), `missed` — «чекав,
 * автобуса не було ні до, ні після». Рядок зберігає маршрут, напрямок, зупинку й час за розкладом
 * текстом, без FK: датасет замінюється цілком (replaceTransportDataset), а історія має лишитися.
 * IP у базу не пишеться — лише в пам'ять процесу для відсіву повторів (як у sticker-scans.ts).
 */
exports.ARRIVAL_KINDS = ['arrived', 'missed'];
exports.ARRIVAL_SOURCES = ['route', 'board'];
/** «Автобус приїхав» приймається лише в межах ±90 хв від розкладу — інакше це інший рейс */
exports.ARRIVED_WINDOW_MIN = 90;
/** «Не було автобуса»: щонайменше 5 хв до розкладу (людина вже на зупинці) і до 3 год після */
exports.MISSED_EARLY_MIN = 5;
exports.MISSED_LATE_MIN = 180;
exports.MAX_MINUTES_AGO = 30;
exports.MAX_WAITED_MIN = 180;
const ID_RE = /^[A-Za-z0-9_.:-]{1,60}$/;
const STOP_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function intIn(v, min, max) {
    if (v === undefined || v === null || v === '')
        return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
/**
 * Body POST /transport/arrival-reports:
 * { kind, routeId, tripId, direction: there|back, stopId, scheduledTime: HH:MM, source: route|board,
 *   minutesAgo?: 0–30 (arrived), waitedMin?: 1–180 (missed), clientId? }
 */
function parseArrivalReport(body) {
    const b = (body ?? {});
    const str = (k) => (typeof b[k] === 'string' ? b[k].trim() : '');
    const kind = str('kind');
    const routeId = str('routeId');
    const tripId = str('tripId');
    const direction = str('direction');
    const stopId = str('stopId');
    const scheduledTime = str('scheduledTime');
    const source = str('source');
    const clientId = str('clientId');
    if (!exports.ARRIVAL_KINDS.includes(kind))
        return null;
    if (!ID_RE.test(routeId) || !ID_RE.test(tripId) || !STOP_ID_RE.test(stopId))
        return null;
    if (direction !== 'there' && direction !== 'back')
        return null;
    if (!HHMM_RE.test(scheduledTime))
        return null;
    if (!exports.ARRIVAL_SOURCES.includes(source))
        return null;
    const minutesAgo = kind === 'arrived' ? intIn(b.minutesAgo, 0, exports.MAX_MINUTES_AGO) : 0;
    if (kind === 'arrived' && minutesAgo === null && b.minutesAgo !== undefined)
        return null;
    const waitedMin = kind === 'missed' ? intIn(b.waitedMin, 1, exports.MAX_WAITED_MIN) : null;
    if (kind === 'missed' && waitedMin === null && b.waitedMin !== undefined && b.waitedMin !== null)
        return null;
    return {
        kind: kind,
        routeId,
        tripId,
        direction,
        stopId,
        scheduledTime,
        source: source,
        minutesAgo: minutesAgo ?? 0,
        waitedMin,
        clientId: CLIENT_ID_RE.test(clientId) ? clientId : null,
    };
}
const KYIV_CLOCK = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});
/** Київська дата (YYYY-MM-DD) і хвилини від півночі моменту часу */
function kyivClock(d) {
    const p = Object.fromEntries(KYIV_CLOCK.formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
function hhmmToMins(s) {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
}
function minsToHhmm(mins) {
    const m = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** Різниця «факт − розклад» у хвилинах з переходом через північ: результат у [−720, 720) */
function clockDiff(actualMins, scheduledMins) {
    return ((((actualMins - scheduledMins + 720) % 1440) + 1440) % 1440) - 720;
}
const DAY_MS = 24 * 60 * 60 * 1000;
function shiftDate(date, days) {
    const t = Date.parse(`${date}T12:00:00Z`) + days * DAY_MS;
    return new Date(t).toISOString().slice(0, 10);
}
/**
 * Звіт → рядок таблиці за київським часом сервера `now`. Дата рейсу — київська доба розкладу
 * (рейс о 23:55, про який повідомили о 00:05, належить учорашній добі). Поза вікном — null.
 */
function buildArrivalRow(input, now) {
    const { date, mins } = kyivClock(now);
    const scheduledMins = hhmmToMins(input.scheduledTime);
    const at = input.kind === 'arrived' ? mins - input.minutesAgo : mins;
    const delay = clockDiff(at, scheduledMins);
    if (input.kind === 'arrived' && Math.abs(delay) > exports.ARRIVED_WINDOW_MIN)
        return { error: 'too_far' };
    if (input.kind === 'missed' && (delay < -exports.MISSED_EARLY_MIN || delay > exports.MISSED_LATE_MIN))
        return { error: 'too_far' };
    // На скільки діб зсунулась дата розкладу відносно «зараз» (північ між розкладом і фактом)
    const dayShift = Math.round((at - delay - scheduledMins) / 1440);
    return {
        row: {
            kind: input.kind,
            routeId: input.routeId,
            tripId: input.tripId,
            direction: input.direction,
            stopId: input.stopId,
            serviceDate: shiftDate(date, dayShift),
            scheduledTime: input.scheduledTime,
            actualTime: input.kind === 'arrived' ? minsToHhmm(at) : null,
            delayMin: input.kind === 'arrived' ? delay : null,
            waitedMin: input.kind === 'missed' ? input.waitedMin : null,
            source: input.source,
            clientId: input.clientId,
        },
    };
}
exports.REPORT_DAYS = [1, 7, 30, 90];
/** ?days= адмінки: 1 | 7 | 30 | 90, інше — 30 */
function parseReportDays(v) {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return exports.REPORT_DAYS.includes(n) ? n : 30;
}
const RECENT_LIMIT = 200;
/**
 * Статистика для адмінки за `days` діб: зведення по «маршрут · напрямок · зупинка · час за
 * розкладом» (найбільше звітів — першими) і останні сирі звіти. Звітів небагато — рахуємо тут.
 */
async function arrivalReportStats(prisma, opts = {}) {
    const now = opts.now ?? new Date();
    const days = opts.days ?? 30;
    const where = days === 1
        ? { serviceDate: { gte: kyivClock(now).date } }
        : { createdAt: { gte: new Date(now.getTime() - days * DAY_MS) } };
    const rows = await prisma.transportArrivalReport.findMany({ where, orderBy: { id: 'desc' } });
    const views = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        routeId: r.routeId,
        tripId: r.tripId,
        direction: r.direction,
        stopId: r.stopId,
        serviceDate: r.serviceDate,
        scheduledTime: r.scheduledTime,
        actualTime: r.actualTime,
        delayMin: r.delayMin,
        waitedMin: r.waitedMin,
        source: r.source,
        clientId: r.clientId,
        createdAt: r.createdAt.toISOString(),
    }));
    const by = new Map();
    for (const r of views) {
        const k = `${r.routeId}|${r.direction}|${r.stopId}|${r.scheduledTime}`;
        const acc = by.get(k) ??
            {
                routeId: r.routeId,
                direction: r.direction,
                stopId: r.stopId,
                scheduledTime: r.scheduledTime,
                arrived: 0,
                missed: 0,
                avgDelay: null,
                minDelay: null,
                maxDelay: null,
                days: 0,
                lastAt: r.createdAt,
                delays: [],
                dates: new Set(),
            };
        if (r.kind === 'arrived') {
            acc.arrived += 1;
            if (r.delayMin !== null)
                acc.delays.push(r.delayMin);
        }
        else {
            acc.missed += 1;
        }
        acc.dates.add(r.serviceDate);
        if (r.createdAt > acc.lastAt)
            acc.lastAt = r.createdAt;
        by.set(k, acc);
    }
    const summary = [...by.values()]
        .map(({ delays, dates, ...s }) => ({
        ...s,
        avgDelay: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : null,
        minDelay: delays.length ? Math.min(...delays) : null,
        maxDelay: delays.length ? Math.max(...delays) : null,
        days: dates.size,
    }))
        .sort((a, b) => b.arrived + b.missed - (a.arrived + a.missed) ||
        a.routeId.localeCompare(b.routeId, 'uk', { numeric: true }) ||
        a.scheduledTime.localeCompare(b.scheduledTime) ||
        a.stopId.localeCompare(b.stopId));
    const arrived = views.filter((r) => r.kind === 'arrived').length;
    return {
        days,
        total: views.length,
        arrived,
        missed: views.length - arrived,
        summary,
        recent: views.slice(0, RECENT_LIMIT),
    };
}
