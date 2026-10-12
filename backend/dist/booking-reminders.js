"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultReminderDeps = exports.SOON_CATCHUP_MS = exports.EVENING_MORNING_CATCHUP_MS = exports.SOON_LONG_MS = exports.MIN_LEAD_MS = exports.MORNING_HOUR = exports.EVENING_HOUR = void 0;
exports.bookingDepartureAt = bookingDepartureAt;
exports.planReminders = planReminders;
exports.dueReminders = dueReminders;
exports.kyivTodayStart = kyivTodayStart;
exports.runDueBookingReminders = runDueBookingReminders;
exports.sendManualReminders = sendManualReminders;
const viber_listing_expiry_1 = require("./viber-listing-expiry");
const telegram_1 = require("./telegram");
const MIN = 60000;
exports.EVENING_HOUR = 20;
exports.MORNING_HOUR = 8;
/** Ранкове нагадування має сенс, лише якщо до поїздки лишається щонайменше стільки. */
exports.MIN_LEAD_MS = 30 * MIN;
exports.SOON_LONG_MS = 120 * MIN;
/** Скільки після запланованого часу ще вважаємо нагадування актуальним. */
exports.EVENING_MORNING_CATCHUP_MS = 90 * MIN;
exports.SOON_CATCHUP_MS = 15 * MIN;
const KIND_WHEN = {
    evening: 'tomorrow',
    morning: 'today',
    soon_120: 'in2h',
    soon_30: 'in30m',
};
/** Момент відправлення (UTC) з київського "HH:MM"; null — час не розпізнано. */
function bookingDepartureAt(date, departureTime) {
    const m = departureTime.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m)
        return null;
    return (0, viber_listing_expiry_1.kyivWallToUtc)(date.getFullYear(), date.getMonth(), date.getDate(), Number(m[1]), Number(m[2]));
}
/**
 * Усі нагадування, що можуть існувати для броні (з їхнім часом). `soon` є лише якщо evening і morning
 * бронь не покривають. Прострочені/неактуальні відсіює `dueReminders`.
 */
