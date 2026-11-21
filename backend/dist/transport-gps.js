"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GPS_EXPORT_LIMIT = exports.RUN_TIMES_DAYS_MAX = exports.RUN_TIMES_DAYS_DEFAULT = exports.GPS_FEEDS = void 0;
exports.kyivLocalToUtc = kyivLocalToUtc;
exports.parseGpsFeed = parseGpsFeed;
exports.fetchGpsFeedText = fetchGpsFeedText;
exports.recordGpsPositions = recordGpsPositions;
exports.parseGpsRange = parseGpsRange;
exports.parseRunTimesDays = parseRunTimesDays;
exports.listGpsPointsSince = listGpsPointsSince;
exports.listGpsPositions = listGpsPositions;
exports.GPS_FEEDS = [{ cityCode: 'Korosten', url: 'https://www.korosten-rada.gov.ua/transport_korosten.json' }];
const KYIV_TZ = 'Europe/Kyiv';
function kyivOffsetMinutes(at) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: KYIV_TZ,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(at);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - at.getTime()) / 60000);
}
/** «2026-11-17 09:59:44» за Києвом → UTC-момент (літній / зимовий час); не той формат → null */
function kyivLocalToUtc(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (!m)
        return null;
    const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    let guess = naive - kyivOffsetMinutes(new Date(naive)) * 60000;
    guess = naive - kyivOffsetMinutes(new Date(guess)) * 60000;
    return Number.isFinite(guess) ? new Date(guess) : null;
}
/**
 * Тіло фіду → точки. Фід буває з BOM і буває JSON-рядком, усередині якого JSON-масив. Рядок без imei, часу чи
 * координат (або з нулями) пропускаємо.
 */
function parseGpsFeed(body) {
    let data = JSON.parse(String(body).replace(/^﻿/, ''));
    if (typeof data === 'string')
        data = JSON.parse(data);
    if (!Array.isArray(data))
        throw new Error('GPS feed: expected an array');
    const out = [];
    for (const raw of data) {
        if (!raw || typeof raw !== 'object')
            continue;
        const x = raw;
        const vehicleId = String(x.imei ?? '').trim();
        const at = kyivLocalToUtc(String(x.time ?? ''));
        const lat = Number(x.latitude);
        const lng = Number(x.longitude);
        if (!vehicleId || !at || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0))
            continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
            continue;
        const speed = Number(x.speed);
        const sats = Number(x.satellites);
        out.push({
            vehicleId,
            plate: String(x.gov_number ?? '').replace(/\s+/g, ' ').trim(),
            routeNo: String(x.route_short_name ?? '').trim(),
            at,
            lat,
            lng,
            speed: Number.isFinite(speed) ? speed : 0,
            satellites: Number.isFinite(sats) ? Math.round(sats) : null,
        });
    }
    return out;
}
/** Один GET фіду з загальним User-Agent; не-200 — помилка */
async function fetchGpsFeedText(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'transport-gps-recorder/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return res.text();
}
/**
 * Тік запису: кожен фід → нові точки в базу (повтор тієї самої точки — `skipDuplicates` за (місто, imei, час)),
 * точки старші за `retentionDays` — геть. Помилка одного фіду не зупиняє інші.
 */
async function recordGpsPositions(prisma, deps) {
    const now = deps.now();
    const maxAgeMs = (deps.maxAgeMin ?? 180) * 60000;
    const retentionMs = (deps.retentionDays ?? 30) * 86400000;
    const results = [];
    for (const feed of deps.feeds ?? exports.GPS_FEEDS) {
        try {
            const positions = parseGpsFeed(await deps.fetchText(feed.url)).filter((p) => now.getTime() - p.at.getTime() <= maxAgeMs && p.at.getTime() - now.getTime() <= 5 * 60000);
            const created = positions.length
                ? await prisma.transportVehiclePosition.createMany({
                    data: positions.map((p) => ({ cityCode: feed.cityCode, ...p })),
                    skipDuplicates: true,
                })
                : { count: 0 };
            const removed = await prisma.transportVehiclePosition.deleteMany({
                where: { cityCode: feed.cityCode, at: { lt: new Date(now.getTime() - retentionMs) } },
            });
            results.push({ cityCode: feed.cityCode, received: positions.length, inserted: created.count, deleted: removed.count });
        }
        catch (e) {
            results.push({ cityCode: feed.cityCode, received: 0, inserted: 0, deleted: 0, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return results;
}
/** Межі вибірки для адмінки: from / to (ISO), за замовчуванням — останні 24 год, не більше 7 діб */
function parseGpsRange(from, to, now) {
    const end = to ? new Date(String(to)) : now;
    const start = from ? new Date(String(from)) : new Date(end.getTime() - 86400000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end)
        return null;
    if (end.getTime() - start.getTime() > 7 * 86400000)
        return null;
    return { from: start, to: end };
}
/** Скільки діб точок бере звіт «час у дорозі» (`GET /admin/transport/gps/run-times?days=`) */
exports.RUN_TIMES_DAYS_DEFAULT = 7;
exports.RUN_TIMES_DAYS_MAX = 30;
function parseRunTimesDays(raw) {
    if (raw === undefined || raw === null || raw === '')
        return exports.RUN_TIMES_DAYS_DEFAULT;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= exports.RUN_TIMES_DAYS_MAX ? n : null;
}
/** Точки міста від `since` для розрахунку часу в дорозі — без держномерів */
async function listGpsPointsSince(prisma, opts) {
    return prisma.transportVehiclePosition.findMany({
        where: { cityCode: opts.cityCode, at: { gte: opts.since } },
        orderBy: [{ vehicleId: 'asc' }, { at: 'asc' }],
        take: 300000,
        select: { vehicleId: true, routeNo: true, at: true, lat: true, lng: true, speed: true },
    });
}
exports.GPS_EXPORT_LIMIT = 100000;
/** Адмінка: точки міста за проміжок (опційно один маршрут) + коротка зведена по автобусах */
async function listGpsPositions(prisma, opts) {
    const rows = await prisma.transportVehiclePosition.findMany({
        where: { cityCode: opts.cityCode, at: { gte: opts.from, lt: opts.to }, ...(opts.routeNo ? { routeNo: opts.routeNo } : {}) },
        orderBy: [{ vehicleId: 'asc' }, { at: 'asc' }],
        take: exports.GPS_EXPORT_LIMIT + 1,
        select: { vehicleId: true, plate: true, routeNo: true, at: true, lat: true, lng: true, speed: true },
    });
    const truncated = rows.length > exports.GPS_EXPORT_LIMIT;
    const kept = truncated ? rows.slice(0, exports.GPS_EXPORT_LIMIT) : rows;
    const byVehicle = new Map();
    for (const r of kept) {
        const v = byVehicle.get(r.vehicleId) ?? { vehicleId: r.vehicleId, plate: r.plate, routes: new Set(), points: 0, first: r.at, last: r.at };
        v.routes.add(r.routeNo);
        v.points += 1;
        if (r.at < v.first)
            v.first = r.at;
        if (r.at > v.last)
            v.last = r.at;
        byVehicle.set(r.vehicleId, v);
    }
    return {
        positions: kept.map((r) => ({ ...r, at: r.at.toISOString() })),
        vehicles: [...byVehicle.values()].map((v) => ({
            vehicleId: v.vehicleId,
            plate: v.plate,
            routes: [...v.routes].sort(),
            points: v.points,
            first: v.first.toISOString(),
            last: v.last.toISOString(),
        })),
        truncated,
    };
}
