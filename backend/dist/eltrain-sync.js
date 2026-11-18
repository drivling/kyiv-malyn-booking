"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_TRAINS_PER_PAGE = exports.ELTRAIN_SOURCES = void 0;
exports.cityHasStation = cityHasStation;
exports.rowForTrain = rowForTrain;
exports.rowsForPair = rowsForPair;
exports.planPair = planPair;
exports.inheritPrice = inheritPrice;
exports.looksLikeBadParse = looksLikeBadParse;
exports.runEltrainSync = runEltrainSync;
exports.reportHasChanges = reportHasChanges;
exports.reportHasProblems = reportHasProblems;
exports.eltrainSyncAlertHtml = eltrainSyncAlertHtml;
exports.eltrainSyncSummary = eltrainSyncSummary;
exports.problemSignature = problemSignature;
exports.createEltrainSyncTick = createEltrainSyncTick;
const swrailway_eltrain_1 = require("./swrailway-eltrain");
const schedule_trip_1 = require("./schedule-trip");
const RID68 = 'https://swrailway.gov.ua/timetable/eltrain/?gid=1&rid=68';
/** Лінія Київ – Тетерів – Коростень: `reverse=1` — з Києва, `reverse=2` — до Києва. */
exports.ELTRAIN_SOURCES = [
    {
        url: `${RID68}&reverse=1&half=1&count=4`,
        pairs: [
            { from: 'Kyiv', to: 'Malyn' },
            { from: 'Kyiv', to: 'Korosten' },
            { from: 'Malyn', to: 'Korosten' },
        ],
    },
    {
        url: `${RID68}&reverse=2&half=1&count=4`,
        pairs: [
            { from: 'Korosten', to: 'Malyn' },
            { from: 'Korosten', to: 'Kyiv' },
            { from: 'Malyn', to: 'Kyiv' },
        ],
    },
];
/** Сторінка, з якої розібрано менше поїздів, вважається зламаною. */
exports.MIN_TRAINS_PER_PAGE = 3;
const lower = (s) => (0, swrailway_eltrain_1.normalizeStationName)(s).toLowerCase();
/**
 * Станції міста на лінії. Київ — будь-яка київська станція (поїзди починають і закінчують на різних:
 * Київ-Пас., Святошин, Борщагівка); посадка — перша з них у напрямку руху, висадка — остання.
 */
const CITY_STATION = {
    Kyiv: (s) => /київ|святошин|борщаг|караваєв|біличі/.test(lower(s)),
    Malyn: (s) => lower(s) === 'малин',
    Korosten: (s) => lower(s) === 'коростень',
};
function cityHasStation(code) {
    return code in CITY_STATION;
}
/** Рядок пари для одного поїзда: посадка — перша станція міста «звідки» з відправленням, висадка — остання станція «куди» після неї. */
function rowForTrain(train, pair) {
    const isFrom = CITY_STATION[pair.from];
    const isTo = CITY_STATION[pair.to];
    if (!isFrom || !isTo)
        return null;
    const boardIdx = train.stops.findIndex((s) => isFrom(s.name) && s.departure);
    if (boardIdx < 0)
        return null;
    let alightIdx = -1;
    for (let i = boardIdx + 1; i < train.stops.length; i++) {
        const s = train.stops[i];
        if (isTo(s.name) && (s.arrival || s.departure))
            alightIdx = i;
    }
    if (alightIdx < 0)
        return null;
    const board = train.stops[boardIdx];
    const alight = train.stops[alightIdx];
    const departureTime = board.departure;
    const arrivalTime = (alight.arrival || alight.departure);
    return {
        tripNumber: train.tripNumber,
        departureTime,
        arrivalTime,
        durationMinutes: (0, swrailway_eltrain_1.durationMinutesBetween)(departureTime, arrivalTime),
        activeWeekdays: (0, schedule_trip_1.normalizeActiveWeekdays)(train.activeWeekdays),
        boardingPlace: (0, swrailway_eltrain_1.normalizeStationName)(board.name),
        alightingPlace: (0, swrailway_eltrain_1.normalizeStationName)(alight.name),
    };
}
/**
 * Усі рядки пари зі сторінки. Однакові рейси з різними днями зливаються в один (два 6621 — з Борщагівки
 * у вихідні й зі Святошина в будні — від Малина до Коростеня їдуть однаково: один рядок щодня).
 */