function planReminders(b) {
    const y = b.date.getFullYear();
    const mo = b.date.getMonth();
    const d = b.date.getDate();
    const departure = bookingDepartureAt(b.date, b.departureTime);
    const eveningAt = (0, viber_listing_expiry_1.kyivWallToUtc)(y, mo, d - 1, exports.EVENING_HOUR, 0);
    const morningAt = (0, viber_listing_expiry_1.kyivWallToUtc)(y, mo, d, exports.MORNING_HOUR, 0);
    const plans = [];
    const eveningCovers = b.createdAt < eveningAt;
    const morningCovers = b.createdAt < morningAt && (!departure || departure.getTime() - morningAt.getTime() >= exports.MIN_LEAD_MS);
    if (eveningCovers)
        plans.push({ kind: 'evening', at: eveningAt });
    if (morningCovers)
        plans.push({ kind: 'morning', at: morningAt });
    if (!eveningCovers && !morningCovers && departure) {
        const untilDeparture = departure.getTime() - b.createdAt.getTime();
        if (untilDeparture >= exports.SOON_LONG_MS) {
            plans.push({ kind: 'soon_120', at: new Date(departure.getTime() - exports.SOON_LONG_MS) });
        }
        else if (untilDeparture >= exports.MIN_LEAD_MS) {
            plans.push({ kind: 'soon_30', at: new Date(departure.getTime() - exports.MIN_LEAD_MS) });
        }
    }
    return plans;
}
/** Нагадування, які треба надіслати саме зараз. */
function dueReminders(b, now) {
    const departure = bookingDepartureAt(b.date, b.departureTime);
    const t = now.getTime();
    return planReminders(b)
        .filter(({ kind, at }) => {
        const catchup = kind.startsWith('soon') ? exports.SOON_CATCHUP_MS : exports.EVENING_MORNING_CATCHUP_MS;
        if (t < at.getTime() || t > at.getTime() + catchup)
            return false;
        if (!departure)
            return true;
        // після відправлення — нізащо; evening/morning ще й не пізніше ніж за 30 хв до поїздки
        return kind.startsWith('soon') ? t < departure.getTime() : departure.getTime() - t >= exports.MIN_LEAD_MS;
    })
        .map((p) => p.kind);
}
exports.defaultReminderDeps = {
    isEnabled: telegram_1.isTelegramEnabled,
    sendBot: telegram_1.sendTripReminderVia,
    sendSmsOnly: telegram_1.sendTripReminderSmsOnly,
};
const emptyCounters = () => ({ total: 0, sent: 0, smsSent: 0, failed: 0, skipped: 0, duplicate: 0 });
function toReminderBooking(b) {
    return {
        route: b.route,
        source: b.source,
        date: b.date,
        departureTime: b.departureTime,
        name: b.name,
        driver: b.viberListing ? { senderName: b.viberListing.senderName, phone: b.viberListing.phone } : undefined,
        personId: b.personId,
        phone: b.phone,
        bookingId: b.id,
    };
}
/** Захоплює (bookingId, kind) і шле; повертає false, якщо це нагадування вже було. */
async function claimAndSend(prisma, deps, booking, kind, counters) {
    counters.total++;
    let claimId;
    try {
        claimId = (await prisma.bookingReminder.create({ data: { bookingId: booking.id, kind }, select: { id: true } })).id;
    }
    catch (e) {
        if (e?.code === 'P2002') {
            counters.duplicate++;
            return;
        }
        throw e;
    }
    const when = KIND_WHEN[kind];
    const rb = toReminderBooking(booking);
    try {
        const d = booking.telegramChatId
            ? await deps.sendBot(booking.telegramChatId, rb, when)
            : await deps.sendSmsOnly(rb, when);
        if (d.delivered === 'bot')
            counters.sent++;
        else if (d.delivered === 'sms')
            counters.smsSent++;
        else if (booking.telegramChatId)
            counters.failed++;
        else
            counters.skipped++; // немає Telegram і платний SMS не пройшов/вимкнено
        await prisma.bookingReminder.update({ where: { id: claimId }, data: { delivered: d.delivered } }).catch(() => undefined);
    }
    catch (error) {
        console.error(`❌ Не вдалося надіслати нагадування ${kind} для booking #${booking.id}:`, error);
        counters.failed++;
    }
}
const KYIV_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Доба «сьогодні за Києвом» як локальна північ процесу (так зберігається Booking.date). */
function kyivTodayStart(now) {
    const [y, m, d] = KYIV_DATE.format(now).split('-').map(Number);
    return new Date(y, m - 1, d);
}
const bookingInclude = { viberListing: { select: { senderName: true, phone: true } } };
/** Один прохід таймера: усі нагадування, що настали (бронювання на сьогодні й завтра за Києвом). */
async function runDueBookingReminders(prisma, deps, now = new Date()) {
    const counters = emptyCounters();
    if (!deps.isEnabled())
        return counters;
    const today = kyivTodayStart(now);
    const dayAfterTomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
    const bookings = await prisma.booking.findMany({
        where: { date: { gte: today, lt: dayAfterTomorrow } },
        include: bookingInclude,
    });
    for (const booking of bookings) {
        for (const kind of dueReminders(booking, now)) {
            await claimAndSend(prisma, deps, booking, kind, counters);
        }
    }
    return counters;
}
/**
 * Ручний запуск (POST /telegram/send-reminders[-today]): усі бронювання на завтра (evening) або сьогодні
 * (morning) без перевірки часу, але з тим самим журналом — повторний виклик не дублює повідомлення.
 */
async function sendManualReminders(prisma, deps, kind, now = new Date()) {
    const counters = emptyCounters();
    const today = kyivTodayStart(now);
    const day = kind === 'evening' ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1) : today;
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const bookings = await prisma.booking.findMany({
        where: { date: { gte: day, lt: next } },
        include: bookingInclude,
    });
    for (const booking of bookings)
        await claimAndSend(prisma, deps, booking, kind, counters);
    return counters;
}
