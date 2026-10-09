"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stickerWallKey = stickerWallKey;
exports.isStickerWallKey = isStickerWallKey;
exports.stickerWallSnapshot = stickerWallSnapshot;
const crypto_1 = require("crypto");
const sticker_scans_1 = require("./sticker-scans");
/**
 * Віджет «Відкриття з QR» на стіну (`/admin/wall?key=…`): телефон у горизонтальному положенні
 * щохвилини тягне знімок сьогоднішніх сканів і святкує кожне нове відкриття.
 *
 * Телефон не входить в адмінку: посилання несе окремий ключ лише на читання цього знімка —
 * HMAC від ADMIN_PASSWORD, тож зміна пароля відкликає і ключ.
 */
const WALL_KEY_SALT = 'sticker-wall-v1';
function stickerWallKey(adminPassword) {
    return (0, crypto_1.createHmac)('sha256', adminPassword).update(WALL_KEY_SALT).digest('hex').slice(0, 32);
}
function isStickerWallKey(key, adminPassword) {
    if (typeof key !== 'string' || key.length !== 32)
        return false;
    const expected = Buffer.from(stickerWallKey(adminPassword));
    const given = Buffer.from(key);
    return given.length === expected.length && (0, crypto_1.timingSafeEqual)(given, expected);
}
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EVENTS_LIMIT = 20;
const BEST_DAY_WINDOW = 90;
/** Хвилина київської доби (0–1439) — «учора на цю пору». Зсув Києва — цілі години, тож хвилини як в UTC */
function kyivMinuteOfDay(d) {
    const { hour } = (0, sticker_scans_1.kyivDayHour)(d);
    return hour * 60 + d.getUTCMinutes();
}
async function stickerWallSnapshot(prisma, opts = {}) {
    const now = opts.now ?? new Date();
    const after = opts.after && Number.isFinite(opts.after) && opts.after > 0 ? Math.floor(opts.after) : 0;
    // Сканів небагато — 90 днів читаємо сирими рядками й розкладаємо по київських добах тут
    const rows = await prisma.stickerScan.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - (BEST_DAY_WINDOW + 1) * DAY_MS) } },
        select: { id: true, stopId: true, side: true, createdAt: true },
        orderBy: { id: 'asc' },
    });
    const day = (0, sticker_scans_1.kyivDayHour)(now).day;
    const yesterday = (0, sticker_scans_1.kyivDayHour)(new Date(now.getTime() - DAY_MS)).day;
    const nowMinute = kyivMinuteOfDay(now);
    const hourly = Array.from({ length: 24 }, () => 0);
    const byStop = new Map();
    const perDay = new Map();
    const events = [];
    let total = 0;
    let yesterdaySameTime = 0;
    let lastId = after;
    for (const r of rows) {
        const { day: d, hour } = (0, sticker_scans_1.kyivDayHour)(r.createdAt);
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
        if (d === yesterday && kyivMinuteOfDay(r.createdAt) <= nowMinute)
            yesterdaySameTime += 1;
        if (d !== day)
            continue;
        total += 1;
        hourly[hour] += 1;
        const s = byStop.get(r.stopId) ?? {
            stopId: r.stopId,
            today: 0,
            lastHour: 0,
            last3h: 0,
            lastAt: null,
            hourly: Array.from({ length: 24 }, () => 0),
        };
        const age = now.getTime() - r.createdAt.getTime();
        s.today += 1;
        s.hourly[hour] += 1;
        if (age <= HOUR_MS)
            s.lastHour += 1;
        if (age <= 3 * HOUR_MS)
            s.last3h += 1;
        const at = r.createdAt.toISOString();
        if (!s.lastAt || at > s.lastAt)
            s.lastAt = at;
        byStop.set(r.stopId, s);
        if (r.id > lastId)
            lastId = r.id;
        if (r.id > after && events.length < EVENTS_LIMIT) {
            events.push({ id: r.id, stopId: r.stopId, side: r.side, createdAt: at });
        }
    }
    let bestDay = null;
    for (const [d, count] of perDay) {
        if (d === day)
            continue;
        if (!bestDay || count > bestDay.count || (count === bestDay.count && d > bestDay.day))
            bestDay = { day: d, count };
    }
    const stops = [...byStop.values()].sort((a, b) => b.today - a.today || (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.stopId.localeCompare(b.stopId));
    return { now: now.toISOString(), day, total, yesterdaySameTime, hourly, stops, events, lastId, bestDay };
}