function rowsForPair(trains, pair) {
    const byKey = new Map();
    for (const t of trains) {
        const row = rowForTrain(t, pair);
        if (!row)
            continue;
        const key = [row.tripNumber, row.departureTime, row.arrivalTime, row.boardingPlace, row.alightingPlace].join('|');
        const prev = byKey.get(key);
        if (prev) {
            prev.activeWeekdays = (0, schedule_trip_1.normalizeActiveWeekdays)([...prev.activeWeekdays, ...row.activeWeekdays]);
        }
        else {
            byKey.set(key, row);
        }
    }
    return [...byKey.values()].sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}
const FIELDS = [
    'tripNumber',
    'departureTime',
    'arrivalTime',
    'durationMinutes',
    'boardingPlace',
    'alightingPlace',
];
function sameRow(a, b) {
    if (FIELDS.some((f) => (a[f] ?? null) !== (b[f] ?? null)))
        return false;
    const da = (0, schedule_trip_1.normalizeActiveWeekdays)(a.activeWeekdays);
    const db = (0, schedule_trip_1.normalizeActiveWeekdays)(b.activeWeekdays);
    return da.length === db.length && da.every((d, i) => d === db[i]);
}
function pickRow(r) {
    return {
        tripNumber: r.tripNumber,
        departureTime: r.departureTime,
        arrivalTime: r.arrivalTime,
        durationMinutes: r.durationMinutes,
        activeWeekdays: (0, schedule_trip_1.normalizeActiveWeekdays)(r.activeWeekdays),
        boardingPlace: r.boardingPlace,
        alightingPlace: r.alightingPlace,
    };
}
const digits = (s) => String(s ?? '').replace(/[^\d]/g, '');
/**
 * Що змінити в рядках пари. Зіставлення: номер + час відправлення → номер + станція посадки → номер,
 * коли з таким номером лишився один рядок з кожного боку. Решта сторінки — нові, решта бази — скасовані.
 */
