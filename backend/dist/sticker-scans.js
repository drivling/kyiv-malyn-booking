"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATS_DAYS = exports.STICKER_SIDES = void 0;
exports.parseStickerScan = parseStickerScan;
exports.createScanDeduper = createScanDeduper;
exports.parseStatsDays = parseStatsDays;
exports.kyivDayHour = kyivDayHour;
exports.stickerScanStats = stickerScanStats;
exports.parseStickerPrint = parseStickerPrint;
exports.clientKey = clientKey;
/**
 * Відкриття табло з QR-наклейок на зупинках (frontend: /admin/stickers, Docs/stop-stickers.md).
 * QR несе `utm_campaign=<stopId>-<side>`; табло при першому за сесію відкритті шле
 * POST /transport/sticker-scans, адмінка читає агрегати. IP у базу не пишеться — лише в пам'ять
 * процесу на 2 хвилини (разом з User-Agent), щоб подвійний скан чи перезавантаження без
 * sessionStorage не рахувались як нове відкриття. Короткі вікно і ключ з UA — бо за мобільним
 * CGNAT різні люди мають спільну IP-адресу.
 */
exports.STICKER_SIDES = ['a', 'b', 's'];
const STOP_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
function parseStickerScan(body) {
    const b = (body ?? {});
    const stopId = typeof b.stopId === 'string' ? b.stopId.trim() : '';
    const side = typeof b.side === 'string' ? b.side.trim() : '';
    if (!STOP_ID_RE.test(stopId))
        return null;
    if (!exports.STICKER_SIDES.includes(side))
        return null;
    return { stopId, side: side };
}
const DEDUPE_MS = 2 * 60 * 1000;
const DEDUPE_MAX = 5000;
/** Повтор того самого скану з того самого клієнта (IP + User-Agent) протягом 2 хвилин — не рахується */
function createScanDeduper(windowMs = DEDUPE_MS, max = DEDUPE_MAX) {
    const seen = new Map();
    return (key, now = Date.now()) => {
        const last = seen.get(key);
        if (last !== undefined && now - last < windowMs)
            return true;
        if (seen.size >= max) {
            for (const [k, t] of seen)
                if (now - t >= windowMs)
                    seen.delete(k);
            if (seen.size >= max)
                seen.clear();
        }
        seen.set(key, now);
        return false;
    };
}
exports.STATS_DAYS = [7, 30, 90];
/** ?days= графіків: 7 | 30 | 90, інше — 30 */
function parseStatsDays(v) {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return exports.STATS_DAYS.includes(n) ? n : 30;
}
const KYIV_PARTS = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
});
/** Київська доба (YYYY-MM-DD) і година доби (0–23) моменту часу — бакети графіків */
function kyivDayHour(d) {
    const p = Object.fromEntries(KYIV_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Статистика наклейок: агрегати по наклейках (зупинка + бік: усього, за 7 і 30 днів, останнє
 * відкриття; популярні — першими), відкриття по київських добах і годинах за вікно `days` для
 * графіків адмінки та облік друку. Сканів небагато, тож вікно читається сирими рядками й
 * розкладається по бакетах тут — київський час без SQL-часових поясів.
 */
async function stickerScanStats(prisma, opts = {}) {
    const now = opts.now ?? new Date();
    const days = opts.days ?? 30;
    const since = (n) => new Date(now.getTime() - n * DAY_MS);
    const [all, week, month, windowRows, prints] = await Promise.all([
        prisma.stickerScan.groupBy({ by: ['stopId', 'side'], _count: { _all: true }, _max: { createdAt: true } }),
        prisma.stickerScan.groupBy({ by: ['stopId', 'side'], where: { createdAt: { gte: since(7) } }, _count: { _all: true } }),
        prisma.stickerScan.groupBy({ by: ['stopId', 'side'], where: { createdAt: { gte: since(30) } }, _count: { _all: true } }),
        prisma.stickerScan.findMany({
            where: { createdAt: { gte: since(days) } },
            select: { stopId: true, side: true, createdAt: true },
        }),
        prisma.stickerPrint.groupBy({ by: ['stopId', 'side'], _count: { _all: true }, _max: { createdAt: true } }),
    ]);
    const key = (r) => `${r.stopId}|${r.side}`;
    const weekBy = new Map(week.map((r) => [key(r), r._count._all]));
    const monthBy = new Map(month.map((r) => [key(r), r._count._all]));
    const rows = all
        .map((r) => ({
        stopId: r.stopId,
        side: r.side,
        total: r._count._all,
        last7d: weekBy.get(key(r)) ?? 0,
        last30d: monthBy.get(key(r)) ?? 0,
        lastAt: r._max.createdAt ? r._max.createdAt.toISOString() : null,
    }))
        .sort((a, b) => b.total - a.total || b.last7d - a.last7d || a.stopId.localeCompare(b.stopId) || a.side.localeCompare(b.side));
    const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    const dayBy = new Map();
    const hourBy = new Map();
    for (const r of windowRows) {
        const { day, hour } = kyivDayHour(r.createdAt);
        const side = r.side;
        const dk = `${day}|${key(r)}`;
        const d = dayBy.get(dk) ?? { day, stopId: r.stopId, side, count: 0 };
        d.count += 1;
        dayBy.set(dk, d);
        const hk = `${hour}|${key(r)}`;
        const h = hourBy.get(hk) ?? { hour, stopId: r.stopId, side, count: 0 };
        h.count += 1;
        hourBy.set(hk, h);
    }
    const daily = [...dayBy.values()].sort((a, b) => a.day.localeCompare(b.day) || key(a).localeCompare(key(b)));
    const hourly = [...hourBy.values()].sort((a, b) => a.hour - b.hour || key(a).localeCompare(key(b)));
    const printed = prints
        .map((p) => ({
        stopId: p.stopId,
        side: p.side,
        count: p._count._all,
        lastAt: p._max.createdAt ? p._max.createdAt.toISOString() : null,
    }))
        .sort((a, b) => key(a).localeCompare(key(b)));
    return { rows, total: sum('total'), last7d: sum('last7d'), last30d: sum('last30d'), days, daily, hourly, printed };
}
const PRINT_SIZES = ['A5', 'A4'];
/** Body POST /admin/transport/sticker-prints: { stopId, sides: (a|b|s)[], size: A5|A4 } */
function parseStickerPrint(body) {
    const b = (body ?? {});
    const stopId = typeof b.stopId === 'string' ? b.stopId.trim() : '';
    if (!STOP_ID_RE.test(stopId))
        return null;
    if (!Array.isArray(b.sides) || b.sides.length === 0 || b.sides.length > exports.STICKER_SIDES.length)
        return null;
    const sides = [...new Set(b.sides)];
    if (!sides.every((x) => typeof x === 'string' && exports.STICKER_SIDES.includes(x)))
        return null;
    if (typeof b.size !== 'string' || !PRINT_SIZES.includes(b.size))
        return null;
    return { stopId, sides, size: b.size };
}
/** Адреса клієнта за проксі Railway (trust proxy не ввімкнено): перший X-Forwarded-For */
function clientKey(headers, fallbackIp) {
    const xff = headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    const ua = headers['user-agent'];
    return `${first || fallbackIp || '?'}|${(Array.isArray(ua) ? ua[0] : ua) ?? ''}`;
}
