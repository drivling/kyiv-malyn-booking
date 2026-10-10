"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATS_DAYS = exports.RETURN_VIA = exports.STICKER_SIDES = void 0;
exports.parseStickerScan = parseStickerScan;
exports.parseStickerReturn = parseStickerReturn;
exports.createScanDeduper = createScanDeduper;
exports.parseStatsDays = parseStatsDays;
exports.kyivDayHour = kyivDayHour;
exports.stickerScanStats = stickerScanStats;
exports.buildAudience = buildAudience;
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
/** Анонімний id браузера з localStorage (frontend visitorId.ts) */
const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
function clientIdOf(v) {
    const id = typeof v === 'string' ? v.trim() : '';
    return CLIENT_ID_RE.test(id) ? id : null;
}
/** Body POST /transport/sticker-scans: { stopId, side: a|b|s, clientId? } (невалідний clientId — null) */
function parseStickerScan(body) {
    const b = (body ?? {});
    const stopId = typeof b.stopId === 'string' ? b.stopId.trim() : '';
    const side = typeof b.side === 'string' ? b.side.trim() : '';
    if (!STOP_ID_RE.test(stopId))
        return null;
    if (!exports.STICKER_SIDES.includes(side))
        return null;
    return { stopId, side: side, clientId: clientIdOf(b.clientId) };
}
/** reload — відновлена вкладка табло з utm_source=reload; tab — повернулись до відкритої вкладки; direct — відкрили сайт інакше */
exports.RETURN_VIA = ['reload', 'tab', 'direct'];
const PAGE_RE = /^[a-z0-9-]{1,30}$/;
/**
 * Body POST /transport/sticker-returns: { stopId, side — наклейка, з якої людина прийшла вперше,
 * clientId (обовʼязковий: без нього не порахувати людей), via: reload|tab|direct, page }.
 */
