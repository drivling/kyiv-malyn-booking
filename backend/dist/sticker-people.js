"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PERSON_STOPS = void 0;
exports.nextScanState = nextScanState;
exports.passengerNumber = passengerNumber;
exports.recordPersonScan = recordPersonScan;
exports.personSummary = personSummary;
exports.recordPersonReturn = recordPersonReturn;
exports.recordPersonTeaser = recordPersonTeaser;
exports.buildPeopleWall = buildPeopleWall;
exports.peopleWallSnapshot = peopleWallSnapshot;
exports.buildStickerPeople = buildStickerPeople;
exports.stickerPeopleStats = stickerPeopleStats;
const sticker_scans_1 = require("./sticker-scans");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Скільки різних зупинок памʼятаємо на людину (перша лишається завжди) */
exports.MAX_PERSON_STOPS = 200;
/** Скільки людей у стрічці стіни й у списку адмінки */
const LIST_LIMIT = 30;
const isUniqueViolation = (e) => e?.code === 'P2002';
const key = (cityCode, clientId) => ({ cityCode_clientId: { cityCode, clientId } });
/** Новий стан людини після зарахованого скану (чиста функція) */
function nextScanState(prev, scan) {
    const day = (0, sticker_scans_1.kyivDayHour)(scan.at).day;
    const stopIds = prev.stopIds.includes(scan.stopId)
        ? prev.stopIds
        : [...prev.stopIds, scan.stopId].filter((id, i, all) => i === 0 || all.length - i <= exports.MAX_PERSON_STOPS - 1);
    return {
        lastStopId: scan.stopId,
        lastSide: scan.side,
        lastAt: scan.at,
        scans: prev.scans + 1,
        stopIds,
        scanDays: prev.scanDays + (prev.lastScanDay === day ? 0 : 1),
        lastScanDay: day,
    };
}
/** Номер пасажира в місті: скільки людей міста зʼявилось не пізніше (id росте з часом появи) */
function passengerNumber(prisma, cityCode, id) {
    return prisma.stickerPerson.count({ where: { cityCode, id: { lte: id } } });
}
async function summary(prisma, row, isNew) {
    return {
        number: await passengerNumber(prisma, row.cityCode, row.id),
        scans: row.scans,
        stops: row.stopIds.length,
        firstStopId: row.firstStopId,
        firstAt: row.firstAt.toISOString(),
        isNew,
    };
}
/**
 * Зарахований скан наклейки з анонімним id: нова людина або оновлена історія. Гонку двох перших сканів одного браузера
 * (P2002 на create) вирішує один повтор — тоді це вже оновлення.
 */
async function recordPersonScan(prisma, scan) {
    const at = scan.at ?? new Date();
    for (let attempt = 0;; attempt += 1) {
        const prev = (await prisma.stickerPerson.findUnique({ where: key(scan.cityCode, scan.clientId) }));
        if (prev) {
            const row = (await prisma.stickerPerson.update({
                where: key(scan.cityCode, scan.clientId),
                data: nextScanState(prev, { stopId: scan.stopId, side: scan.side, at }),
            }));
            return summary(prisma, row, false);
        }
        try {
            const row = (await prisma.stickerPerson.create({
                data: {
                    cityCode: scan.cityCode,
                    clientId: scan.clientId,
                    firstStopId: scan.stopId,
                    firstSide: scan.side,
                    firstAt: at,
                    lastStopId: scan.stopId,
                    lastSide: scan.side,
                    lastAt: at,
                    scans: 1,
                    stopIds: [scan.stopId],
                    scanDays: 1,
                    lastScanDay: (0, sticker_scans_1.kyivDayHour)(at).day,
                },
            }));
            return summary(prisma, row, true);
        }
        catch (e) {
            if (!isUniqueViolation(e) || attempt > 0)
                throw e;
        }
    }
}
/** Скан без зарахування (повтор за 2 хв): номер і історія без змін; людини ще немає — null */
async function personSummary(prisma, cityCode, clientId) {
    const row = (await prisma.stickerPerson.findUnique({ where: key(cityCode, clientId) }));
    return row ? summary(prisma, row, false) : null;
}
/**
 * Людина повернулась на сайт (StickerReturn). Якщо скану з id не було (сканувала до 10.10.2026 або скан ще в черзі
 * офлайн) — людина зʼявляється з наклейки повернення, без зарахованих сканів.
 */
