"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AD_EVENTS = exports.AD_PLACEMENTS = void 0;
exports.parseAdEvent = parseAdEvent;
exports.deviceOf = deviceOf;
exports.adWallSnapshot = adWallSnapshot;
const sticker_scans_1 = require("./sticker-scans");
exports.AD_PLACEMENTS = ['sticker', 'dovede'];
exports.AD_EVENTS = ['shown', 'started', 'completed', 'page'];
const ID = /^[A-Za-z0-9-]{8,64}$/;
const STOP = /^[A-Za-z0-9_-]{1,40}$/;
const VIDEO = /^[a-z0-9-]{1,40}$/;
/** Тіло POST /ads/events; null — 400 */
function parseAdEvent(body) {
    if (!body || typeof body !== 'object')
        return null;
    const b = body;
    const placement = exports.AD_PLACEMENTS.find((p) => p === b.placement);
    const event = exports.AD_EVENTS.find((e) => e === b.event);
    if (!placement || !event)
        return null;
    // «відкрив сторінку з доступом» буває лише в «Доведе»
    if (event === 'page' && placement !== 'dovede')
        return null;
    if (typeof b.viewId !== 'string' || !ID.test(b.viewId))
        return null;
    const clientId = typeof b.clientId === 'string' && ID.test(b.clientId) ? b.clientId : null;
    const video = typeof b.video === 'string' && VIDEO.test(b.video) ? b.video : null;
    let stopId = null;
    if (placement === 'sticker') {
        if (typeof b.stopId !== 'string' || !STOP.test(b.stopId))
            return null;
        stopId = b.stopId;
    }
    return { placement, event, viewId: b.viewId, clientId, video, stopId };
}
/** Лише клас пристрою з User-Agent — не відбиток */
function deviceOf(userAgent) {
    const ua = typeof userAgent === 'string' ? userAgent : '';
    if (/iPhone|iPad|iPod/i.test(ua))
        return 'ios';
    if (/Android/i.test(ua))
        return 'android';
    if (/Windows|Macintosh|X11|Linux|CrOS/i.test(ua))
        return 'desktop';
    return 'other';
}
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 91;
const LIMIT = 30;
/**
 * Зведення для стіни: сьогодні (київська доба) і за 91 день — показали / почали / досмотріли, входи на /dovede (хто),
 * унікальні браузери, і 30 останніх переглядів із подробицями. Подій небагато — читаються сирими рядками.
 * Наклейки — лише міста стіни (`cityCode`), «Доведе» — завжди.
 */
async function adWallSnapshot(prisma, opts) {
    const now = opts.now ?? new Date();
    const day = (0, sticker_scans_1.kyivDayHour)(now).day;
    const rows = await prisma.adEvent.findMany({
        where: {
            createdAt: { gte: new Date(now.getTime() - WINDOW_DAYS * DAY_MS) },
            OR: [{ placement: 'sticker', cityCode: opts.cityCode }, { placement: 'dovede' }],
        },
        orderBy: { id: 'asc' },
    });
    const zero = () => ({ shown: 0, started: 0, completed: 0 });
    const sticker = { today: zero(), total: zero(), people: 0 };
    const dovede = { today: { ...zero(), pages: 0 }, total: { ...zero(), pages: 0 }, access: { admin: 0, guest: 0, public: 0 }, people: 0 };
    const people = { sticker: new Set(), dovede: new Set() };
    const views = new Map();
    const seenByClient = new Map();
    for (const r of rows) {
        const placement = r.placement;
        const isToday = (0, sticker_scans_1.kyivDayHour)(r.createdAt).day === day;
        if (r.event === 'page') {
            dovede.total.pages++;
            if (isToday)
                dovede.today.pages++;
            if (r.access === 'admin' || r.access === 'guest' || r.access === 'public')
                dovede.access[r.access]++;
        }
        else if (r.event === 'shown' || r.event === 'started' || r.event === 'completed') {
            const bucket = placement === 'sticker' ? sticker : dovede;
            bucket.total[r.event]++;
            if (isToday)
                bucket.today[r.event]++;
        }
        if (r.clientId)
            (placement === 'sticker' ? people.sticker : people.dovede).add(r.clientId);
        let v = views.get(r.viewId);
        if (!v) {
            const before = r.clientId ? (seenByClient.get(r.clientId)?.size ?? 0) : 0;
            if (r.clientId && r.event !== 'page') {
                const set = seenByClient.get(r.clientId) ?? new Set();
                set.add(r.viewId);
                seenByClient.set(r.clientId, set);
            }
            v = {
                viewId: r.viewId,
                placement,
                kind: r.event === 'page' ? 'page' : 'view',
                stopId: r.stopId,
                device: r.device,
                who: r.clientId ? r.clientId.slice(-4) : null,
                seenBefore: before,
                access: r.access,
                at: r.createdAt.toISOString(),
                started: false,
                completed: false,
            };
            views.set(r.viewId, v);
        }
        if (r.event === 'started')
            v.started = true;
        if (r.event === 'completed') {
            v.started = true;
            v.completed = true;
        }
    }
    sticker.people = people.sticker.size;
    dovede.people = people.dovede.size;
    return {
        now: now.toISOString(),
        day,
        sticker,
        dovede,
        views: [...views.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, LIMIT),
    };
}