function parseStickerReturn(body) {
    const b = (body ?? {});
    const scan = parseStickerScan(body);
    const clientId = clientIdOf(b.clientId);
    const via = typeof b.via === 'string' ? b.via : '';
    const page = typeof b.page === 'string' ? b.page.trim().toLowerCase() : '';
    if (!scan || !clientId)
        return null;
    if (!exports.RETURN_VIA.includes(via))
        return null;
    return { stopId: scan.stopId, side: scan.side, clientId, via: via, page: PAGE_RE.test(page) ? page : 'other' };
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
/** 1 — «сьогодні»: київська доба від півночі, а не останні 24 години */
exports.STATS_DAYS = [1, 7, 30, 90];
/** ?days= графіків: 1 (сьогодні) | 7 | 30 | 90, інше — 30 */
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
 * Статистика наклейок: агрегати по наклейках (зупинка + бік: усього, сьогодні, за 7 і 30 днів, останнє
 * відкриття; популярні — першими), відкриття по київських добах і годинах за вікно `days` для
 * графіків адмінки та облік друку. Сканів небагато, тож вікно читається сирими рядками й
 * розкладається по бакетах тут — київський час без SQL-часових поясів.
 */
async function stickerScanStats(prisma, opts = {}) {
    const now = opts.now ?? new Date();
    const days = opts.days ?? 30;
    const since = (n) => new Date(now.getTime() - n * DAY_MS);
    const [all, week, month, windowRows, prints, idScans, returns] = await Promise.all([
        prisma.stickerScan.groupBy({ by: ['stopId', 'side'], _count: { _all: true }, _max: { createdAt: true } }),
        prisma.stickerScan.groupBy({ by: ['stopId', 'side'], where: { createdAt: { gte: since(7) } }, _count: { _all: true } }),
        prisma.stickerScan.groupBy({ by: ['stopId', 'side'], where: { createdAt: { gte: since(30) } }, _count: { _all: true } }),
        // «Сьогодні»: київська доба триває до 25 год (перехід на зимовий час) — беремо 2 доби й
        // відсікаємо за київською датою нижче
        prisma.stickerScan.findMany({
            where: { createdAt: { gte: since(Math.max(days, 2)) } },
            select: { stopId: true, side: true, createdAt: true },
        }),
        prisma.stickerPrint.groupBy({ by: ['stopId', 'side'], _count: { _all: true }, _max: { createdAt: true } }),
        prisma.stickerScan.findMany({ where: { clientId: { not: null } }, select: { stopId: true, side: true, clientId: true } }),
        prisma.stickerReturn.findMany({ select: { stopId: true, side: true, clientId: true, via: true, createdAt: true } }),
    ]);
    const key = (r) => `${r.stopId}|${r.side}`;
    const weekBy = new Map(week.map((r) => [key(r), r._count._all]));
    const monthBy = new Map(month.map((r) => [key(r), r._count._all]));
    const todayKyiv = kyivDayHour(now).day;
    const stamped = windowRows.map((r) => ({ ...r, ...kyivDayHour(r.createdAt) }));
    const todayBy = new Map();
    for (const r of stamped)
        if (r.day === todayKyiv)
            todayBy.set(key(r), (todayBy.get(key(r)) ?? 0) + 1);
    const inWindow = days === 1 ? stamped.filter((r) => r.day === todayKyiv) : stamped.filter((r) => r.createdAt >= since(days));
    const rows = all
        .map((r) => ({
        stopId: r.stopId,
        side: r.side,
        total: r._count._all,
        today: todayBy.get(key(r)) ?? 0,
        last7d: weekBy.get(key(r)) ?? 0,
        last30d: monthBy.get(key(r)) ?? 0,
        lastAt: r._max.createdAt ? r._max.createdAt.toISOString() : null,
    }))
        .sort((a, b) => b.total - a.total || b.last7d - a.last7d || a.stopId.localeCompare(b.stopId) || a.side.localeCompare(b.side));
    const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    const dayBy = new Map();
    const hourBy = new Map();
    for (const r of inWindow) {
        const { day, hour } = r;
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
    const returnsInWindow = days === 1 ? returns.filter((r) => kyivDayHour(r.createdAt).day === todayKyiv) : returns.filter((r) => r.createdAt >= since(days));
    const audience = buildAudience(idScans, returns, returnsInWindow);
    return {
        rows,
        audience,
        total: sum('total'),
        today: sum('today'),
        last7d: sum('last7d'),
        last30d: sum('last30d'),
        days,
        daily,
        hourly,
        printed,
    };
}
/** Унікальні люди по наклейках: сканували (StickerScan з clientId) і повертались (StickerReturn) */
function buildAudience(scans, returns, returnsInWindow) {
    const key = (r) => `${r.stopId}|${r.side}`;
    const by = new Map();
    const acc = (r) => {
        const k = key(r);
        let a = by.get(k);
        if (!a) {
            a = { stopId: r.stopId, side: r.side, scanners: new Set(), returning: new Set(), returns: 0 };
            by.set(k, a);
        }
        return a;
    };
    const scanners = new Set();
    const returning = new Set();
    for (const s of scans) {
        if (!s.clientId)
            continue;
        acc(s).scanners.add(s.clientId);
        scanners.add(s.clientId);
    }
    for (const r of returns) {
        acc(r).returning.add(r.clientId);
        returning.add(r.clientId);
    }
    const byVia = { reload: 0, tab: 0, direct: 0 };
    for (const r of returnsInWindow) {
        acc(r).returns += 1;
        if (exports.RETURN_VIA.includes(r.via))
            byVia[r.via] += 1;
    }
    const rows = [...by.values()]
        .map((a) => ({ stopId: a.stopId, side: a.side, scanners: a.scanners.size, returning: a.returning.size, returns: a.returns }))
        .sort((a, b) => b.returning - a.returning || b.scanners - a.scanners || key(a).localeCompare(key(b)));
    return { scanners: scanners.size, returning: returning.size, returns: returnsInWindow.length, byVia, rows };
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