function planPair(desired, existing) {
    const leftD = desired.map((r) => pickRow(r));
    const leftE = [...existing];
    const pairs = [];
    const take = (match, onlySingle = false) => {
        for (let i = 0; i < leftD.length;) {
            const d = leftD[i];
            const candidates = leftE.filter((e) => match(d, e));
            const sameNumberD = leftD.filter((x) => digits(x.tripNumber) === digits(d.tripNumber));
            if (candidates.length === 1 && (!onlySingle || sameNumberD.length === 1)) {
                pairs.push([d, candidates[0]]);
                leftE.splice(leftE.indexOf(candidates[0]), 1);
                leftD.splice(i, 1);
            }
            else {
                i++;
            }
        }
    };
    const sameNumber = (d, e) => digits(d.tripNumber) === digits(e.tripNumber);
    take((d, e) => sameNumber(d, e) && d.departureTime === e.departureTime);
    take((d, e) => sameNumber(d, e) && lower(d.boardingPlace) === lower(e.boardingPlace ?? ''));
    take(sameNumber, true);
    const update = [];
    let unchanged = 0;
    for (const [d, e] of pairs) {
        const before = pickRow(e);
        if (sameRow(before, d))
            unchanged++;
        else
            update.push({ id: e.id, before, after: d });
    }
    return { create: leftD, update, remove: leftE, unchanged };
}
/** Ціна нового рейсу — найчастіша ціна пари серед поїздів того ж класу (3 цифри — регіональний, 4 — приміський). */
function inheritPrice(tripNumber, existing) {
    const cls = digits(tripNumber).length;
    const counts = new Map();
    for (const e of existing) {
        if (e.priceUah == null || digits(e.tripNumber).length !== cls)
            continue;
        counts.set(e.priceUah, (counts.get(e.priceUah) ?? 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [price, n] of counts) {
        if (n > bestCount) {
            best = price;
            bestCount = n;
        }
    }
    return best;
}
/** Пара втратила б більшу частину рейсів — найімовірніше, сторінку розібрано не так. */
function looksLikeBadParse(plan, existingCount) {
    if (existingCount === 0)
        return false;
    return plan.remove.length > Math.max(2, Math.floor(existingCount / 2));
}
const MANAGED_SELECT = {
    id: true,
    tripNumber: true,
    departureTime: true,
    arrivalTime: true,
    durationMinutes: true,
    activeWeekdays: true,
    boardingPlace: true,
    alightingPlace: true,
    priceUah: true,
    ticketPurchaseUrl: true,
};
function toExisting(s) {
    return {
        id: s.id,
        tripNumber: s.tripNumber ?? '',
        departureTime: s.departureTime,
        arrivalTime: s.arrivalTime ?? '',
        durationMinutes: s.durationMinutes,
        activeWeekdays: (0, schedule_trip_1.normalizeActiveWeekdays)(s.activeWeekdays),
        boardingPlace: s.boardingPlace ?? '',
        alightingPlace: s.alightingPlace ?? '',
        priceUah: s.priceUah,
        ticketPurchaseUrl: s.ticketPurchaseUrl,
    };
}
/** Час рейсу, поки інший рейс того ж маршруту переїжджає на його місце (унікальність tripRouteId + час). */
const parkedTime = (id) => `~${id}`;
async function syncPair(prisma, url, pair, trains, opts) {
    const slug = (0, schedule_trip_1.buildLegacyRouteKey)(pair.from, pair.to, []);
    const report = {
        url,
        route: slug,
        status: 'ok',
        created: [],
        updated: [],
        removed: [],
        unchanged: 0,
        conflicts: [],
    };
    const tripRoute = await prisma.tripRoute.findUnique({ where: { slug } });
    if (!tripRoute) {
        return { ...report, status: 'error', reason: `Маршруту ${slug} немає в базі (адмінка → «Маршрути»)` };
    }
    const desired = rowsForPair(trains, pair);
    const managed = await prisma.schedule.findMany({
        where: { tripRouteId: tripRoute.id, vehicleType: 'elektrichka', timetableSourceUrl: url },
        select: MANAGED_SELECT,
        orderBy: { departureTime: 'asc' },
    });
    const existing = managed.map(toExisting);
    if (desired.length === 0) {
        return existing.length
            ? { ...report, status: 'skipped', reason: 'на сторінці жодного поїзда цієї пари — нічого не чіпаю' }
            : report;
    }
    const plan = planPair(desired, existing);
    report.unchanged = plan.unchanged;
    if (!opts.force && looksLikeBadParse(plan, existing.length)) {
        const gone = plan.remove.map((r) => `№${r.tripNumber} ${r.departureTime}`).join(', ');
        return {
            ...report,
            status: 'skipped',
            reason: `зникло б ${plan.remove.length} з ${existing.length} рейсів (${gone}) — схоже на збій сторінки, нічого не змінено; застосувати можна вручну з force`,
        };
    }
    // Час, зайнятий рядком того ж маршруту, якого синхронізація не веде (маршрутка, ручна електричка)
    const foreign = await prisma.schedule.findMany({
        where: { tripRouteId: tripRoute.id, NOT: { id: { in: managed.map((m) => m.id) } } },
        select: { id: true, departureTime: true, vehicleType: true },
    });
    const foreignAt = new Map(foreign.map((f) => [f.departureTime, f]));
    const clash = (row) => {
        const f = foreignAt.get(row.departureTime);
        return f ? `час ${row.departureTime} уже зайнятий рядком #${f.id} (${f.vehicleType}) цього маршруту` : null;
    };
    const updates = plan.update.filter((u) => {
        const err = clash(u.after);
        if (err)
            report.conflicts.push({ row: u.after, error: err });
        return !err;
    });
    const creates = plan.create.filter((row) => {
        const err = clash(row);
        if (err)
            report.conflicts.push({ row, error: err });
        return !err;
    });
    // Бронювань на електрички немає (сайт їх не приймає), але FK Restrict — перевіряємо
    const removable = [];
    for (const r of plan.remove) {
        const bookings = await prisma.booking.count({ where: { scheduleId: r.id } });
        if (bookings > 0)
            report.conflicts.push({ row: pickRow(r), error: `рейс скасовано, але має ${bookings} бронювань — не видаляю` });
        else
            removable.push(r);
    }
    report.created = creates;
    report.updated = updates;
    report.removed = removable.map(pickRow);
    if (opts.dryRun || (!creates.length && !updates.length && !removable.length))
        return report;
    const ticketPurchaseUrl = existing.find((e) => e.ticketPurchaseUrl)?.ticketPurchaseUrl ?? opts.fallbackTicketUrl;
    if (creates.length && !ticketPurchaseUrl) {
        return { ...report, status: 'error', reason: 'немає посилання на квитки для нових рейсів (ticketPurchaseUrl)', created: [] };
    }
    await prisma.$transaction(async (tx) => {
        if (removable.length)
            await tx.schedule.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } });
        const moving = updates.filter((u) => u.before.departureTime !== u.after.departureTime);
        for (const u of moving) {
            await tx.schedule.update({ where: { id: u.id }, data: { departureTime: parkedTime(u.id) } });
        }
        for (const u of updates) {
            await tx.schedule.update({
                where: { id: u.id },
                data: {
                    tripNumber: u.after.tripNumber,
                    departureTime: u.after.departureTime,
                    arrivalTime: u.after.arrivalTime,
                    durationMinutes: u.after.durationMinutes,
                    activeWeekdays: u.after.activeWeekdays,
                    boardingPlace: u.after.boardingPlace,
                    alightingPlace: u.after.alightingPlace,
                },
            });
        }
        for (const row of creates) {
            await tx.schedule.create({
                data: {
                    route: slug,
                    tripRouteId: tripRoute.id,
                    startPointId: tripRoute.startPointId,
                    endPointId: tripRoute.endPointId,
                    viaPointIds: [],
                    vehicleType: 'elektrichka',
                    tripNumber: row.tripNumber,
                    departureTime: row.departureTime,
                    arrivalTime: row.arrivalTime,
                    durationMinutes: row.durationMinutes,
                    activeWeekdays: row.activeWeekdays,
                    boardingPlace: row.boardingPlace,
                    alightingPlace: row.alightingPlace,
                    priceUah: inheritPrice(row.tripNumber, existing),
                    ticketPurchaseUrl,
                    timetableSourceUrl: url,
                },
            });
        }
    });
    return report;
}
/** Синхронізує всі пари всіх сторінок. Помилка однієї сторінки не зупиняє інші. */
async function runEltrainSync(prisma, deps = {}) {
    const sources = deps.sources ?? exports.ELTRAIN_SOURCES;
    const fetchPage = deps.fetchPage ?? swrailway_eltrain_1.fetchEltrainPage;
    const dryRun = Boolean(deps.dryRun);
    const force = Boolean(deps.force);
    const report = { dryRun, pairs: [], errors: [] };
    const anyTicket = await prisma.schedule.findFirst({
        where: { vehicleType: 'elektrichka', NOT: { ticketPurchaseUrl: null } },
        select: { ticketPurchaseUrl: true },
        orderBy: { id: 'asc' },
    });
    for (const source of sources) {
        let trains;
        try {
            trains = (0, swrailway_eltrain_1.parseEltrainTimetable)(await fetchPage(source.url));
        }
        catch (e) {
            report.errors.push({ url: source.url, error: e instanceof Error ? e.message : String(e) });
            continue;
        }
        if (trains.length < exports.MIN_TRAINS_PER_PAGE) {
            report.errors.push({ url: source.url, error: `розібрано лише ${trains.length} поїздів — сторінка змінилась або не завантажилась` });
            continue;
        }
        for (const pair of source.pairs) {
            try {
                report.pairs.push(await syncPair(prisma, source.url, pair, trains, {
                    dryRun,
                    force,
                    fallbackTicketUrl: anyTicket?.ticketPurchaseUrl ?? null,
                }));
            }
            catch (e) {
                report.pairs.push({
                    url: source.url,
                    route: (0, schedule_trip_1.buildLegacyRouteKey)(pair.from, pair.to, []),
                    status: 'error',
                    reason: e instanceof Error ? e.message : String(e),
                    created: [],
                    updated: [],
                    removed: [],
                    unchanged: 0,
                    conflicts: [],
                });
            }
        }
    }
    return report;
}
function reportHasChanges(r) {
    return r.pairs.some((p) => p.created.length || p.updated.length || p.removed.length);
}
function reportHasProblems(r) {
    return r.errors.length > 0 || r.pairs.some((p) => p.status !== 'ok' || p.conflicts.length > 0);
}
const ROUTE_UK = { Kyiv: 'Київ', Malyn: 'Малин', Korosten: 'Коростень' };
const DAY_UK = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
function routeUk(slug) {
    const [a, b] = slug.split('-');
    return `${ROUTE_UK[a] ?? a} → ${ROUTE_UK[b] ?? b}`;
}
function daysUk(days) {
    const d = (0, schedule_trip_1.normalizeActiveWeekdays)(days);
    if (d.length === 7)
        return 'щодня';
    return d.map((x) => DAY_UK[x]).join(',');
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function rowLine(r) {
    return `№${esc(r.tripNumber)} ${r.departureTime}→${r.arrivalTime || '?'} (${daysUk(r.activeWeekdays)}, ${esc(r.boardingPlace)} → ${esc(r.alightingPlace || '?')})`;
}
/** Повідомлення в адмін-чат: що змінилось і що не вдалось. */
function eltrainSyncAlertHtml(r) {
    const title = reportHasChanges(r)
        ? r.dryRun
            ? '🚆 <b>Розклад електричок (ПЗЗ): що змінилось би</b>'
            : '🚆 <b>Розклад електричок (ПЗЗ) оновлено</b>'
        : '⚠️ <b>Розклад електричок (ПЗЗ): не все вдалось оновити</b>';
    const lines = [title];
    for (const p of r.pairs) {
        const part = [];
        for (const c of p.created)
            part.push(`  ➕ ${rowLine(c)}`);
        for (const u of p.updated)
            part.push(`  ✏️ ${rowLine(u.before)} → ${rowLine(u.after)}`);
        for (const x of p.removed)
            part.push(`  ➖ ${rowLine(x)}`);
        for (const c of p.conflicts)
            part.push(`  ⚠️ ${rowLine(c.row)}: ${esc(c.error)}`);
        if (p.status !== 'ok')
            part.push(`  ⚠️ ${esc(p.reason ?? p.status)}`);
        if (part.length)
            lines.push('', `<b>${routeUk(p.route)}</b>`, ...part);
    }
    for (const e of r.errors)
        lines.push('', `⚠️ ${esc(e.url)}: ${esc(e.error)}`);
    return lines.join('\n');
}
function eltrainSyncSummary(r) {
    const sum = (f) => r.pairs.reduce((n, p) => n + f(p), 0);
    return (`нових ${sum((p) => p.created.length)}, змінено ${sum((p) => p.updated.length)}, ` +
        `прибрано ${sum((p) => p.removed.length)}, без змін ${sum((p) => p.unchanged)}, ` +
        `проблем ${r.errors.length + r.pairs.filter((p) => p.status !== 'ok' || p.conflicts.length).length}`);
}
/** Відбиток проблем звіту: та сама проблема на кожному тіку не шле повідомлення повторно. */
function problemSignature(r) {
    const parts = [
        ...r.errors.map((e) => `${e.url}:${e.error}`),
        ...r.pairs.filter((p) => p.status !== 'ok').map((p) => `${p.route}:${p.status}:${p.reason ?? ''}`),
        ...r.pairs.flatMap((p) => p.conflicts.map((c) => `${p.route}:${c.row.tripNumber}:${c.row.departureTime}:${c.error}`)),
    ];
    return parts.sort().join('\n');
}
/**
 * Тік фонової задачі: синхронізує й повідомляє адмін-чат про зміни; про проблеми — лише коли їхній склад
 * змінився з минулого повідомлення (стан у пам'яті процесу, після деплою — одне повторне).
 */
function createEltrainSyncTick(prisma, deps) {
    let lastProblems = '';
    const log = deps.log ?? ((m) => console.log(m));
    return async () => {
        const report = await runEltrainSync(prisma, { fetchPage: deps.fetchPage });
        const problems = problemSignature(report);
        const newProblems = problems !== '' && problems !== lastProblems;
        if (reportHasChanges(report) || newProblems) {
            log(`🚆 Електрички ПЗЗ: ${eltrainSyncSummary(report)}`);
            await deps.notify(eltrainSyncAlertHtml(report));
        }
        lastProblems = problems;
        return report;
    };
}