async function recordPersonReturn(prisma, ret) {
    const at = ret.at ?? new Date();
    for (let attempt = 0;; attempt += 1) {
        const prev = (await prisma.stickerPerson.findUnique({ where: key(ret.cityCode, ret.clientId) }));
        if (prev) {
            await prisma.stickerPerson.update({ where: key(ret.cityCode, ret.clientId), data: { returns: prev.returns + 1, lastReturnAt: at } });
            return;
        }
        try {
            await prisma.stickerPerson.create({
                data: {
                    cityCode: ret.cityCode,
                    clientId: ret.clientId,
                    firstStopId: ret.stopId,
                    firstSide: ret.side,
                    firstAt: at,
                    lastStopId: ret.stopId,
                    lastSide: ret.side,
                    lastAt: at,
                    scans: 0,
                    stopIds: [ret.stopId],
                    scanDays: 0,
                    lastScanDay: null,
                    returns: 1,
                    lastReturnAt: at,
                },
            });
            return;
        }
        catch (e) {
            if (!isUniqueViolation(e) || attempt > 0)
                throw e;
        }
    }
}
/** Людина досмотріла тизер «Доведе» перед табло — лише перший раз */
async function recordPersonTeaser(prisma, t) {
    await prisma.stickerPerson.updateMany({ where: { cityCode: t.cityCode, clientId: t.clientId, teaserAt: null }, data: { teaserAt: t.at ?? new Date() } });
}
// ---- Читання: стіна й адмінка
/** Остання дія людини: скан або повернення на сайт */
function lastActivity(p) {
    return p.lastReturnAt && p.lastReturnAt > p.lastAt ? { at: p.lastReturnAt, kind: 'return' } : { at: p.lastAt, kind: 'scan' };
}
/** Повертався: сканував у різні доби або відкривав сайт знову */
const isReturning = (p) => p.scanDays >= 2 || p.returns > 0;
/** Номери пасажирів міста: порядок id */
function numbers(persons) {
    return new Map([...persons].sort((a, b) => a.id - b.id).map((p, i) => [p.id, i + 1]));
}
/** Зведення для вкладки «Люди» на стіні (чиста функція) */
function buildPeopleWall(persons, now) {
    const day = (0, sticker_scans_1.kyivDayHour)(now).day;
    const yesterday = (0, sticker_scans_1.kyivDayHour)(new Date(now.getTime() - DAY_MS)).day;
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const d90Since = new Date(now.getTime() - 90 * DAY_MS);
    const num = numbers(persons);
    const firstDay = (p) => (0, sticker_scans_1.kyivDayHour)(p.firstAt).day;
    const returnDay = (p) => (p.lastReturnAt ? (0, sticker_scans_1.kyivDayHour)(p.lastReturnAt).day : null);
    let newToday = 0;
    let newYesterday = 0;
    let returnedToday = 0;
    let returned7d = 0;
    const d90 = { new: 0, returned: 0, multiStop: 0, teaser: 0 };
    for (const p of persons) {
        const fd = firstDay(p);
        if (fd === day)
            newToday += 1;
        if (fd === yesterday)
            newYesterday += 1;
        if (fd !== day && (p.lastScanDay === day || returnDay(p) === day))
            returnedToday += 1;
        const scannedAgain = p.scanDays >= 2 && p.lastAt >= weekAgo && p.lastScanDay !== fd;
        if (scannedAgain || (p.lastReturnAt && p.lastReturnAt >= weekAgo))
            returned7d += 1;
        if (p.firstAt >= d90Since) {
            d90.new += 1;
            if (isReturning(p))
                d90.returned += 1;
            if (p.stopIds.length >= 2)
                d90.multiStop += 1;
            if (p.teaserAt)
                d90.teaser += 1;
        }
    }
    const people = [...persons]
        .map((p) => ({ p, last: lastActivity(p) }))
        .sort((a, b) => b.last.at.getTime() - a.last.at.getTime() || b.p.id - a.p.id)
        .slice(0, LIST_LIMIT)
        .map(({ p, last }) => ({
        number: num.get(p.id) ?? 0,
        who: p.clientId.slice(-4),
        firstStopId: p.firstStopId,
        lastStopId: p.lastStopId,
        stops: p.stopIds.length,
        scans: p.scans,
        scanDays: p.scanDays,
        returns: p.returns,
        isNew: firstDay(p) === day,
        kind: last.kind,
        at: last.at.toISOString(),
        teaser: p.teaserAt !== null,
    }));
    return {
        now: now.toISOString(),
        day,
        total: persons.length,
        today: { new: newToday, returned: returnedToday },
        yesterday: { new: newYesterday },
        returned7d,
        d90,
        people,
    };
}
const PERSON_SELECT = {
    id: true,
    cityCode: true,
    clientId: true,
    firstStopId: true,
    firstSide: true,
    firstAt: true,
    lastStopId: true,
    lastSide: true,
    lastAt: true,
    scans: true,
    stopIds: true,
    scanDays: true,
    lastScanDay: true,
    returns: true,
    lastReturnAt: true,
    teaserAt: true,
};
/** Усі люди міста — їх небагато (сотні), читаються одним запитом */
function cityPeople(prisma, cityCode) {
    return prisma.stickerPerson.findMany({ where: { cityCode }, select: PERSON_SELECT });
}
async function peopleWallSnapshot(prisma, opts) {
    return buildPeopleWall(await cityPeople(prisma, opts.cityCode), opts.now ?? new Date());
}
/** Статистика для підвкладки «Люди» в адмінці (чиста функція) */
function buildStickerPeople(persons, now, days) {
    const today = (0, sticker_scans_1.kyivDayHour)(now).day;
    const since = new Date(now.getTime() - days * DAY_MS);
    const num = numbers(persons);
    const fresh = persons.filter((p) => (days === 1 ? (0, sticker_scans_1.kyivDayHour)(p.firstAt).day === today : p.firstAt >= since));
    const daily = new Map();
    const firstStops = new Map();
    for (const p of fresh) {
        const d = (0, sticker_scans_1.kyivDayHour)(p.firstAt).day;
        daily.set(d, (daily.get(d) ?? 0) + 1);
        firstStops.set(p.firstStopId, (firstStops.get(p.firstStopId) ?? 0) + 1);
    }
    const people = [...persons]
        .map((p) => ({ p, last: lastActivity(p).at }))
        .sort((a, b) => b.p.stopIds.length - a.p.stopIds.length || b.p.scanDays - a.p.scanDays || b.last.getTime() - a.last.getTime())
        .slice(0, LIST_LIMIT)
        .map(({ p, last }) => ({
        number: num.get(p.id) ?? 0,
        who: p.clientId.slice(-4),
        firstStopId: p.firstStopId,
        firstAt: p.firstAt.toISOString(),
        lastAt: last.toISOString(),
        scans: p.scans,
        stopIds: p.stopIds,
        scanDays: p.scanDays,
        returns: p.returns,
        teaser: p.teaserAt !== null,
    }));
    return {
        days,
        total: persons.length,
        newInPeriod: fresh.length,
        returning: persons.filter(isReturning).length,
        multiStop: persons.filter((p) => p.stopIds.length >= 2).length,
        teaser: persons.filter((p) => p.teaserAt !== null).length,
        daily: [...daily.entries()].map(([d, count]) => ({ day: d, count })).sort((a, b) => a.day.localeCompare(b.day)),
        firstStops: [...firstStops.entries()].map(([stopId, count]) => ({ stopId, count })).sort((a, b) => b.count - a.count || a.stopId.localeCompare(b.stopId)),
        people,
    };
}
async function stickerPeopleStats(prisma, opts) {
    return buildStickerPeople(await cityPeople(prisma, opts.cityCode), opts.now ?? new Date(), opts.days);
}
