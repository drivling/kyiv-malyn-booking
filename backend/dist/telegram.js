"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatIdByPhone = exports.isTelegramEnabled = exports.sendInactivityReminder = exports.sendTripReminderToday = exports.sendTripReminder = exports.sendBookingConfirmationToCustomer = exports.sendRideShareRequestToDriver = exports.sendViberListingConfirmationToUser = exports.sendViberListingNotificationToAdmin = exports.sendBookingNotificationToAdmin = exports.getPhoneByTelegramUser = exports.getNameByPhone = exports.findOrCreatePersonByPhone = exports.getDriverFutureBookingsForMybookings = exports.getPersonByTelegram = exports.getPersonByPhone = exports.normalizePhone = void 0;
exports.setAnnounceDraft = setAnnounceDraft;
exports.getAnnounceDraft = getAnnounceDraft;
exports.getTelegramScenarioLinks = getTelegramScenarioLinks;
exports.notifyMatchingPassengersForNewDriver = notifyMatchingPassengersForNewDriver;
exports.notifyMatchingDriversForNewPassenger = notifyMatchingDriversForNewPassenger;
exports.resolveNameByPhoneFromTelegram = resolveNameByPhoneFromTelegram;
exports.sendMessageViaUserAccount = sendMessageViaUserAccount;
exports.buildInactivityReminderMessage = buildInactivityReminderMessage;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const viber_parser_1 = require("./viber-parser");
const prisma = new client_1.PrismaClient();
function hasNonEmptyText(value) {
    return !!value && value.trim().length > 0;
}
function mergeTextField(oldVal, newVal) {
    if (!hasNonEmptyText(newVal))
        return oldVal;
    if (!hasNonEmptyText(oldVal))
        return newVal;
    const oldTrim = oldVal.trim();
    const newTrim = newVal.trim();
    if (oldTrim === newTrim)
        return oldVal;
    if (newTrim.length > oldTrim.length && !oldTrim.includes(newTrim)) {
        return `${oldTrim} | ${newTrim}`;
    }
    return oldVal;
}
function mergeSenderName(oldVal, newVal) {
    if (!hasNonEmptyText(oldVal) && hasNonEmptyText(newVal))
        return newVal;
    return oldVal;
}
function mergeRawMessage(oldRaw, newRaw) {
    const oldTrim = (oldRaw || '').trim();
    const newTrim = (newRaw || '').trim();
    if (!newTrim)
        return oldRaw;
    if (!oldTrim)
        return newRaw;
    if (oldTrim.includes(newTrim))
        return oldRaw;
    if (newTrim.includes(oldTrim))
        return newRaw;
    return `${oldRaw}\n---\n${newRaw}`;
}
async function createOrMergeViberListing(data) {
    const personId = data.personId ?? null;
    // Якщо немає personId – немає надійного способу визначити клієнта, просто створюємо запис
    if (!personId) {
        const listing = await prisma.viberListing.create({ data });
        return { listing, isNew: true };
    }
    const date = data.date;
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const existing = await prisma.viberListing.findFirst({
        where: {
            listingType: data.listingType,
            personId,
            route: data.route,
            isActive: true,
            date: {
                gte: startOfDay,
                lt: endOfDay,
            },
            departureTime: data.departureTime ?? null,
        },
        orderBy: { createdAt: 'desc' },
    });
    if (!existing) {
        const listing = await prisma.viberListing.create({ data });
        return { listing, isNew: true };
    }
    const mergedNotes = mergeTextField(existing.notes, data.notes);
    const mergedSenderName = mergeSenderName(existing.senderName, data.senderName ?? null);
    const updated = await prisma.viberListing.update({
        where: { id: existing.id },
        data: {
            rawMessage: mergeRawMessage(existing.rawMessage, data.rawMessage),
            senderName: mergedSenderName ?? undefined,
            seats: data.seats != null ? data.seats : existing.seats,
            phone: existing.phone || data.phone,
            notes: mergedNotes,
            priceUah: data.priceUah != null ? data.priceUah : existing.priceUah,
            isActive: existing.isActive || data.isActive,
            personId: existing.personId ?? personId,
        },
    });
    console.log(`♻️ Viber listing merged with existing #${existing.id} (client+route+date+time match)`);
    return { listing: updated, isNew: false };
}
const driverRideStateMap = new Map();
const DRIVER_RIDE_STATE_TTL_MS = 15 * 60 * 1000; // 15 хв
const passengerRideStateMap = new Map();
const PASSENGER_RIDE_STATE_TTL_MS = 15 * 60 * 1000; // 15 хв
/** Очікування тексту оголошення з Вайберу після /addviber (тільки адмін-чат) */
const addViberAwaitingMap = new Map(); // chatId -> since
const ADDVIBER_STATE_TTL_MS = 10 * 60 * 1000; // 10 хв
/** Очікування вводу дати для фільтра /allrides */
const allridesAwaitingDateInputMap = new Map(); // chatId -> since
const ALLRIDES_FILTER_INPUT_TTL_MS = 10 * 60 * 1000; // 10 хв
const announceDraftsMap = new Map();
const ANNOUNCE_DRAFT_TTL_MS = 15 * 60 * 1000; // 15 хв
function setAnnounceDraft(token, data) {
    announceDraftsMap.set(token, { ...data, since: Date.now() });
}
function getAnnounceDraft(token) {
    const draft = announceDraftsMap.get(token);
    if (!draft)
        return null;
    if (Date.now() - draft.since > ANNOUNCE_DRAFT_TTL_MS) {
        announceDraftsMap.delete(token);
        return null;
    }
    return draft;
}
// Ініціалізація бота
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '5072659044';
const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';
let bot = null;
function getTelegramScenarioLinks() {
    return {
        driver: `https://t.me/${telegramBotUsername}?start=driver`,
        passenger: `https://t.me/${telegramBotUsername}?start=passenger`,
        view: `https://t.me/${telegramBotUsername}?start=view`,
        poputkyWeb: 'https://malin.kiev.ua/poputky',
    };
}
/**
 * Нормалізація номера телефону
 * Перетворює всі формати в 380XXXXXXXXX
 */
const normalizePhone = (phone) => {
    // Видаляємо всі символи крім цифр
    let cleaned = phone.replace(/\D/g, '');
    // Якщо починається з 0 (наприклад 0679551952) -> додаємо 38
    if (cleaned.startsWith('0')) {
        cleaned = '38' + cleaned;
    }
    // Якщо починається з 380 - залишаємо як є
    // Якщо інший формат - повертаємо як є
    return cleaned;
};
exports.normalizePhone = normalizePhone;
/** Допоміжна: створити ViberListing зі стану потоку водія та опційних приміток */
async function createDriverListingFromState(chatId, state, notes, senderName) {
    const phone = state.phone;
    if (!phone || !state.route || !state.date) {
        await bot?.sendMessage(chatId, '❌ Не вистачає даних. Почніть знову: /adddriverride');
        return;
    }
    const nameFromDb = await (0, exports.getNameByPhone)(phone);
    const resolvedSenderName = nameFromDb ?? senderName;
    const person = await (0, exports.findOrCreatePersonByPhone)(phone, { fullName: resolvedSenderName ?? undefined });
    const date = new Date(state.date);
    const { listing } = await createOrMergeViberListing({
        rawMessage: `[Бот] ${state.route} ${state.date} ${state.departureTime ?? ''} ${state.seats ?? ''} місць`,
        senderName: resolvedSenderName,
        listingType: 'driver',
        route: state.route,
        date,
        departureTime: state.departureTime ?? null,
        seats: state.seats ?? null,
        phone,
        notes,
        priceUah: state.priceUah ?? null,
        isActive: true,
        personId: person.id,
    });
    await (0, exports.sendViberListingNotificationToAdmin)({
        id: listing.id,
        listingType: 'driver',
        route: listing.route,
        date: listing.date,
        departureTime: listing.departureTime,
        seats: listing.seats,
        phone: listing.phone,
        senderName: listing.senderName,
        notes: listing.notes,
        priceUah: listing.priceUah ?? undefined,
    }).catch((err) => console.error('Telegram Viber notify:', err));
    await bot?.sendMessage(chatId, '✅ <b>Поїздку додано!</b>\n\n' +
        `🛣 ${getRouteName(state.route)}\n` +
        `📅 ${formatDate(date)}\n` +
        (state.departureTime ? `🕐 ${state.departureTime}\n` : '') +
        (state.seats != null ? `🎫 ${state.seats} місць\n` : '') +
        (state.priceUah != null ? `💰 ${state.priceUah} грн\n` : '') +
        (notes ? `📝 ${notes}\n` : '') +
        '\nОголошення опубліковано. Адмін отримав сповіщення.', { parse_mode: 'HTML' });
    await notifyMatchingPassengersForNewDriver(listing, chatId);
}
/** Допоміжна: створити ViberListing (пасажир) зі стану потоку. Кількість місць не збираємо. */
async function createPassengerListingFromState(chatId, state, notes, senderName) {
    const phone = state.phone;
    if (!phone || !state.route || !state.date) {
        await bot?.sendMessage(chatId, '❌ Не вистачає даних. Почніть знову: /addpassengerride');
        return;
    }
    const nameFromDb = await (0, exports.getNameByPhone)(phone);
    const resolvedSenderName = nameFromDb ?? senderName;
    const person = await (0, exports.findOrCreatePersonByPhone)(phone, { fullName: resolvedSenderName ?? undefined });
    const date = new Date(state.date);
    const { listing } = await createOrMergeViberListing({
        rawMessage: `[Бот-пасажир] ${state.route} ${state.date} ${state.departureTime ?? ''}`,
        senderName: resolvedSenderName,
        listingType: 'passenger',
        route: state.route,
        date,
        departureTime: state.departureTime ?? null,
        seats: null,
        phone,
        notes,
        isActive: true,
        personId: person.id,
    });
    await (0, exports.sendViberListingNotificationToAdmin)({
        id: listing.id,
        listingType: 'passenger',
        route: listing.route,
        date: listing.date,
        departureTime: listing.departureTime,
        seats: listing.seats,
        phone: listing.phone,
        senderName: listing.senderName,
        notes: listing.notes
    }).catch((err) => console.error('Telegram Viber notify:', err));
    await bot?.sendMessage(chatId, '✅ <b>Запит на поїздку додано!</b>\n\n' +
        `🛣 ${getRouteName(state.route)}\n` +
        `📅 ${formatDate(date)}\n` +
        (state.departureTime ? `🕐 ${state.departureTime}\n` : '') +
        (notes ? `📝 ${notes}\n` : '') +
        '\nЯкщо з\'явиться відповідний водій, ми сповістимо вас.', { parse_mode: 'HTML' });
    await notifyMatchingDriversForNewPassenger(listing, chatId);
}
/** Парсить "HH:MM" у хвилини від початку доби; якщо невалідно — null. */
function parseClockToMinutes(hoursRaw, minutesRaw) {
    const h = Number(hoursRaw);
    const m = Number(minutesRaw);
    if (!Number.isInteger(h) || !Number.isInteger(m))
        return null;
    if (h < 0 || h > 23 || m < 0 || m > 59)
        return null;
    return h * 60 + m;
}
/** Нормалізує час у інтервал [start, end] хвилин; "17:40" => [17:40,17:40], "17:05-18:00" => [17:05,18:00]. */
function parseTimeRangeForMatch(t) {
    if (!t || !t.trim())
        return null;
    const normalized = t.trim().replace(/[–—]/g, '-');
    const rangeMatch = normalized.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (rangeMatch) {
        const start = parseClockToMinutes(rangeMatch[1], rangeMatch[2]);
        const end = parseClockToMinutes(rangeMatch[3], rangeMatch[4]);
        if (start == null || end == null)
            return null;
        return start <= end ? { start, end } : { start: end, end: start };
    }
    const pointMatch = normalized.match(/(\d{1,2}):(\d{2})/);
    if (!pointMatch)
        return null;
    const point = parseClockToMinutes(pointMatch[1], pointMatch[2]);
    if (point == null)
        return null;
    return { start: point, end: point };
}
/** Чи збігається час: обидва задані і їхні часові інтервали перетинаються. */
function isExactTimeMatch(timeA, timeB) {
    const a = parseTimeRangeForMatch(timeA);
    const b = parseTimeRangeForMatch(timeB);
    if (!a || !b)
        return false;
    return a.start <= b.end && b.start <= a.end;
}
/** Діапазон хвилин від початку доби для фільтра /allrides по часу. */
const ALLRIDES_TIME_SLOTS = {
    morning: { start: 0, end: 12 * 60 }, // до 12:00
    afternoon: { start: 12 * 60, end: 18 * 60 }, // 12:00–18:00
    evening: { start: 18 * 60, end: 24 * 60 }, // після 18:00
};
function allridesListingMatchesTimeSlot(departureTime, slot) {
    const range = parseTimeRangeForMatch(departureTime);
    if (!range)
        return false; // без часу не показуємо в слоті
    const { start: s, end: e } = ALLRIDES_TIME_SLOTS[slot];
    return range.start < e && range.end > s;
}
/** Одна дата (YYYY-MM-DD) для порівняння. */
function toDateKey(d) {
    return d.toISOString().slice(0, 10);
}
/** Знайти активні оголошення пасажирів, що збігаються по маршруту та даті з оголошенням водія. */
async function findMatchingPassengersForDriver(driverListing) {
    const dateKey = toDateKey(driverListing.date);
    const passengers = await prisma.viberListing.findMany({
        where: {
            listingType: 'passenger',
            isActive: true,
            route: driverListing.route,
            date: {
                gte: new Date(dateKey + 'T00:00:00.000Z'),
                lt: new Date(new Date(dateKey).getTime() + 24 * 60 * 60 * 1000),
            },
        },
        orderBy: { createdAt: 'desc' },
    });
    const driverTime = driverListing.departureTime;
    return passengers.map((p) => {
        const exact = !!driverTime && !!p.departureTime && isExactTimeMatch(driverTime, p.departureTime);
        return { listing: p, matchType: exact ? 'exact' : 'approximate' };
    });
}
/** Знайти активні оголошення водіїв, що збігаються по маршруту та даті з оголошенням пасажира. */
async function findMatchingDriversForPassenger(passengerListing) {
    const dateKey = toDateKey(passengerListing.date);
    const drivers = await prisma.viberListing.findMany({
        where: {
            listingType: 'driver',
            isActive: true,
            route: passengerListing.route,
            date: {
                gte: new Date(dateKey + 'T00:00:00.000Z'),
                lt: new Date(new Date(dateKey).getTime() + 24 * 60 * 60 * 1000),
            },
        },
        orderBy: { createdAt: 'desc' },
    });
    const passengerTime = passengerListing.departureTime;
    return drivers.map((d) => {
        const exact = !!passengerTime && !!d.departureTime && isExactTimeMatch(passengerTime, d.departureTime);
        return { listing: d, matchType: exact ? 'exact' : 'approximate' };
    });
}
/** Після додавання поїздки водія: сповістити водія та всіх пасажирів, що збігаються. */
/** Викликати після створення оголошення водія (бот або адмінка). driverChatId — якщо є (з бота), сповістимо водія про збіги. */
async function notifyMatchingPassengersForNewDriver(driverListing, driverChatId) {
    const matches = await findMatchingPassengersForDriver(driverListing);
    if (matches.length === 0)
        return;
    const exactList = matches.filter((m) => m.matchType === 'exact').map((m) => m.listing);
    const approxList = matches.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
    if (driverChatId && exactList.length > 0) {
        const lines = exactList.map((p) => {
            const time = p.departureTime ?? '—';
            return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
        }).join('\n');
        const confirmButtons = exactList.map((p) => ([
            { text: `🤝 Запропонувати ${p.senderName ?? 'пасажиру'}`, callback_data: `vibermatch_book_driver_${driverListing.id}_${p.id}` }
        ]));
        await bot?.sendMessage(driverChatId, '🎯 <b>Пряме співпадіння: знайшли пасажирів на вашу дату та маршрут (час збігається або перетинається)</b>\n\n' +
            lines +
            '\n\n_Натисніть кнопку, щоб надіслати пасажиру запит на підтвердження (1 година)._', { parse_mode: 'HTML', reply_markup: { inline_keyboard: confirmButtons } }).catch(() => { });
    }
    if (driverChatId && approxList.length > 0) {
        const lines = approxList.map((p) => {
            const time = p.departureTime ?? '—';
            return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
        }).join('\n');
        await bot?.sendMessage(driverChatId, '📌 <b>Приблизне співпадіння (час не перетинається або не вказаний)</b>\n\n' + lines, { parse_mode: 'HTML' }).catch(() => { });
    }
    for (const { listing: p, matchType } of matches) {
        const passengerChatId = await (0, exports.getChatIdByPhone)(p.phone);
        if (!passengerChatId)
            continue;
        const label = matchType === 'exact' ? '🎯 Пряме співпадіння' : '📌 Приблизне співпадіння';
        const msg = `${label}: з\'явився водій на ваш маршрут і дату.\n\n` +
            `🛣 ${getRouteName(driverListing.route)}\n` +
            `📅 ${formatDate(driverListing.date)}\n` +
            (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
            (driverListing.seats != null ? `🎫 ${driverListing.seats} місць\n` : '') +
            `👤 ${driverListing.senderName ?? 'Водій'}\n` +
            `📞 ${formatPhoneTelLink(driverListing.phone)}` +
            (driverListing.notes ? `\n📝 ${driverListing.notes}` : '') +
            (matchType === 'exact'
                ? '\n\n_Натисніть кнопку нижче — водій отримає запит і матиме 1 годину на підтвердження._'
                : '');
        const replyMarkup = matchType === 'exact'
            ? {
                inline_keyboard: [[
                        { text: `🎫 Забронювати у ${driverListing.senderName ?? 'водія'}`, callback_data: `vibermatch_book_${p.id}_${driverListing.id}` }
                    ]]
            }
            : undefined;
        await bot?.sendMessage(passengerChatId, msg, {
            parse_mode: 'HTML',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }).catch(() => { });
    }
}
/** Викликати після створення запиту пасажира (бот або адмінка). passengerChatId — якщо є (з бота), сповістимо пасажира про збіги. */
async function notifyMatchingDriversForNewPassenger(passengerListing, passengerChatId) {
    const matches = await findMatchingDriversForPassenger(passengerListing);
    if (matches.length === 0)
        return;
    const exactList = matches.filter((m) => m.matchType === 'exact').map((m) => m.listing);
    const approxList = matches.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
    if (passengerChatId && exactList.length > 0) {
        const lines = exactList.map((d) => {
            const time = d.departureTime ?? '—';
            return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
        }).join('\n');
        const bookButtons = exactList.map((d) => [
            { text: `🎫 Забронювати у ${d.senderName ?? 'водія'}`, callback_data: `vibermatch_book_${passengerListing.id}_${d.id}` }
        ]);
        await bot?.sendMessage(passengerChatId, '🎯 <b>Пряме співпадіння: знайшли водіїв на вашу дату та маршрут (час збігається або перетинається)</b>\n\n' + lines + '\n\n_Натисніть кнопку нижче — водій отримає запит і матиме 1 год на підтвердження._', { parse_mode: 'HTML', reply_markup: { inline_keyboard: bookButtons } }).catch(() => { });
    }
    if (passengerChatId && approxList.length > 0) {
        const lines = approxList.map((d) => {
            const time = d.departureTime ?? '—';
            return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
        }).join('\n');
        await bot?.sendMessage(passengerChatId, '📌 <b>Приблизне співпадіння (час не перетинається або не вказаний)</b>\n\n' + lines, { parse_mode: 'HTML' }).catch(() => { });
    }
    for (const { listing: d, matchType } of matches) {
        const driverChatId = await (0, exports.getChatIdByPhone)(d.phone);
        if (!driverChatId)
            continue;
        const label = matchType === 'exact' ? '🎯 Пряме співпадіння' : '📌 Приблизне співпадіння';
        const msg = `${label}: новий запит пасажира на ваш маршрут і дату.\n\n` +
            `🛣 ${getRouteName(passengerListing.route)}\n` +
            `📅 ${formatDate(passengerListing.date)}\n` +
            (passengerListing.departureTime ? `🕐 ${passengerListing.departureTime}\n` : '') +
            `👤 ${passengerListing.senderName ?? 'Пасажир'}\n` +
            `📞 ${formatPhoneTelLink(passengerListing.phone)}` +
            (passengerListing.notes ? `\n📝 ${passengerListing.notes}` : '');
        await bot?.sendMessage(driverChatId, msg, { parse_mode: 'HTML' }).catch(() => { });
    }
}
// --- Робота з Person (єдина база людей) ---
/** Знайти людину за нормалізованим номером телефону */
const getPersonByPhone = async (phone) => {
    const normalized = (0, exports.normalizePhone)(phone);
    return prisma.person.findUnique({
        where: { phoneNormalized: normalized }
    });
};
exports.getPersonByPhone = getPersonByPhone;
/** Знайти людину за Telegram userId або chatId */
const getPersonByTelegram = async (userId, chatId) => {
    const or = [];
    if (userId && userId !== '0' && userId.trim() !== '')
        or.push({ telegramUserId: userId });
    if (chatId && chatId !== '0' && chatId.trim() !== '')
        or.push({ telegramChatId: chatId });
    if (or.length === 0)
        return null;
    return prisma.person.findFirst({ where: { OR: or } });
};
exports.getPersonByTelegram = getPersonByTelegram;
/**
 * Майбутні бронювання, де у користувача забронювали як у водія (для /mybookings).
 * Повертає бронювання з source viber_match по оголошеннях водія цього користувача.
 */
const getDriverFutureBookingsForMybookings = async (userId, chatId, sinceDate) => {
    const person = await (0, exports.getPersonByTelegram)(userId, chatId);
    if (!person)
        return [];
    const myDriverListingIds = (await prisma.viberListing.findMany({
        where: { personId: person.id, listingType: 'driver' },
        select: { id: true }
    })).map((l) => l.id);
    if (myDriverListingIds.length === 0)
        return [];
    return prisma.booking.findMany({
        where: {
            viberListingId: { in: myDriverListingIds },
            date: { gte: sinceDate }
        },
        orderBy: { date: 'asc' },
        take: 10
    });
};
exports.getDriverFutureBookingsForMybookings = getDriverFutureBookingsForMybookings;
/**
 * Знайти або створити Person за номером; опційно оновити fullName та Telegram.
 * Повертає Person (phoneNormalized для відображення можна форматувати окремо).
 */
const findOrCreatePersonByPhone = async (phone, options) => {
    const normalized = (0, exports.normalizePhone)(phone);
    const fullName = options?.fullName != null && String(options.fullName).trim() !== ''
        ? String(options.fullName).trim()
        : null;
    const person = await prisma.person.upsert({
        where: { phoneNormalized: normalized },
        create: {
            phoneNormalized: normalized,
            fullName,
            telegramChatId: options?.telegramChatId ?? null,
            telegramUserId: options?.telegramUserId ?? null,
        },
        update: {
            ...(fullName != null && { fullName }),
            ...(options?.telegramChatId != null && { telegramChatId: options.telegramChatId }),
            ...(options?.telegramUserId != null && { telegramUserId: options.telegramUserId }),
        },
    });
    return { id: person.id, phoneNormalized: person.phoneNormalized, fullName: person.fullName };
};
exports.findOrCreatePersonByPhone = findOrCreatePersonByPhone;
/** Оновити Telegram у Person та у всіх бронюваннях з тим же номером (і привʼязати їх до Person). */
async function updatePersonAndBookingsTelegram(personId, chatId, userId) {
    await prisma.person.update({
        where: { id: personId },
        data: { telegramChatId: chatId, telegramUserId: userId },
    });
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { phoneNormalized: true } });
    if (!person)
        return;
    const allBookings = await prisma.booking.findMany({ select: { id: true, phone: true, personId: true } });
    const samePhone = allBookings.filter((b) => (0, exports.normalizePhone)(b.phone) === person.phoneNormalized);
    for (const b of samePhone) {
        await prisma.booking.update({
            where: { id: b.id },
            data: { telegramChatId: chatId, telegramUserId: userId, personId },
        });
    }
}
/**
 * Отримати ім'я (ім'я + прізвище): спочатку з Person, інакше з Booking.
 */
const getNameByPhone = async (phone) => {
    const person = await (0, exports.getPersonByPhone)(phone);
    if (person?.fullName?.trim())
        return person.fullName.trim();
    const bookings = await prisma.booking.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { phone: true, name: true },
    });
    const match = bookings.find((b) => (0, exports.normalizePhone)(b.phone) === (0, exports.normalizePhone)(phone));
    return match?.name?.trim() ?? null;
};
exports.getNameByPhone = getNameByPhone;
/**
 * Отримати номер телефону користувача: спочатку з Person за Telegram, інакше з Booking.
 */
const getPhoneByTelegramUser = async (userId, chatId) => {
    const person = await (0, exports.getPersonByTelegram)(userId, chatId);
    if (person)
        return person.phoneNormalized;
    const booking = await prisma.booking.findFirst({
        where: {
            OR: [{ telegramUserId: userId }, { telegramChatId: chatId }],
        },
        orderBy: { createdAt: 'desc' },
        select: { phone: true },
    });
    return booking?.phone ?? null;
};
exports.getPhoneByTelegramUser = getPhoneByTelegramUser;
/**
 * Форматування дати для українського формату
 */
const formatDate = (date) => {
    return new Intl.DateTimeFormat('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(date);
};
/**
 * Формат номера для відображення в Telegram: +380(67)4476844 (без пропусків, оператор у дужках).
 * Український формат 380XXXXXXXXX: 38 + 0 (трак) + XX (оператор 2 цифри) + 7 цифр.
 */
function formatPhoneDisplay(phone) {
    const normalized = (0, exports.normalizePhone)(phone ?? '');
    if (normalized.length === 12 && normalized.startsWith('38')) {
        return `+380(${normalized.slice(3, 5)})${normalized.slice(5)}`;
    }
    if (normalized.length >= 10)
        return '+' + normalized;
    return (phone ?? '').trim() || '—';
}
/** Короткий номер для кнопки: 097…5645 (0XX + останні 4 цифри) */
function formatShortPhoneForButton(phone) {
    const normalized = (0, exports.normalizePhone)(phone ?? '');
    if (normalized.length >= 7) {
        const prefix = normalized.startsWith('38') ? '0' + normalized.slice(2, 5) : normalized.slice(0, 3);
        const last4 = normalized.slice(-4);
        return `${prefix}…${last4}`;
    }
    return normalized ? normalized.slice(-4) || '—' : '—';
}
/** Обрізати текст для кнопки Telegram (ліміт ~64 байти) */
function truncateForButton(name, maxLen = 18) {
    const t = (name || '').trim();
    if (t.length <= maxLen)
        return t;
    return t.slice(0, maxLen - 1) + '…';
}
/**
 * Клікабельний номер телефону для Telegram (HTML): <a href="tel:+38...">+380(XX)YYYYYYY</a>
 */
function formatPhoneTelLink(phone) {
    const p = (phone ?? '').trim();
    if (!p)
        return '—';
    const digits = '+' + (0, exports.normalizePhone)(p);
    const display = formatPhoneDisplay(p);
    const displayEscaped = display.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<a href="tel:${digits}">${displayEscaped}</a>`;
}
/**
 * Отримання назви маршруту
 */
const getRouteName = (route) => {
    if (route.includes('Kyiv-Malyn')) {
        if (route.includes('Irpin'))
            return 'Київ → Малин (через Ірпінь)';
        if (route.includes('Bucha'))
            return 'Київ → Малин (через Бучу)';
        return 'Київ → Малин';
    }
    if (route.includes('Malyn-Kyiv')) {
        if (route.includes('Irpin'))
            return 'Малин → Київ (через Ірпінь)';
        if (route.includes('Bucha'))
            return 'Малин → Київ (через Бучу)';
        return 'Малин → Київ';
    }
    if (route.includes('Malyn-Zhytomyr'))
        return 'Малин → Житомир';
    if (route.includes('Zhytomyr-Malyn'))
        return 'Житомир → Малин';
    if (route.includes('Korosten-Malyn'))
        return 'Коростень → Малин';
    if (route.includes('Malyn-Korosten'))
        return 'Малин → Коростень';
    return route;
};
/**
 * Відправка повідомлення про нове бронювання адміністратору.
 * Тільки для маршруток (schedule). Для попуток (viber_match) адміну шле окреме повідомлення в обробнику.
 */
const sendBookingNotificationToAdmin = async (booking) => {
    if (!bot || !adminChatId) {
        console.log('⚠️ Telegram bot або admin chat ID не налаштовано');
        return;
    }
    const isViberRide = booking.source === 'viber_match';
    try {
        const message = `
🎫 <b>Нове бронювання #${booking.id}</b>${isViberRide ? ' · 🚗 Попутка' : ''}

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
🎫 <b>Місць:</b> ${booking.seats}

👤 <b>Клієнт:</b> ${booking.name}
📞 <b>Телефон:</b> ${formatPhoneTelLink(booking.phone)}

${isViberRide ? '✅ <i>Попутка підтверджена</i>' : '✅ <i>Заявку прийнято</i> (технічний режим)'}
    `.trim();
        await bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
        console.log(`✅ Telegram повідомлення надіслано адміну (booking #${booking.id})`);
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram повідомлення адміну:', error);
    }
};
exports.sendBookingNotificationToAdmin = sendBookingNotificationToAdmin;
/**
 * Сповіщення адміну про першу реєстрацію в Telegram (ID раніше не був прив'язаний).
 */
function sendNewTelegramRegistrationNotificationToAdmin(userId, phone, name) {
    if (!bot || !adminChatId)
        return;
    const displayName = name?.trim() || '—';
    const message = `
🆕 <b>Нова реєстрація в Telegram</b>

👤 Ім'я: ${displayName}
📞 Телефон: ${formatPhoneTelLink(phone)}
🆔 Telegram ID: <code>${userId}</code>

<i>Раніше цей ID не був прив'язаний до жодного акаунту.</i>
  `.trim();
    bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' }).catch((err) => console.error('Notify admin new Telegram reg:', err));
}
/**
 * Відправка повідомлення адміну про нове Viber оголошення (поїздку з чату)
 */
const sendViberListingNotificationToAdmin = async (listing) => {
    if (!bot || !adminChatId) {
        console.log('⚠️ Telegram bot або admin chat ID не налаштовано');
        return;
    }
    try {
        const dateStr = listing.date instanceof Date
            ? formatDate(listing.date)
            : (listing.date && listing.date.slice(0, 10))
                ? formatDate(new Date(listing.date))
                : '—';
        const typeEmoji = listing.listingType === 'driver' ? '🚗' : '👤';
        const typeLabel = listing.listingType === 'driver' ? 'Водій' : 'Пасажир';
        const message = `
📱 <b>Нове Viber оголошення #${listing.id}</b>

${typeEmoji} <b>Тип:</b> ${typeLabel}
🛣 <b>Маршрут:</b> ${listing.route}
📅 <b>Дата:</b> ${dateStr}
🕐 <b>Час:</b> ${listing.departureTime ?? '—'}
${listing.seats != null ? `🎫 <b>Місця:</b> ${listing.seats}\n` : ''}${listing.priceUah != null ? `💰 <b>Ціна:</b> ${listing.priceUah} грн\n` : ''}
📞 <b>Телефон:</b> ${formatPhoneTelLink(listing.phone)}
${listing.senderName ? `👤 <b>Відправник:</b> ${listing.senderName}\n` : ''}${listing.notes ? `📝 <b>Примітки:</b> ${listing.notes}` : ''}
    `.trim();
        await bot.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
        console.log(`✅ Telegram: адміну надіслано сповіщення про Viber оголошення #${listing.id}`);
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram сповіщення про Viber оголошення:', error);
    }
};
exports.sendViberListingNotificationToAdmin = sendViberListingNotificationToAdmin;
/**
 * Спроба надіслати автору оголошення повідомлення про публікацію на платформі.
 * Працює тільки якщо номер телефону вже є в базі (користувач колись брався через сайт/бота і прив’язав Telegram).
 * Якщо chatId по телефону не знайдено — нічого не відправляємо (без помилок).
 */
const sendViberListingConfirmationToUser = async (phone, listing) => {
    const trimmed = phone?.trim();
    if (!trimmed)
        return;
    try {
        const chatId = await (0, exports.getChatIdByPhone)(trimmed);
        if (chatId && bot) {
            const message = buildViberListingConfirmationMessage(listing, { addSubscribeInstruction: false });
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            console.log(`✅ Telegram: автору Viber оголошення #${listing.id} надіслано сповіщення про публікацію (бот)`);
            return;
        }
        if (!chatId) {
            const person = await (0, exports.getPersonByPhone)(trimmed);
            const PROMO_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 днів
            const shouldSendPromo = person &&
                isTelegramUserSenderEnabled() &&
                (!person.telegramPromoSentAt || Date.now() - person.telegramPromoSentAt.getTime() > PROMO_COOLDOWN_MS);
            if (shouldSendPromo) {
                const promoMessage = buildViberListingConfirmationMessage(listing, { addSubscribeInstruction: true });
                const phoneForApi = (0, exports.normalizePhone)(trimmed);
                const sent = await sendMessageViaUserAccount(phoneForApi, promoMessage);
                if (sent) {
                    await prisma.person.update({
                        where: { id: person.id },
                        data: { telegramPromoSentAt: new Date() },
                    });
                    console.log(`✅ Telegram: автору Viber оголошення #${listing.id} надіслано одноразове промо від вашого акаунта, Person.telegramPromoSentAt оновлено`);
                }
                return;
            }
            if (!person?.telegramPromoSentAt) {
                console.log(`ℹ️ Viber оголошення #${listing.id}: по телефону ${trimmed} Telegram не знайдено, пропускаємо сповіщення`);
            }
        }
    }
    catch (error) {
        console.error('❌ Помилка відправки сповіщення автору Viber оголошення:', error);
    }
};
exports.sendViberListingConfirmationToUser = sendViberListingConfirmationToUser;
/** Чи налаштовано відправку одноразового промо від вашого акаунта (Telethon): сесія + API */
function isTelegramUserSenderEnabled() {
    const session = process.env.TELEGRAM_USER_SESSION_PATH;
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    return !!(session?.trim() && apiId?.trim() && apiHash?.trim());
}
/** Текст сповіщення про публікацію оголошення (спільний для бота та одноразового промо). */
function buildViberListingConfirmationMessage(listing, options) {
    const dateStr = listing.date instanceof Date
        ? formatDate(listing.date)
        : (listing.date && String(listing.date).slice(0, 10))
            ? formatDate(new Date(listing.date))
            : '—';
    const routeName = getRouteName(listing.route);
    const links = getTelegramScenarioLinks();
    let message = `
📱 <b>Ваше оголошення опубліковано на платформі Поїздки Київ, Житомир, Коростень ↔️ Малин</b>

🛣 <b>Маршрут:</b> ${routeName}
📅 <b>Дата:</b> ${dateStr}
${listing.departureTime ? `🕐 <b>Час:</b> ${listing.departureTime}\n` : ''}${listing.seats != null ? `🎫 <b>Місць:</b> ${listing.seats}\n` : ''}${listing.priceUah != null ? `💰 <b>Ціна:</b> ${listing.priceUah} грн\n` : ''}
Інші користувачі зможуть бачити це оголошення та зв'язатися з вами за телефоном.

<i>Дякуємо, що користуєтесь нашою платформою! 🚐</i>
Сайт: <a href="https://malin.kiev.ua">malin.kiev.ua</a>
  `.trim();
    if (options.addSubscribeInstruction) {
        message += `

——
<b>Щоб надалі отримувати такі сповіщення в Telegram автоматично</b>, один раз натисніть Start у нашому боті:
• як <b>водій</b>: ${links.driver}
• як <b>пасажир</b>: ${links.passenger}
Після реєстрації номера в боті ми більше не надсилатимемо листи на цей чат.`;
    }
    return message;
}
/**
 * Знайти ім'я в Telegram по номеру телефону (Python send_message.py --resolve).
 * Використовується перед збереженням Viber-оголошення/Person без імені.
 */
async function resolveNameByPhoneFromTelegram(phone) {
    const sessionPath = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
    const scriptDir = sessionPath ? path_1.default.dirname(sessionPath) : '';
    const scriptPath = path_1.default.join(scriptDir, 'send_message.py');
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    if (!sessionPath || !apiId || !apiHash || !phone?.trim())
        return null;
    const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(pythonCmd, [scriptPath, '--resolve', phone.trim()], {
            env: {
                ...process.env,
                TELEGRAM_USER_SESSION_PATH: sessionPath,
                TELEGRAM_API_ID: apiId,
                TELEGRAM_API_HASH: apiHash,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('close', (code) => {
            if (code === 0 && stdout.trim()) {
                resolve(stdout.trim());
            }
            else {
                if (code !== 1) {
                    console.error(`ℹ️ resolveNameByPhone (${phone}): код ${code}`, stderr.slice(0, 200));
                }
                resolve(null);
            }
        });
        child.on('error', () => resolve(null));
    });
}
/**
 * Відправити одне повідомлення від вашого Telegram-акаунта по номеру телефону (Python Telethon).
 * Повертає true, якщо повідомлення доставлено; false — помилка або користувач приховав номер.
 * Експортується для одноразової реклами каналу (без оновлення telegramPromoSentAt).
 */
async function sendMessageViaUserAccount(phone, message) {
    const sessionPath = process.env.TELEGRAM_USER_SESSION_PATH?.trim();
    const scriptDir = sessionPath ? path_1.default.dirname(sessionPath) : '';
    const scriptPath = path_1.default.join(scriptDir, 'send_message.py');
    const apiId = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;
    if (!sessionPath || !apiId || !apiHash)
        return false;
    const pythonCmd = process.env.TELEGRAM_USER_PYTHON?.trim() || 'python3';
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(pythonCmd, [scriptPath, phone], {
            env: {
                ...process.env,
                TELEGRAM_USER_SESSION_PATH: sessionPath,
                TELEGRAM_API_ID: apiId,
                TELEGRAM_API_HASH: apiHash,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        child.stdin?.end(message, 'utf8');
        child.on('close', (code) => {
            if (code === 0) {
                resolve(true);
                return;
            }
            if (code === 1) {
                console.log(`ℹ️ Telegram user-sender: по телефону ${phone} не знайдено або номер приховано (код 1)`);
            }
            else {
                console.error(`❌ Telegram user-sender помилка (код ${code}):`, stderr.slice(0, 500));
            }
            resolve(false);
        });
        child.on('error', (err) => {
            console.error('❌ Telegram user-sender: не вдалося запустити Python:', err.message);
            resolve(false);
        });
    });
}
/**
 * Відправка водію запиту на попутку з кнопкою підтвердження.
 * Повертає true, якщо повідомлення водію відправлено.
 */
const sendRideShareRequestToDriver = async (requestId, driver, passenger) => {
    if (!bot)
        return false;
    const driverChatId = await (0, exports.getChatIdByPhone)(driver.phone);
    if (!driverChatId)
        return false;
    const confirmKeyboard = {
        inline_keyboard: [[{ text: '✅ Підтвердити бронювання (1 год)', callback_data: `vibermatch_confirm_${requestId}` }]]
    };
    await bot.sendMessage(driverChatId, `🎫 <b>Запит на попутку</b>\n\n` +
        `👤 ${passenger.senderName ?? 'Пасажир'} хоче поїхати з вами.\n\n` +
        `🛣 ${getRouteName(driver.route)}\n` +
        `📅 ${formatDate(driver.date)}\n` +
        (driver.departureTime ? `🕐 ${driver.departureTime}\n` : '') +
        `📞 ${formatPhoneTelLink(passenger.phone)}` +
        (passenger.notes ? `\n📝 ${passenger.notes}` : '') +
        `\n\n_У вас є 1 година на підтвердження._`, { parse_mode: 'HTML', reply_markup: confirmKeyboard });
    return true;
};
exports.sendRideShareRequestToDriver = sendRideShareRequestToDriver;
/**
 * Відправка підтвердження бронювання клієнту.
 * Тільки для маршруток (schedule). Для попуток (viber_match) пасажиру шле окреме повідомлення "Водій підтвердив ваше бронювання!" в обробнику vibermatch_confirm_.
 */
const sendBookingConfirmationToCustomer = async (chatId, booking) => {
    if (!bot) {
        console.log('⚠️ Telegram bot не налаштовано');
        return;
    }
    const isViberRide = booking.source === 'viber_match';
    try {
        const message = isViberRide
            ? `
✅ <b>Попутку підтверджено</b>

🎫 <b>Номер:</b> #${booking.id}
🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час:</b> ${booking.departureTime}
👤 <b>Пасажир:</b> ${booking.name}

<i>Бажаємо приємної подорожі! 🚐</i>
    `.trim()
            : `
📋 <b>Заявку прийнято</b> (працюємо в технічному режимі)

🎫 <b>Номер:</b> #${booking.id}
🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
🎫 <b>Місць:</b> ${booking.seats}
👤 <b>Пасажир:</b> ${booking.name}
${booking.supportPhone ? `\n⚠️ Краще уточнити бронювання за телефоном: ${booking.supportPhone}\n` : ''}

<i>Бажаємо приємної подорожі! 🚐</i>
    `.trim();
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log(`✅ Telegram підтвердження надіслано клієнту (booking #${booking.id})`);
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram підтвердження клієнту:', error);
    }
};
exports.sendBookingConfirmationToCustomer = sendBookingConfirmationToCustomer;
/**
 * Відправка нагадування про поїздку (можна викликати через cron job)
 */
const sendTripReminder = async (chatId, booking) => {
    if (!bot) {
        console.log('⚠️ Telegram bot не налаштовано');
        return;
    }
    try {
        const schedule = await prisma.schedule.findFirst({
            where: { route: booking.route, supportPhone: { not: null } },
            select: { supportPhone: true }
        });
        const supportPhone = schedule?.supportPhone ?? null;
        const supportPhoneLine = supportPhone
            ? `\n📞 <b>Перевірити бронювання за тел.:</b> ${supportPhone}\n`
            : '';
        const driverLine = booking.driver
            ? `\n🚗 <b>Водій:</b> ${booking.driver.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.driver.phone)}\n`
            : '';
        const message = `
⚠️❗ <b>Увага!</b> Якщо ви не перевірили бронювання за телефоном — воно не гарантоване!

🔔 <b>Нагадування про поїздку!</b>

👋 ${booking.name}, нагадуємо про вашу поїздку завтра:

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
${driverLine}${supportPhoneLine}
<i>Не спізніться! ⏰</i>
    `.trim();
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log(`✅ Telegram нагадування надіслано`);
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram нагадування:', error);
    }
};
exports.sendTripReminder = sendTripReminder;
/**
 * Відправка нагадування в день поїздки (сьогодні)
 */
const sendTripReminderToday = async (chatId, booking) => {
    if (!bot) {
        console.log('⚠️ Telegram bot не налаштовано');
        return;
    }
    try {
        const schedule = await prisma.schedule.findFirst({
            where: { route: booking.route, supportPhone: { not: null } },
            select: { supportPhone: true }
        });
        const supportPhone = schedule?.supportPhone ?? null;
        const supportPhoneLine = supportPhone
            ? `\n📞 <b>Перевірити бронювання за тел.:</b> ${supportPhone}\n`
            : '';
        const driverLine = booking.driver
            ? `\n🚗 <b>Водій:</b> ${booking.driver.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.driver.phone)}\n`
            : '';
        const message = `
⚠️❗ <b>Увага!</b> Якщо ви не перевірили бронювання за телефоном — воно не гарантоване!

🔔 <b>Сьогодні у вас поїздка!</b>

👋 ${booking.name}, нагадуємо:

🚌 <b>Маршрут:</b> ${getRouteName(booking.route)}
📅 <b>Дата:</b> ${formatDate(booking.date)}
🕐 <b>Час відправлення:</b> ${booking.departureTime}
${driverLine}${supportPhoneLine}
<i>Не спізніться! ⏰</i>
    `.trim();
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log(`✅ Telegram нагадування (сьогодні) надіслано`);
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram нагадування (сьогодні):', error);
    }
};
exports.sendTripReminderToday = sendTripReminderToday;
/**
 * Текст нагадування неактивним (з посиланнями на сценарії). Використовується ботом та відправкою від особистого акаунта.
 */
function buildInactivityReminderMessage() {
    const links = getTelegramScenarioLinks();
    return `
👋 <b>Давно не бачилися!</b>

Ми помітили, що ви давно не користувалися сервісом поїздок Київ, Житомир, Коростень ↔️ Малин.

Якщо плануєте дорогу:
• як <b>водій</b> — створіть нову поїздку: ${links.driver}
• як <b>пасажир</b> — створіть запит на поїздку: ${links.passenger}

Вільний перегляд поїздок: ${links.poputkyWeb}

<i>Дякуємо, що користуєтесь нашим сервісом! 🚐</i>
  `.trim();
}
/**
 * Нагадування неактивним користувачам: просте повідомлення з посиланнями на сценарії.
 */
const sendInactivityReminder = async (chatId) => {
    if (!bot) {
        console.log('⚠️ Telegram bot не налаштовано');
        return;
    }
    try {
        const message = buildInactivityReminderMessage();
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log('✅ Telegram inactivity reminder sent');
    }
    catch (error) {
        console.error('❌ Помилка відправки Telegram inactivity reminder:', error);
        throw error;
    }
};
exports.sendInactivityReminder = sendInactivityReminder;
/**
 * Перевірка чи бот налаштований
 */
const isTelegramEnabled = () => {
    return bot !== null && token !== undefined;
};
exports.isTelegramEnabled = isTelegramEnabled;
/**
 * Реєстрація номера телефону: прив'язка Person до Telegram та синхронізація з бронюваннями.
 * telegramName — ім'я з профілю Telegram (first_name + last_name), зберігається в Person.fullName.
 */
async function registerUserPhone(chatId, userId, phoneInput, telegramName) {
    if (!bot)
        return;
    try {
        const normalizedPhone = (0, exports.normalizePhone)(phoneInput);
        // Чи цей Telegram ID вже був прив'язаний раніше (Person або Booking)
        const personByTelegram = await (0, exports.getPersonByTelegram)(userId, chatId);
        const bookingByTelegram = await prisma.booking.findFirst({
            where: { telegramUserId: userId },
            select: { id: true },
        });
        const hadAccountBefore = !!(personByTelegram || bookingByTelegram);
        const allBookings = await prisma.booking.findMany({ orderBy: { createdAt: 'desc' } });
        const matchingBookings = allBookings.filter((b) => (0, exports.normalizePhone)(b.phone) === normalizedPhone);
        const userIdBookings = await prisma.booking.findMany({
            where: { telegramUserId: userId },
        });
        const totalBookings = matchingBookings.length + userIdBookings.length;
        if (totalBookings === 0) {
            // Додаємо людину в базу (Person), щоб після бронювання на сайті вона отримувала сповіщення
            await (0, exports.findOrCreatePersonByPhone)(phoneInput, {
                fullName: telegramName ?? undefined,
                telegramChatId: chatId,
                telegramUserId: userId,
            });
            if (!hadAccountBefore) {
                const person = await (0, exports.getPersonByPhone)(phoneInput);
                sendNewTelegramRegistrationNotificationToAdmin(userId, phoneInput, person?.fullName ?? telegramName ?? null);
            }
            await bot.sendMessage(chatId, `✅ <b>Номер додано в базу клієнтів!</b>\n\n` +
                `📱 ${formatPhoneTelLink(phoneInput)}\n\n` +
                `📋 <b>Повна інструкція</b>\n\n` +
                `1️⃣ <b>Забронювати квиток</b> можна двома способами:\n` +
                `   • На сайті: 🌐 https://malin.kiev.ua (вкажіть цей номер телефону)\n` +
                `   • У боті: кнопка «🎫 Бронювання» або команда /book\n\n` +
                `2️⃣ <b>Що ви будете отримувати автоматично:</b>\n` +
                `   • ✅ Підтвердження бронювання (на сайті чи в боті)\n` +
                `   • 🔔 Нагадування за день до поїздки\n\n` +
                `3️⃣ Нижче з\'явилися кнопки меню — користуйтеся ними або командами з довідки /help.`, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() });
            console.log(`✅ Додано Person (без бронювань) для ${userId}, номер ${normalizedPhone}`);
            return;
        }
        const phoneNumbers = [...new Set(matchingBookings.map((b) => b.phone))];
        for (const phone of phoneNumbers) {
            const person = await (0, exports.findOrCreatePersonByPhone)(phone, {
                fullName: telegramName ?? undefined,
                telegramChatId: chatId,
                telegramUserId: userId,
            });
            await updatePersonAndBookingsTelegram(person.id, chatId, userId);
            const norm = (0, exports.normalizePhone)(phone);
            const allWithPhone = await prisma.booking.findMany({ where: {} });
            const toLink = allWithPhone.filter((b) => (0, exports.normalizePhone)(b.phone) === norm);
            for (const b of toLink) {
                if (b.personId !== person.id) {
                    await prisma.booking.update({
                        where: { id: b.id },
                        data: { personId: person.id, telegramChatId: chatId, telegramUserId: userId },
                    });
                }
            }
        }
        await prisma.booking.updateMany({
            where: { telegramUserId: userId, telegramChatId: null },
            data: { telegramChatId: chatId },
        });
        if (!hadAccountBefore) {
            const person = await (0, exports.getPersonByPhone)(phoneInput);
            sendNewTelegramRegistrationNotificationToAdmin(userId, phoneInput, person?.fullName ?? telegramName ?? null);
        }
        console.log(`✅ Оновлено Person та бронювання для користувача ${userId}, номер ${normalizedPhone}`);
        await bot.sendMessage(chatId, `✅ <b>Вітаємо! Ваш акаунт підключено!</b>\n\n` +
            `📱 Номер телефону: ${formatPhoneTelLink(phoneInput)}\n` +
            `🎫 Знайдено бронювань: ${totalBookings}\n\n` +
            `Тепер ви будете отримувати:\n` +
            `• ✅ Підтвердження при створенні бронювання\n` +
            `• 🔔 Нагадування за день до поїздки\n\n` +
            `📋 Нижче з\'явилися кнопки меню — можна користуватися ними замість команд.`, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() });
    }
    catch (error) {
        console.error('❌ Помилка реєстрації номера:', error);
        await bot.sendMessage(chatId, '❌ Помилка при реєстрації. Спробуйте пізніше.');
    }
}
/** Список команд для меню бота (кнопка "Menu" зліва від вводу). */
const CLIENT_BOT_COMMANDS = [
    { command: 'start', description: 'Головне меню' },
    { command: 'help', description: 'Довідка' },
    { command: 'book', description: 'Нове бронювання' },
    { command: 'mybookings', description: 'Мої бронювання' },
    { command: 'allrides', description: 'Всі попутки' },
    { command: 'cancel', description: 'Скасувати бронювання' },
    { command: 'mydriverrides', description: 'Мої поїздки (водій)' },
    { command: 'adddriverride', description: 'Додати поїздку' },
    { command: 'mypassengerrides', description: 'Мої запити (пасажир)' },
    { command: 'addpassengerride', description: 'Шукаю поїздку' },
    { command: 'poputky', description: 'Перегляд попуток' },
];
/** Відображувані назви кнопок головного меню (надсилаються як текст повідомлення). */
const MAIN_MENU_BUTTONS = {
    BOOK: '🎫 Бронювання',
    MY_BOOKINGS: '📋 Мої бронювання',
    ALL_RIDES: '🌐 Всі попутки',
    CANCEL: '🚫 Скасувати',
    MY_DRIVER_RIDES: '🚗 Мої поїздки',
    MY_PASSENGER_RIDES: '👤 Мої запити',
    ADD_DRIVER_RIDE: '🚗 Додати поїздку',
    ADD_PASSENGER_RIDE: '👤 Шукаю поїздку',
    HELP: '📚 Довідка',
};
/** Відповідність текстів кнопок командам. */
const MENU_BUTTON_TO_COMMAND = {
    [MAIN_MENU_BUTTONS.BOOK]: '/book',
    [MAIN_MENU_BUTTONS.MY_BOOKINGS]: '/mybookings',
    [MAIN_MENU_BUTTONS.ALL_RIDES]: '/allrides',
    [MAIN_MENU_BUTTONS.CANCEL]: '/cancel',
    [MAIN_MENU_BUTTONS.MY_DRIVER_RIDES]: '/mydriverrides',
    [MAIN_MENU_BUTTONS.MY_PASSENGER_RIDES]: '/mypassengerrides',
    [MAIN_MENU_BUTTONS.ADD_DRIVER_RIDE]: '/adddriverride',
    [MAIN_MENU_BUTTONS.ADD_PASSENGER_RIDE]: '/addpassengerride',
    [MAIN_MENU_BUTTONS.HELP]: '/help',
};
/** Reply-клавіатура (кнопки під полем вводу), згруповані в підменю. */
function getMainMenuKeyboard() {
    return {
        keyboard: [
            [{ text: MAIN_MENU_BUTTONS.BOOK }, { text: MAIN_MENU_BUTTONS.MY_BOOKINGS }],
            [{ text: MAIN_MENU_BUTTONS.ALL_RIDES }, { text: MAIN_MENU_BUTTONS.CANCEL }],
            [{ text: MAIN_MENU_BUTTONS.MY_DRIVER_RIDES }, { text: MAIN_MENU_BUTTONS.MY_PASSENGER_RIDES }],
            [{ text: MAIN_MENU_BUTTONS.ADD_DRIVER_RIDE }, { text: MAIN_MENU_BUTTONS.ADD_PASSENGER_RIDE }],
            [{ text: MAIN_MENU_BUTTONS.HELP }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
    };
}
/** Клавіатура «Поділитися номером» — єдина дія для користувача без номера. */
function getSharePhoneKeyboard() {
    return {
        keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
    };
}
/** Надіслати повідомлення «спочатку поділіться номером» і кнопку. Використовувати для будь-якої дії без реєстрації. */
async function sendSharePhoneOnly(chatId) {
    const text = '📱 <b>Спочатку поділіться номером телефону</b>\n\n' +
        'Щоб користуватися ботом (бронювання, попутки, сповіщення), надішліть номер:\n' +
        '• натисніть кнопку нижче або\n' +
        '• напишіть номер, наприклад 0501234567\n\n' +
        '🌐 Забронювати квиток на сайті: https://malin.kiev.ua';
    await bot?.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: getSharePhoneKeyboard(),
    });
}
/**
 * Налаштування обробників команд бота
 */
function setupBotCommands() {
    if (!bot)
        return;
    // Меню команд (кнопка "Menu" зліва від вводу тексту)
    bot.setMyCommands(CLIENT_BOT_COMMANDS).catch((err) => console.error('❌ setMyCommands:', err));
    const parseStartScenario = (text) => {
        if (!text)
            return null;
        const match = text.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
        const raw = match?.[1]?.trim().toLowerCase();
        if (!raw)
            return null;
        if (raw === 'driver' || raw === 'adddriverride')
            return 'driver';
        if (raw === 'passenger' || raw === 'addpassengerride')
            return 'passenger';
        if (raw === 'view' || raw === 'poputky' || raw === 'rides')
            return 'view';
        return null;
    };
    const startDriverRideFlow = async (chatId, userId) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        const routeKeyboard = {
            inline_keyboard: [
                [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
                [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
                [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
                [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
                [{ text: '🚌 Коростень → Малин', callback_data: 'adddriver_route_Korosten-Malyn' }],
                [{ text: '🚌 Малин → Коростень', callback_data: 'adddriver_route_Malyn-Korosten' }],
                [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
            ]
        };
        if (!userPhone) {
            driverRideStateMap.set(chatId, { state: 'driver_ride_flow', step: 'phone', since: Date.now() });
            const keyboard = {
                keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
                resize_keyboard: true,
                one_time_keyboard: true
            };
            await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n' +
                'Спочатку вкажіть номер телефону для контакту:\n' +
                '• натисніть кнопку нижче або\n' +
                '• напишіть номер, наприклад 0501234567', { parse_mode: 'HTML', reply_markup: keyboard });
            return;
        }
        driverRideStateMap.set(chatId, { state: 'driver_ride_flow', step: 'route', phone: userPhone, since: Date.now() });
        await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
    };
    const startPassengerRideFlow = async (chatId, userId) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        const routeKeyboard = {
            inline_keyboard: [
                [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
                [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
                [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
                [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
                [{ text: '🚌 Коростень → Малин', callback_data: 'addpassenger_route_Korosten-Malyn' }],
                [{ text: '🚌 Малин → Коростень', callback_data: 'addpassenger_route_Malyn-Korosten' }],
                [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
            ]
        };
        if (!userPhone) {
            passengerRideStateMap.set(chatId, { state: 'passenger_ride_flow', step: 'phone', since: Date.now() });
            const keyboard = {
                keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
                resize_keyboard: true,
                one_time_keyboard: true
            };
            await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n' +
                'Спочатку вкажіть номер телефону для контакту:\n' +
                '• натисніть кнопку нижче або\n' +
                '• напишіть номер, наприклад 0501234567', { parse_mode: 'HTML', reply_markup: keyboard });
            return;
        }
        passengerRideStateMap.set(chatId, { state: 'passenger_ride_flow', step: 'route', phone: userPhone, since: Date.now() });
        await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
    };
    const sendFreeViewInfo = async (chatId, replyMarkup) => {
        const links = getTelegramScenarioLinks();
        await bot?.sendMessage(chatId, '🌐 <b>Вільний перегляд попуток</b>\n\n' +
            'Без авторизації можна переглядати всі активні поїздки на сайті:\n' +
            `${links.poputkyWeb}\n\n` +
            'Швидкий старт у Telegram:\n' +
            `🚗 Водій: ${links.driver}\n` +
            `👤 Пасажир: ${links.passenger}`, { parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
    };
    // Команда /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        const firstName = msg.from?.first_name || 'Друже';
        const rawStart = msg.text?.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i)?.[1]?.trim() ?? '';
        // Посилання з /allrides: забронювати у водія (book_viber_ID)
        if (rawStart.startsWith('book_viber_')) {
            const driverListingId = parseInt(rawStart.replace('book_viber_', ''), 10);
            if (!isNaN(driverListingId)) {
                const result = await executeBookViberRideShare(chatId, userId, driverListingId, msg.from?.first_name ?? undefined);
                if (result.ok) {
                    await bot?.sendMessage(chatId, '✅ Запит на бронювання надіслано водію. Він отримає сповіщення і матиме 1 годину на підтвердження. Якщо підтвердить — ви побачите поїздку в /mybookings.', { parse_mode: 'HTML' });
                }
                else {
                    await sendSharePhoneOnly(chatId);
                }
                return;
            }
        }
        // Чернетка з сайту poputky: start=driver_TOKEN або passenger_TOKEN — дані вже заповнені, потрібен лише телефон (або публікація одразу)
        const draftMatch = rawStart.match(/^(driver|passenger)_([a-zA-Z0-9-]{4,32})$/);
        if (draftMatch) {
            const role = draftMatch[1];
            const draftToken = draftMatch[2];
            const draft = getAnnounceDraft(draftToken);
            if (draft && draft.role === role) {
                const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
                const senderName = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
                if (userPhone) {
                    if (role === 'driver') {
                        const state = { state: 'driver_ride_flow', step: 'notes', route: draft.route, date: draft.date, departureTime: draft.departureTime ?? undefined, seats: null, priceUah: draft.priceUah ?? null, phone: userPhone, since: Date.now() };
                        await createDriverListingFromState(chatId, state, draft.notes ?? null, senderName);
                    }
                    else {
                        const state = { state: 'passenger_ride_flow', step: 'notes', route: draft.route, date: draft.date, departureTime: draft.departureTime ?? null, phone: userPhone, since: Date.now() };
                        await createPassengerListingFromState(chatId, state, draft.notes ?? null, senderName);
                    }
                    await bot?.sendMessage(chatId, '✅ Дані з сайту прийнято. Оголошення опубліковано!', { parse_mode: 'HTML' });
                    return;
                }
                if (role === 'driver') {
                    driverRideStateMap.set(chatId, { state: 'driver_ride_flow', step: 'phone', draftToken, since: Date.now() });
                    const keyboard = { keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
                    await bot?.sendMessage(chatId, '📋 <b>Дані з сайту збережені</b> (маршрут, дата, час, примітки).\n\nЗалишилось лише вказати номер телефону для контактів:', { parse_mode: 'HTML', reply_markup: keyboard });
                }
                else {
                    passengerRideStateMap.set(chatId, { state: 'passenger_ride_flow', step: 'phone', draftToken, since: Date.now() });
                    const keyboard = { keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
                    await bot?.sendMessage(chatId, '📋 <b>Дані з сайту збережені</b> (маршрут, дата, час, примітки).\n\nЗалишилось лише вказати номер телефону для контактів:', { parse_mode: 'HTML', reply_markup: keyboard });
                }
                return;
            }
        }
        const startScenario = parseStartScenario(msg.text);
        const person = await (0, exports.getPersonByTelegram)(userId, chatId);
        const existingBooking = await prisma.booking.findFirst({
            where: { telegramUserId: userId },
        });
        const buildRegisteredWelcome = (displayPhone) => `
👋 Привіт знову, ${firstName}!

Я бот для бронювання маршруток <b>Київ, Житомир, Коростень ↔ Малин</b>.

✅ Ваш акаунт підключено до номера: ${displayPhone}

🎫 <b>Що можна зробити:</b>
/book - 🎫 Створити нове бронювання
/mybookings - 📋 Переглянути мої бронювання
/allrides - 🌐 Всі активні попутки
/cancel - 🚫 Скасувати бронювання
🚗 <b>Водій:</b>
/mydriverrides - Мої поїздки (які я пропоную)
/adddriverride - Додати поїздку як водій
👤 <b>Пасажир:</b>
/mypassengerrides - Мої запити на поїздку
/addpassengerride - Шукаю поїздку (додати запит)
/help - 📚 Показати повну довідку

🌐 <b>Або забронюйте на сайті:</b>
https://malin.kiev.ua
    `.trim();
        /** Якщо передано contactKeyboard, при сценарії view зберігаємо кнопку «Поділитися контактом» під повідомленням. */
        const handleStartScenario = async (contactKeyboard) => {
            if (!startScenario)
                return false;
            if (startScenario === 'driver') {
                await bot?.sendMessage(chatId, '🚗 Запускаю сценарій: <b>Запит на поїздку як водій</b>', { parse_mode: 'HTML' });
                await startDriverRideFlow(chatId, userId);
                return true;
            }
            if (startScenario === 'passenger') {
                await bot?.sendMessage(chatId, '👤 Запускаю сценарій: <b>Запит на поїздку як пасажир</b>', { parse_mode: 'HTML' });
                await startPassengerRideFlow(chatId, userId);
                return true;
            }
            await sendFreeViewInfo(chatId, contactKeyboard);
            return true;
        };
        if (person) {
            await prisma.person.updateMany({
                where: { id: person.id },
                data: { telegramChatId: chatId, telegramUserId: userId },
            });
            if (existingBooking) {
                await prisma.booking.updateMany({
                    where: { telegramUserId: userId, telegramChatId: null },
                    data: { telegramChatId: chatId },
                });
                await updatePersonAndBookingsTelegram(person.id, chatId, userId);
                console.log(`✅ Оновлено Person/Booking для користувача ${userId} при /start`);
            }
            const displayPhone = person.phoneNormalized ? formatPhoneTelLink(person.phoneNormalized) : (existingBooking ? formatPhoneTelLink(existingBooking.phone) : '');
            await bot?.sendMessage(chatId, buildRegisteredWelcome(displayPhone), {
                parse_mode: 'HTML',
                reply_markup: getMainMenuKeyboard(),
            });
            if (await handleStartScenario())
                return;
        }
        else {
            if (existingBooking) {
                await prisma.booking.updateMany({
                    where: { telegramUserId: userId, telegramChatId: null },
                    data: { telegramChatId: chatId },
                });
                const p = await (0, exports.findOrCreatePersonByPhone)(existingBooking.phone, {
                    fullName: existingBooking.name,
                    telegramChatId: chatId,
                    telegramUserId: userId,
                });
                await updatePersonAndBookingsTelegram(p.id, chatId, userId);
                console.log(`✅ Оновлено Person/Booking для користувача ${userId} при /start (з booking)`);
                const displayPhone = formatPhoneTelLink(p.phoneNormalized ?? existingBooking.phone);
                await bot?.sendMessage(chatId, buildRegisteredWelcome(displayPhone), {
                    parse_mode: 'HTML',
                    reply_markup: getMainMenuKeyboard(),
                });
                if (await handleStartScenario())
                    return;
                return;
            }
            // Новий користувач — показуємо тільки заклик поділитися номером (без інших команд і сценаріїв)
            const welcomeMessage = `
👋 Привіт, ${firstName}!

Я бот для бронювання маршруток <b>Київ, Житомир, Коростень ↔ Малин</b>.

📱 <b>Щоб продовжити, надішліть номер телефону:</b>
   • кнопкою нижче або
   • напишіть номер, наприклад 0501234567

Після цього зʼявиться меню бронювань, попуток та сповіщень.

🌐 Забронювати квиток на сайті: https://malin.kiev.ua
      `.trim();
            await bot?.sendMessage(chatId, welcomeMessage, {
                parse_mode: 'HTML',
                reply_markup: getSharePhoneKeyboard(),
            });
        }
    });
    // Команда /help — зареєстрований = є в Person (номер уже надано), не тільки по Booking
    bot.onText(/\/help/, async (msg) => {
        await handleHelp(msg.chat.id.toString(), msg.from?.id.toString() || '');
    });
    bot.onText(/\/poputky/, async (msg) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        if (!userPhone) {
            await sendSharePhoneOnly(chatId);
            return;
        }
        await sendFreeViewInfo(chatId);
    });
    const parseAllridesDateArg = (raw) => {
        const value = raw.trim().toLowerCase();
        if (!value)
            return null;
        if (value === 'сьогодні' || value === 'сегодня' || value === 'today') {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
        }
        if (value === 'завтра' || value === 'tomorrow') {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
            const year = Number(isoMatch[1]);
            const month = Number(isoMatch[2]);
            const day = Number(isoMatch[3]);
            const date = new Date(year, month - 1, day);
            if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
                return null;
            date.setHours(0, 0, 0, 0);
            return date;
        }
        const dotMatch = value.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
        if (dotMatch) {
            const day = Number(dotMatch[1]);
            const month = Number(dotMatch[2]);
            let year = dotMatch[3] ? Number(dotMatch[3]) : new Date().getFullYear();
            if (year < 100)
                year += 2000;
            const date = new Date(year, month - 1, day);
            if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
                return null;
            date.setHours(0, 0, 0, 0);
            return date;
        }
        return null;
    };
    const getAllridesFilterKeyboard = () => {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return [
            [
                { text: '📅 Майбутні', callback_data: 'allrides_filter_future' },
                { text: '🗂 Усі', callback_data: 'allrides_filter_all' },
            ],
            [
                { text: `🗓 Сьогодні (${formatDate(today)})`, callback_data: 'allrides_filter_today' },
                { text: `🗓 Завтра (${formatDate(tomorrow)})`, callback_data: 'allrides_filter_tomorrow' },
            ],
            [
                { text: '✏️ Ввести дату', callback_data: 'allrides_filter_custom' },
            ],
        ];
    };
    /** Ряд кнопок фільтра по часу для майбутніх попуток. */
    const getAllridesTimeFilterRow = () => [
        [
            { text: '🕐 Увесь день', callback_data: 'allrides_filter_future' },
            { text: '🌅 Ранок (до 12)', callback_data: 'allrides_filter_future_morning' },
            { text: '☀️ День (12–18)', callback_data: 'allrides_filter_future_afternoon' },
            { text: '🌙 Вечір (18+)', callback_data: 'allrides_filter_future_evening' },
        ],
    ];
    const sendAllrides = async (chatId, userId, filterRaw = '', timeSlot) => {
        try {
            const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
            if (!userPhone) {
                await sendSharePhoneOnly(chatId);
                return;
            }
            const normalizedFilter = filterRaw.trim().toLowerCase();
            const showAll = normalizedFilter === 'all' ||
                normalizedFilter === 'всі' ||
                normalizedFilter === 'усі' ||
                normalizedFilter === 'все';
            const selectedDate = !normalizedFilter || showAll ? null : parseAllridesDateArg(normalizedFilter);
            if (normalizedFilter && !showAll && !selectedDate) {
                await bot?.sendMessage(chatId, '❌ Невірний фільтр для /allrides.\n\n' +
                    'Використайте один з варіантів:\n' +
                    '• /allrides — майбутні попутки\n' +
                    '• /allrides all — усі активні\n' +
                    '• /allrides 21.02 або /allrides 2026-02-21 — попутки на дату', { parse_mode: 'HTML', reply_markup: { inline_keyboard: getAllridesFilterKeyboard() } });
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const nextDay = selectedDate ? new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000) : null;
            const where = { isActive: true };
            if (!showAll && selectedDate) {
                where.date = { gte: selectedDate, lt: nextDay };
            }
            else if (!showAll) {
                where.date = { gte: today };
            }
            let activeListings = await prisma.viberListing.findMany({
                where,
                orderBy: [{ date: 'asc' }, { departureTime: 'asc' }, { createdAt: 'desc' }],
                take: 80,
            });
            const isFutureView = !showAll && !selectedDate;
            if (isFutureView && timeSlot) {
                activeListings = activeListings.filter((l) => allridesListingMatchesTimeSlot(l.departureTime, timeSlot));
            }
            if (activeListings.length === 0) {
                await bot?.sendMessage(chatId, '📭 <b>Зараз немає активних попуток</b>\n\n' +
                    'Спробуйте змінити фільтр кнопками нижче або створіть свою поїздку:\n' +
                    '🚗 /adddriverride\n' +
                    '👤 /addpassengerride\n' +
                    '🌐 https://malin.kiev.ua/poputky', { parse_mode: 'HTML', reply_markup: { inline_keyboard: getAllridesFilterKeyboard() } });
                return;
            }
            const driverListings = activeListings.filter((l) => l.listingType === 'driver');
            const passengerListings = activeListings.filter((l) => l.listingType === 'passenger');
            const visibleDriverListings = driverListings.slice(0, 10);
            const formatListingRow = (listing) => {
                const time = listing.departureTime ?? '—';
                const seats = listing.seats != null ? `${listing.seats} місць` : '—';
                const author = (listing.senderName ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `• <b>#${listing.id}</b> ${getRouteName(listing.route)}\n` +
                    `   📅 ${formatDate(listing.date)} · 🕐 ${time}\n` +
                    `   👤 ${author} · 🎫 ${seats}\n` +
                    `   📞 ${formatPhoneTelLink(listing.phone)}`;
            };
            const timeSlotLabel = timeSlot === 'morning'
                ? 'ранок (до 12:00)'
                : timeSlot === 'afternoon'
                    ? 'день (12:00–18:00)'
                    : timeSlot === 'evening'
                        ? 'вечір (після 18:00)'
                        : null;
            const filterTitle = showAll
                ? 'усі активні'
                : selectedDate
                    ? `дата: ${formatDate(selectedDate)}`
                    : timeSlotLabel
                        ? `майбутні · ${timeSlotLabel}`
                        : 'майбутні';
            let message = `🌐 <b>Попутки (${filterTitle})</b>\n\n`;
            message += `🚗 Водії: ${driverListings.length} · 👤 Пасажири: ${passengerListings.length}\n`;
            message += '—\n\n';
            if (driverListings.length > 0) {
                message += '<b>🚗 Водії</b>\n\n';
                message += visibleDriverListings.map(formatListingRow).join('\n\n');
                if (driverListings.length > 10) {
                    message += `\n\n… ще ${driverListings.length - 10}`;
                }
                message += '\n\n';
            }
            if (passengerListings.length > 0) {
                message += '<b>👤 Пасажири</b>\n\n';
                message += passengerListings.slice(0, 10).map(formatListingRow).join('\n\n');
                if (passengerListings.length > 10) {
                    message += `\n\n… ще ${passengerListings.length - 10}`;
                }
            }
            const inlineKeyboard = [];
            // Водії, у яких можна забронювати (є Telegram): окремими повідомленнями з кнопкою під кожною пропозицією.
            const bookableDrivers = [];
            if (visibleDriverListings.length > 0) {
                const chatIds = await Promise.all(visibleDriverListings.map((d) => getChatIdForDriverListing(d)));
                const normalizedUserPhone = userPhone ? (0, exports.normalizePhone)(userPhone) : null;
                for (let i = 0; i < visibleDriverListings.length; i++) {
                    if (!chatIds[i])
                        continue;
                    const d = visibleDriverListings[i];
                    if (normalizedUserPhone && (0, exports.normalizePhone)(d.phone) === normalizedUserPhone)
                        continue;
                    bookableDrivers.push(d);
                }
            }
            if (userPhone) {
                const normalizedPhone = (0, exports.normalizePhone)(userPhone);
                const myDriverListings = driverListings.filter((l) => (0, exports.normalizePhone)(l.phone) === normalizedPhone);
                const myPassengerListings = passengerListings.filter((l) => (0, exports.normalizePhone)(l.phone) === normalizedPhone);
                const seenPassengerToDriver = new Set();
                for (const myPassenger of myPassengerListings.slice(0, 5)) {
                    const matches = await findMatchingDriversForPassenger({
                        route: myPassenger.route,
                        date: myPassenger.date,
                        departureTime: myPassenger.departureTime,
                    });
                    for (const match of matches) {
                        if (match.matchType !== 'exact')
                            continue;
                        if ((0, exports.normalizePhone)(match.listing.phone) === normalizedPhone)
                            continue;
                        const key = `${myPassenger.id}_${match.listing.id}`;
                        if (seenPassengerToDriver.has(key))
                            continue;
                        seenPassengerToDriver.add(key);
                        const driverName = truncateForButton(match.listing.senderName ?? 'Водій');
                        const shortPhone = formatShortPhoneForButton(match.listing.phone);
                        const timePart = match.listing.departureTime ?? '—';
                        inlineKeyboard.push([{
                                text: `🎫 ${driverName} · ${shortPhone} (${timePart})`,
                                callback_data: `vibermatch_book_${myPassenger.id}_${match.listing.id}`,
                            }]);
                        if (inlineKeyboard.length >= 10)
                            break;
                    }
                    if (inlineKeyboard.length >= 10)
                        break;
                }
                const seenDriverToPassenger = new Set();
                for (const myDriver of myDriverListings.slice(0, 5)) {
                    const matches = await findMatchingPassengersForDriver({
                        route: myDriver.route,
                        date: myDriver.date,
                        departureTime: myDriver.departureTime,
                    });
                    for (const match of matches) {
                        if (match.matchType !== 'exact')
                            continue;
                        if ((0, exports.normalizePhone)(match.listing.phone) === normalizedPhone)
                            continue;
                        const key = `${myDriver.id}_${match.listing.id}`;
                        if (seenDriverToPassenger.has(key))
                            continue;
                        seenDriverToPassenger.add(key);
                        const passengerName = truncateForButton(match.listing.senderName ?? 'Пасажир');
                        const shortPhone = formatShortPhoneForButton(match.listing.phone);
                        inlineKeyboard.push([{
                                text: `🤝 ${passengerName} · ${shortPhone}`,
                                callback_data: `vibermatch_book_driver_${myDriver.id}_${match.listing.id}`,
                            }]);
                        if (inlineKeyboard.length >= 20)
                            break;
                    }
                    if (inlineKeyboard.length >= 20)
                        break;
                }
                if (inlineKeyboard.length === 0) {
                    message += '\n\nℹ️ Для швидких дій потрібне точне співпадіння по маршруту, даті та часу (однаковий час або перетин інтервалів).\n' +
                        'Щоб з\'являлися кнопки швидких дій, додайте себе:\n' +
                        '🚗 Як водій: /adddriverride\n' +
                        '👤 Як пасажир: /addpassengerride';
                }
                // Якщо є точні співпадіння — їхні кнопки підуть окремим повідомленням нижче.
            }
            else {
                message += '\n\nℹ️ Щоб отримати персональні кнопки швидкого запиту, зареєструйте номер: /start';
            }
            // Перше повідомлення: тільки список і кнопки фільтрів (без кнопок бронювання — вони окремими повідомленнями).
            const filterKeyboard = [
                ...getAllridesFilterKeyboard(),
                ...(isFutureView ? getAllridesTimeFilterRow() : []),
            ];
            await bot?.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: filterKeyboard },
            });
            // Окреме повідомлення для кожного водія з Telegram: картка + посилання «Забронювати» (HTML, як інші лінки).
            const bookViberLink = (driverId) => `https://t.me/${telegramBotUsername}?start=book_viber_${driverId}`;
            for (const d of bookableDrivers) {
                const card = formatListingRow(d);
                const linkHtml = `<a href="${bookViberLink(d.id)}">🎫 Забронювати у водія #${d.id}</a>`;
                await bot?.sendMessage(chatId, `${card}\n\n${linkHtml}`, {
                    parse_mode: 'HTML',
                }).catch((err) => console.error('allrides: send driver card', err));
            }
            // Точні співпадіння — окремим повідомленням з кнопками.
            if (inlineKeyboard.length > 0) {
                await bot?.sendMessage(chatId, '🎯 <b>Точні співпадіння для вас:</b>\nНатисніть кнопку — запит буде надісланий другій стороні на підтвердження (1 година).', { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }).catch((err) => console.error('allrides: send exact matches', err));
            }
        }
        catch (error) {
            console.error('❌ Помилка /allrides:', error);
            await bot?.sendMessage(chatId, '❌ Помилка при отриманні списку поїздок. Спробуйте пізніше.');
        }
    };
    const handleBook = async (chatId, userId) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        if (!userPhone) {
            await sendSharePhoneOnly(chatId);
            return;
        }
        const directionKeyboard = {
            inline_keyboard: [
                [{ text: '🚌 Київ → Малин', callback_data: 'book_dir_Kyiv-Malyn' }],
                [{ text: '🚌 Малин → Київ', callback_data: 'book_dir_Malyn-Kyiv' }],
                [{ text: '🚌 Малин → Житомир', callback_data: 'book_dir_Malyn-Zhytomyr' }],
                [{ text: '🚌 Житомир → Малин', callback_data: 'book_dir_Zhytomyr-Malyn' }],
                [{ text: '🚌 Коростень → Малин', callback_data: 'book_dir_Korosten-Malyn' }],
                [{ text: '🚌 Малин → Коростень', callback_data: 'book_dir_Malyn-Korosten' }]
            ]
        };
        await bot?.sendMessage(chatId, '🎫 <b>Нове бронювання</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: directionKeyboard });
    };
    const handleHelp = async (chatId, userId) => {
        const person = await (0, exports.getPersonByTelegram)(userId, chatId);
        if (person) {
            const displayPhone = person.phoneNormalized ? formatPhoneTelLink(person.phoneNormalized) : '';
            const helpMessage = `📚 <b>Повна довідка по командах</b>

🎫 <b>Бронювання:</b>
/book - створити нове бронювання
/mybookings - переглянути мої бронювання
/allrides - всі активні попутки та швидкі дії
/cancel - скасувати бронювання

🚗 <b>Водій:</b>
/mydriverrides - мої поїздки (які я пропоную)
/adddriverride - додати поїздку як водій

👤 <b>Пасажир:</b>
/mypassengerrides - мої запити на поїздку
/addpassengerride - шукаю поїздку (додати запит)

📋 <b>Інше:</b>
/start - головне меню
/help - показати цю довідку
/allrides - показати всі активні попутки

✅ Ваш акаунт підключено до номера: ${displayPhone}

💡 <b>Що робить бот:</b>
• 🎫 Створює нові бронювання
• 📋 Показує тільки ваші бронювання
• 🚫 Дозволяє скасовувати бронювання
• 🚗 Додавати поїздки як водій та запити як пасажир
• ✅ Надсилає підтвердження після бронювання на сайті
• 🔔 Нагадує за день до поїздки

🌐 Сайт: https://malin.kiev.ua`.trim();
            await bot?.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
        }
        else {
            await sendSharePhoneOnly(chatId);
        }
    };
    const handleCancel = async (chatId, userId) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        if (!userPhone) {
            await sendSharePhoneOnly(chatId);
            return;
        }
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const futureBookings = await prisma.booking.findMany({
                where: { telegramUserId: userId, date: { gte: today } },
                orderBy: { date: 'asc' }
            });
            if (futureBookings.length === 0) {
                await bot?.sendMessage(chatId, '❌ <b>У вас немає майбутніх бронювань для скасування</b>\n\nСтворіть нове бронювання:\n🎫 /book - Забронювати квиток\n🌐 /allrides - Переглянути всі активні попутки\n🌐 https://malin.kiev.ua', { parse_mode: 'HTML' });
                return;
            }
            const keyboard = { inline_keyboard: futureBookings.map((b) => [{ text: `🎫 #${b.id}: ${getRouteName(b.route)} - ${formatDate(b.date)} о ${b.departureTime}`, callback_data: `cancel_${b.id}` }]) };
            await bot?.sendMessage(chatId, '🚫 <b>Скасування бронювання</b>\n\nОберіть бронювання для скасування:', { parse_mode: 'HTML', reply_markup: keyboard });
        }
        catch (error) {
            console.error('❌ Помилка при отриманні бронювань:', error);
            await bot?.sendMessage(chatId, '❌ Помилка. Спробуйте пізніше.');
        }
    };
    const handleMydriverrides = async (chatId, userId) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        if (!userPhone) {
            await sendSharePhoneOnly(chatId);
            return;
        }
        const normalized = (0, exports.normalizePhone)(userPhone);
        const listings = await prisma.viberListing.findMany({ where: { listingType: 'driver', isActive: true }, orderBy: [{ date: 'asc' }, { departureTime: 'asc' }] });
        const myListings = listings.filter((l) => (0, exports.normalizePhone)(l.phone ?? '') === normalized);
        if (myListings.length === 0) {
            await bot?.sendMessage(chatId, '🚗 <b>Мої поїздки (водій)</b>\n\nУ вас поки немає активних оголошень про поїздки.\n\nДодати поїздку: /adddriverride', { parse_mode: 'HTML' });
            return;
        }
        const lines = myListings.map((l) => {
            const time = l.departureTime ?? '—';
            const seats = l.seats != null ? `, ${l.seats} місць` : '';
            return `• ${getRouteName(l.route)} — ${formatDate(l.date)} о ${time}${seats}`;
        });
        await bot?.sendMessage(chatId, '🚗 <b>Мої поїздки (водій)</b>\n\n' + lines.join('\n') + '\n\nДодати ще: /adddriverride', { parse_mode: 'HTML' });
        // Співпадіння пасажирів для кожної моєї поїздки (прямі + приблизні)
        for (const myDriver of myListings.slice(0, 5)) {
            const matches = await findMatchingPassengersForDriver({
                route: myDriver.route,
                date: myDriver.date,
                departureTime: myDriver.departureTime ?? null,
            });
            const matchesFiltered = matches.filter((m) => (0, exports.normalizePhone)(m.listing.phone) !== normalized);
            const exactList = matchesFiltered.filter((m) => m.matchType === 'exact').map((m) => m.listing);
            const approxList = matchesFiltered.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
            const routeDateLabel = `${getRouteName(myDriver.route)}, ${formatDate(myDriver.date)} о ${myDriver.departureTime ?? '—'}`;
            if (exactList.length > 0) {
                const linesExact = exactList.map((p) => {
                    const time = p.departureTime ?? '—';
                    return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
                }).join('\n');
                const buttons = exactList.map((p) => ([
                    { text: `🤝 ${truncateForButton(p.senderName ?? 'Пасажир')} · ${formatShortPhoneForButton(p.phone)}`, callback_data: `vibermatch_book_driver_${myDriver.id}_${p.id}` }
                ]));
                await bot?.sendMessage(chatId, `🎯 <b>Пряме співпадіння для поїздки:</b> ${routeDateLabel}\n\n` + linesExact +
                    '\n\n_Натисніть кнопку — запит буде надісланий пасажиру на підтвердження (1 година)._', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch((err) => console.error('mydriverrides: exact matches', err));
            }
            if (approxList.length > 0) {
                const linesApprox = approxList.map((p) => {
                    const time = p.departureTime ?? '—';
                    return `• 👤 ${p.senderName ?? 'Пасажир'} — ${time}\n  📞 ${formatPhoneTelLink(p.phone)}${p.notes ? `\n  📝 ${p.notes}` : ''}`;
                }).join('\n');
                await bot?.sendMessage(chatId, `📌 <b>Приблизне співпадіння</b> (поїздка: ${routeDateLabel})\n\n` + linesApprox, { parse_mode: 'HTML' }).catch((err) => console.error('mydriverrides: approx matches', err));
            }
        }
    };
    const handleMypassengerrides = async (chatId, userId) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        if (!userPhone) {
            await sendSharePhoneOnly(chatId);
            return;
        }
        const normalized = (0, exports.normalizePhone)(userPhone);
        const listings = await prisma.viberListing.findMany({ where: { listingType: 'passenger', isActive: true }, orderBy: [{ date: 'asc' }, { departureTime: 'asc' }] });
        const myListings = listings.filter((l) => (0, exports.normalizePhone)(l.phone ?? '') === normalized);
        if (myListings.length === 0) {
            await bot?.sendMessage(chatId, '👤 <b>Мої запити (пасажир)</b>\n\nУ вас поки немає активних запитів на поїздку.\n\nДодати запит: /addpassengerride', { parse_mode: 'HTML' });
            return;
        }
        const lines = myListings.map((l) => `• ${getRouteName(l.route)} — ${formatDate(l.date)} о ${l.departureTime ?? '—'}`);
        await bot?.sendMessage(chatId, '👤 <b>Мої запити (пасажир)</b>\n\n' + lines.join('\n') + '\n\nДодати ще: /addpassengerride', { parse_mode: 'HTML' });
        // Співпадіння водіїв для кожного мого запиту (прямі + приблизні)
        for (const myPassenger of myListings.slice(0, 5)) {
            const matches = await findMatchingDriversForPassenger({
                route: myPassenger.route,
                date: myPassenger.date,
                departureTime: myPassenger.departureTime ?? null,
            });
            const matchesFiltered = matches.filter((m) => (0, exports.normalizePhone)(m.listing.phone) !== normalized);
            const exactList = matchesFiltered.filter((m) => m.matchType === 'exact').map((m) => m.listing);
            const approxList = matchesFiltered.filter((m) => m.matchType === 'approximate').map((m) => m.listing);
            const routeDateLabel = `${getRouteName(myPassenger.route)}, ${formatDate(myPassenger.date)} о ${myPassenger.departureTime ?? '—'}`;
            if (exactList.length > 0) {
                const linesExact = exactList.map((d) => {
                    const time = d.departureTime ?? '—';
                    return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
                }).join('\n');
                const buttons = exactList.map((d) => ([
                    { text: `🎫 ${truncateForButton(d.senderName ?? 'Водій')} · ${formatShortPhoneForButton(d.phone)} (${d.departureTime ?? '—'})`, callback_data: `vibermatch_book_${myPassenger.id}_${d.id}` }
                ]));
                await bot?.sendMessage(chatId, `🎯 <b>Пряме співпадіння для вашого запиту:</b> ${routeDateLabel}\n\n` + linesExact +
                    '\n\n_Натисніть кнопку — запит буде надісланий водію на підтвердження (1 година)._', { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch((err) => console.error('mypassengerrides: exact matches', err));
            }
            if (approxList.length > 0) {
                const linesApprox = approxList.map((d) => {
                    const time = d.departureTime ?? '—';
                    return `• 🚗 ${d.senderName ?? 'Водій'} — ${time}, ${d.seats != null ? d.seats + ' місць' : '—'}\n  📞 ${formatPhoneTelLink(d.phone)}${d.notes ? `\n  📝 ${d.notes}` : ''}`;
                }).join('\n');
                await bot?.sendMessage(chatId, `📌 <b>Приблизне співпадіння</b> (ваш запит: ${routeDateLabel})\n\n` + linesApprox, { parse_mode: 'HTML' }).catch((err) => console.error('mypassengerrides: approx matches', err));
            }
        }
    };
    const handleMybookings = async (chatId, userId) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        if (!userPhone) {
            await sendSharePhoneOnly(chatId);
            return;
        }
        try {
            await prisma.booking.updateMany({ where: { telegramUserId: userId, telegramChatId: null }, data: { telegramChatId: chatId } });
            const allUserBookings = await prisma.booking.findMany({ where: { telegramUserId: userId }, orderBy: { date: 'desc' } });
            if (allUserBookings.length > 0) {
                const userPhones = [...new Set(allUserBookings.map((b) => b.phone))];
                for (const phone of userPhones) {
                    const normalizedPhone = (0, exports.normalizePhone)(phone);
                    const allBookingsForPhone = await prisma.booking.findMany({ where: { OR: [{ telegramUserId: null }, { telegramUserId: '0' }, { telegramUserId: '' }] } });
                    const orphanedBookings = allBookingsForPhone.filter((b) => (0, exports.normalizePhone)(b.phone ?? '') === normalizedPhone);
                    if (orphanedBookings.length > 0) {
                        const person = await (0, exports.findOrCreatePersonByPhone)(phone, { telegramChatId: chatId, telegramUserId: userId });
                        for (const booking of orphanedBookings) {
                            await prisma.booking.update({ where: { id: booking.id }, data: { telegramUserId: userId, telegramChatId: chatId, personId: person.id } });
                        }
                    }
                }
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const futureBookings = await prisma.booking.findMany({
                where: { telegramUserId: userId, date: { gte: today } },
                orderBy: { date: 'asc' },
                take: 10,
                include: { viberListing: true }
            });
            const driverFutureBookings = await (0, exports.getDriverFutureBookingsForMybookings)(userId, chatId, today);
            if (futureBookings.length === 0) {
                const finalAllBookings = await prisma.booking.findMany({ where: { telegramUserId: userId }, orderBy: { date: 'desc' }, include: { viberListing: true } });
                if (finalAllBookings.length > 0) {
                    const recentPast = finalAllBookings.slice(0, 3);
                    let message = `📋 <b>Активних бронювань немає</b>\n\nАле знайдено ${finalAllBookings.length} минулих:\n\n`;
                    recentPast.forEach((booking, index) => {
                        const sourceLabel = booking.source === 'viber_match' ? ' · 🚗 Попутка' : '';
                        message += `${index + 1}. 🎫 <b>#${booking.id}</b>${sourceLabel}\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 ${booking.name}\n`;
                        if (booking.viberListing)
                            message += `   🚗 Водій: ${booking.viberListing.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.viberListing.phone)}\n`;
                        message += '\n';
                    });
                    if (driverFutureBookings.length > 0) {
                        message += `\n\n🚗 <b>Забронювали у вас (як у водія):</b>\n\n`;
                        driverFutureBookings.forEach((booking, index) => {
                            message += `${index + 1}. 🎫 <b>#${booking.id}</b>\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 Пасажир: ${booking.name}, 📞 ${formatPhoneTelLink(booking.phone)}\n\n`;
                        });
                    }
                    message += `\n💡 Створіть нове бронювання:\n🎫 /book - через бота\n🌐 /allrides - всі активні попутки\n🌐 https://malin.kiev.ua`;
                    await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
                }
                else {
                    let noBookingsMessage = `📋 <b>У вас поки немає бронювань</b>\n\n`;
                    if (driverFutureBookings.length > 0) {
                        driverFutureBookings.forEach((booking, index) => {
                            noBookingsMessage += `${index + 1}. 🎫 <b>#${booking.id}</b>\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 Пасажир: ${booking.name}, 📞 ${formatPhoneTelLink(booking.phone)}\n\n`;
                        });
                        noBookingsMessage += '\n';
                    }
                    noBookingsMessage += `Створіть нове бронювання:\n🎫 /book - через бота\n🌐 /allrides - всі активні попутки\n🌐 https://malin.kiev.ua`;
                    await bot?.sendMessage(chatId, noBookingsMessage, { parse_mode: 'HTML' });
                }
                return;
            }
            let message = `📋 <b>Ваші майбутні бронювання:</b>\n\n`;
            futureBookings.forEach((booking, index) => {
                const sourceLabel = booking.source === 'viber_match' ? ' · 🚗 Попутка' : '';
                message += `${index + 1}. 🎫 <b>Бронювання #${booking.id}</b>${sourceLabel}\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 ${booking.name}\n`;
                if (booking.viberListing)
                    message += `   🚗 Водій: ${booking.viberListing.senderName ?? '—'}, 📞 ${formatPhoneTelLink(booking.viberListing.phone)}\n`;
                message += '\n';
            });
            if (driverFutureBookings.length > 0) {
                message += `\n🚗 <b>Забронювали у вас (як у водія):</b>\n\n`;
                driverFutureBookings.forEach((booking, index) => {
                    message += `${index + 1}. 🎫 <b>#${booking.id}</b>\n   🚌 ${getRouteName(booking.route)}\n   📅 ${formatDate(booking.date)} о ${booking.departureTime}\n   🎫 Місць: ${booking.seats}\n   👤 Пасажир: ${booking.name}, 📞 ${formatPhoneTelLink(booking.phone)}\n\n`;
                });
            }
            message += `\n🔒 <i>Показано тільки ваші бронювання</i>`;
            await bot?.sendMessage(chatId, message, { parse_mode: 'HTML' });
        }
        catch (error) {
            console.error('❌ Помилка отримання бронювань:', error);
            await bot?.sendMessage(chatId, '❌ Помилка при отриманні бронювань. Спробуйте пізніше.');
        }
    };
    /** Виконання команди з кнопки головного меню (прямий виклик, без emit). */
    const runMenuCommand = async (chatId, userId, command) => {
        const userPhone = await (0, exports.getPhoneByTelegramUser)(userId, chatId);
        if (!userPhone) {
            await sendSharePhoneOnly(chatId);
            return;
        }
        switch (command) {
            case '/book':
                return handleBook(chatId, userId);
            case '/mybookings':
                return handleMybookings(chatId, userId);
            case '/allrides':
                return sendAllrides(chatId, userId, '');
            case '/cancel':
                return handleCancel(chatId, userId);
            case '/mydriverrides':
                return handleMydriverrides(chatId, userId);
            case '/mypassengerrides':
                return handleMypassengerrides(chatId, userId);
            case '/adddriverride':
                return startDriverRideFlow(chatId, userId);
            case '/addpassengerride':
                return startPassengerRideFlow(chatId, userId);
            case '/help':
                return handleHelp(chatId, userId);
            case '/poputky':
                return sendFreeViewInfo(chatId);
            default:
                return;
        }
    };
    // Команда /allrides — всі активні попутки + швидкі дії для зареєстрованого користувача
    // Підтримка фільтру: /allrides (майбутні), /allrides all (усі), /allrides DD.MM[.YYYY] або YYYY-MM-DD
    bot.onText(/^\/allrides(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        const filterRaw = (match?.[1] ?? '').trim();
        await sendAllrides(chatId, userId, filterRaw);
    });
    // Команда /addviber — тільки для адміна в адмін-чаті: очікує наступне повідомлення з текстом з Вайберу (як «Додати оголошення» в адмінці)
    bot.onText(/\/addviber/, async (msg) => {
        const chatId = msg.chat.id.toString();
        if (chatId !== adminChatId)
            return;
        addViberAwaitingMap.set(chatId, Date.now());
        await bot?.sendMessage(chatId, '📱 <b>Додати оголошення з Вайберу</b>\n\n' +
            'Надішліть текст оголошення — такий самий, як вставляєте в адмінці при кнопці «➕ Додати оголошення».\n\n' +
            'Можна одне повідомлення або кілька (скопіювати блок з чату). Через 10 хв очікування скасується.', { parse_mode: 'HTML' });
    });
    // Обробка контакту (коли користувач ділиться номером через кнопку)
    bot.on('contact', async (msg) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        const phoneNumber = msg.contact?.phone_number;
        if (!phoneNumber) {
            await bot?.sendMessage(chatId, '❌ Не вдалося отримати номер телефону.');
            return;
        }
        const driverState = driverRideStateMap.get(chatId);
        if (driverState?.state === 'driver_ride_flow' && driverState.step === 'phone') {
            const phone = (0, exports.normalizePhone)(phoneNumber);
            if (driverState.draftToken) {
                const draft = getAnnounceDraft(driverState.draftToken);
                if (draft) {
                    driverRideStateMap.set(chatId, { ...driverState, step: 'seats', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? undefined, priceUah: draft.priceUah ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
                    const seatsKeyboard = { inline_keyboard: [
                            [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
                            [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
                            [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
                            [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                        ] };
                    await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\n🎫 Скільки вільних місць?`, { parse_mode: 'HTML', reply_markup: seatsKeyboard });
                    return;
                }
            }
            driverRideStateMap.set(chatId, { ...driverState, step: 'route', phone, since: Date.now() });
            const routeKeyboard = {
                inline_keyboard: [
                    [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
                    [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
                    [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
                    [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
                    [{ text: '🚌 Коростень → Малин', callback_data: 'adddriver_route_Korosten-Malyn' }],
                    [{ text: '🚌 Малин → Коростень', callback_data: 'adddriver_route_Malyn-Korosten' }],
                    [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                ]
            };
            await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
            return;
        }
        const passengerState = passengerRideStateMap.get(chatId);
        if (passengerState?.state === 'passenger_ride_flow' && passengerState.step === 'phone') {
            const phone = (0, exports.normalizePhone)(phoneNumber);
            if (passengerState.draftToken) {
                const draft = getAnnounceDraft(passengerState.draftToken);
                if (draft) {
                    passengerRideStateMap.set(chatId, { ...passengerState, step: 'notes', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
                    const notesKeyboard = { inline_keyboard: [[{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }], [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]] };
                    const notesHint = draft.notes ? `\n\nПримітка з сайту: ${draft.notes}\nМожете залишити або змінити:` : '';
                    await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\nДодати примітку (опціонально)? Напишіть текст або натисніть Пропустити.${notesHint}`, { parse_mode: 'HTML', reply_markup: notesKeyboard });
                    return;
                }
            }
            passengerRideStateMap.set(chatId, { ...passengerState, step: 'route', phone, since: Date.now() });
            const routeKeyboard = {
                inline_keyboard: [
                    [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
                    [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
                    [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
                    [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
                    [{ text: '🚌 Коростень → Малин', callback_data: 'addpassenger_route_Korosten-Malyn' }],
                    [{ text: '🚌 Малин → Коростень', callback_data: 'addpassenger_route_Malyn-Korosten' }],
                    [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                ]
            };
            await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
            return;
        }
        const nameFromContact = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
        await registerUserPhone(chatId, userId, phoneNumber, nameFromContact);
    });
    // Обробка текстових повідомлень (номер телефону або текст поїздки водія)
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        const text = msg.text?.trim();
        // Кнопки головного меню: викликаємо обробник команди напряму (без emit — надійніше в node-telegram-bot-api)
        const command = text ? MENU_BUTTON_TO_COMMAND[text] : undefined;
        if (command && bot) {
            try {
                await runMenuCommand(chatId, userId, command);
            }
            catch (err) {
                console.error('❌ runMenuCommand:', err);
                await bot.sendMessage(chatId, '❌ Помилка виконання. Спробуйте ще раз або напишіть /help.');
            }
            return;
        }
        // Ігноруємо команди та контакти (вони обробляються окремо)
        if (msg.text?.startsWith('/') || msg.contact) {
            return;
        }
        if (!text)
            return;
        // Потік /addviber: адмін надіслав текст оголошення з Вайберу (та сама обробка, що в адмінці)
        if (chatId === adminChatId && addViberAwaitingMap.has(chatId)) {
            const since = addViberAwaitingMap.get(chatId);
            addViberAwaitingMap.delete(chatId);
            if (Date.now() - since > ADDVIBER_STATE_TTL_MS) {
                await bot?.sendMessage(chatId, '⏱ Час вийшов. Напишіть /addviber знову.');
                return;
            }
            try {
                const messageCount = (text.match(/\[.*?\]/g) || []).length;
                if (messageCount > 1) {
                    const parsedMessages = (0, viber_parser_1.parseViberMessages)(text);
                    if (parsedMessages.length === 0) {
                        await bot?.sendMessage(chatId, '❌ Не вдалося розпарсити жодне повідомлення. Перевірте формат.');
                        return;
                    }
                    let created = 0;
                    for (let i = 0; i < parsedMessages.length; i++) {
                        const { parsed, rawMessage: rawText } = parsedMessages[i];
                        try {
                            const nameFromDb = parsed.phone ? await (0, exports.getNameByPhone)(parsed.phone) : null;
                            let senderName = nameFromDb ?? parsed.senderName ?? null;
                            if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
                                const nameFromTg = await resolveNameByPhoneFromTelegram(parsed.phone);
                                if (nameFromTg?.trim())
                                    senderName = nameFromTg.trim();
                            }
                            const person = parsed.phone
                                ? await (0, exports.findOrCreatePersonByPhone)(parsed.phone, { fullName: senderName ?? undefined })
                                : null;
                            const { listing, isNew } = await createOrMergeViberListing({
                                rawMessage: rawText,
                                senderName: senderName ?? undefined,
                                listingType: parsed.listingType,
                                route: parsed.route,
                                date: parsed.date,
                                departureTime: parsed.departureTime,
                                seats: parsed.seats,
                                phone: parsed.phone,
                                notes: parsed.notes,
                                isActive: true,
                                personId: person?.id ?? undefined,
                            });
                            if (isNew) {
                                created++;
                            }
                            if ((0, exports.isTelegramEnabled)()) {
                                await (0, exports.sendViberListingNotificationToAdmin)({
                                    id: listing.id,
                                    listingType: listing.listingType,
                                    route: listing.route,
                                    date: listing.date,
                                    departureTime: listing.departureTime,
                                    seats: listing.seats,
                                    phone: listing.phone,
                                    senderName: listing.senderName,
                                    notes: listing.notes,
                                }).catch((err) => console.error('Telegram Viber notify:', err));
                                if (listing.phone?.trim()) {
                                    (0, exports.sendViberListingConfirmationToUser)(listing.phone, {
                                        id: listing.id,
                                        route: listing.route,
                                        date: listing.date,
                                        departureTime: listing.departureTime,
                                        seats: listing.seats,
                                        listingType: listing.listingType,
                                    }).catch((err) => console.error('Telegram Viber user notify:', err));
                                }
                                const authorChatId = listing.phone?.trim() ? await (0, exports.getChatIdByPhone)(listing.phone) : null;
                                if (listing.listingType === 'driver') {
                                    notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
                                }
                                else if (listing.listingType === 'passenger') {
                                    notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
                                }
                            }
                        }
                        catch (err) {
                            console.error(`AddViber bulk item ${i} error:`, err);
                        }
                    }
                    await bot?.sendMessage(chatId, `✅ Створено ${created} оголошень з ${parsedMessages.length}. Адміну надіслано сповіщення.`, { parse_mode: 'HTML' });
                }
                else {
                    const parsed = (0, viber_parser_1.parseViberMessage)(text);
                    if (!parsed) {
                        await bot?.sendMessage(chatId, '❌ Не вдалося розпарсити повідомлення. Перевірте формат.');
                        return;
                    }
                    const nameFromDb = parsed.phone ? await (0, exports.getNameByPhone)(parsed.phone) : null;
                    let senderName = nameFromDb ?? parsed.senderName ?? null;
                    if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
                        const nameFromTg = await resolveNameByPhoneFromTelegram(parsed.phone);
                        if (nameFromTg?.trim())
                            senderName = nameFromTg.trim();
                    }
                    const person = parsed.phone
                        ? await (0, exports.findOrCreatePersonByPhone)(parsed.phone, { fullName: senderName ?? undefined })
                        : null;
                    const { listing, isNew } = await createOrMergeViberListing({
                        rawMessage: text,
                        senderName: senderName ?? undefined,
                        listingType: parsed.listingType,
                        route: parsed.route,
                        date: parsed.date,
                        departureTime: parsed.departureTime,
                        seats: parsed.seats,
                        phone: parsed.phone,
                        notes: parsed.notes,
                        isActive: true,
                        personId: person?.id ?? undefined,
                    });
                    if ((0, exports.isTelegramEnabled)()) {
                        await (0, exports.sendViberListingNotificationToAdmin)({
                            id: listing.id,
                            listingType: listing.listingType,
                            route: listing.route,
                            date: listing.date,
                            departureTime: listing.departureTime,
                            seats: listing.seats,
                            phone: listing.phone,
                            senderName: listing.senderName,
                            notes: listing.notes,
                        }).catch((err) => console.error('Telegram Viber notify:', err));
                        if (listing.phone?.trim()) {
                            (0, exports.sendViberListingConfirmationToUser)(listing.phone, {
                                id: listing.id,
                                route: listing.route,
                                date: listing.date,
                                departureTime: listing.departureTime,
                                seats: listing.seats,
                                listingType: listing.listingType,
                            }).catch((err) => console.error('Telegram Viber user notify:', err));
                        }
                        const authorChatId = listing.phone?.trim() ? await (0, exports.getChatIdByPhone)(listing.phone) : null;
                        if (listing.listingType === 'driver') {
                            notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
                        }
                        else if (listing.listingType === 'passenger') {
                            notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
                        }
                    }
                    const verb = isNew ? 'створено' : 'оновлено';
                    await bot?.sendMessage(chatId, `✅ Оголошення #${listing.id} ${verb}. Адміну надіслано сповіщення.`, { parse_mode: 'HTML' });
                }
            }
            catch (err) {
                console.error('AddViber error:', err);
                await bot?.sendMessage(chatId, '❌ Помилка створення оголошення. Спробуйте /addviber знову.');
            }
            return;
        }
        // Потік /allrides: користувач обрав "Ввести дату" і надіслав дату текстом
        if (allridesAwaitingDateInputMap.has(chatId)) {
            const since = allridesAwaitingDateInputMap.get(chatId);
            if (Date.now() - since > ALLRIDES_FILTER_INPUT_TTL_MS) {
                allridesAwaitingDateInputMap.delete(chatId);
                await bot?.sendMessage(chatId, '⏱ Час на введення дати минув. Надішліть /allrides знову.');
                return;
            }
            const normalized = text.toLowerCase();
            if (normalized === 'скасувати' || normalized === 'cancel') {
                allridesAwaitingDateInputMap.delete(chatId);
                await bot?.sendMessage(chatId, '❌ Введення дати скасовано. Використайте /allrides для перегляду.');
                return;
            }
            const customDate = parseAllridesDateArg(text);
            if (!customDate) {
                await bot?.sendMessage(chatId, '❌ Не вдалося розпізнати дату.\n\n' +
                    'Введіть, наприклад:\n' +
                    '• 21.02\n' +
                    '• 21.02.2026\n' +
                    '• 2026-02-21\n\n' +
                    'Або напишіть "скасувати".');
                return;
            }
            allridesAwaitingDateInputMap.delete(chatId);
            await sendAllrides(chatId, userId, customDate.toISOString().slice(0, 10));
            return;
        }
        // Потік "додати поїздку (водій)" — введення дати, часу або примітки
        const driverState = driverRideStateMap.get(chatId);
        if (driverState?.state === 'driver_ride_flow') {
            if (Date.now() - driverState.since > DRIVER_RIDE_STATE_TTL_MS) {
                driverRideStateMap.delete(chatId);
                await bot?.sendMessage(chatId, '⏱ Час вийшов. /adddriverride — почати знову.');
                return;
            }
            const senderName = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
            if (driverState.step === 'date_custom') {
                const date = (0, viber_parser_1.extractDate)(text);
                const dateStr = date.toISOString().slice(0, 10);
                driverRideStateMap.set(chatId, { ...driverState, step: 'time', date: dateStr, since: Date.now() });
                const timeKeyboard = {
                    inline_keyboard: [
                        [{ text: '08:00', callback_data: 'adddriver_time_08:00' }, { text: '09:00', callback_data: 'adddriver_time_09:00' }, { text: '10:00', callback_data: 'adddriver_time_10:00' }],
                        [{ text: '11:00', callback_data: 'adddriver_time_11:00' }, { text: '12:00', callback_data: 'adddriver_time_12:00' }, { text: '13:00', callback_data: 'adddriver_time_13:00' }],
                        [{ text: '14:00', callback_data: 'adddriver_time_14:00' }, { text: '15:00', callback_data: 'adddriver_time_15:00' }, { text: '16:00', callback_data: 'adddriver_time_16:00' }],
                        [{ text: '17:00', callback_data: 'adddriver_time_17:00' }, { text: '18:00', callback_data: 'adddriver_time_18:00' }, { text: '19:00', callback_data: 'adddriver_time_19:00' }],
                        [{ text: '✏️ Свій час', callback_data: 'adddriver_time_custom' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.sendMessage(chatId, `📅 Дата: ${formatDate(date)}\n\n🕐 Оберіть час відправлення:`, { parse_mode: 'HTML', reply_markup: timeKeyboard });
                return;
            }
            if (driverState.step === 'time_custom') {
                const time = (0, viber_parser_1.extractTime)(text);
                if (!time) {
                    await bot?.sendMessage(chatId, 'Не вдалося розпізнати час. Напишіть, наприклад: 18:00 або о 9:30');
                    return;
                }
                driverRideStateMap.set(chatId, { ...driverState, step: 'seats', departureTime: time, since: Date.now() });
                const seatsKeyboard = {
                    inline_keyboard: [
                        [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
                        [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
                        [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.sendMessage(chatId, `🕐 Час: ${time}\n\n🎫 Скільки вільних місць?`, { parse_mode: 'HTML', reply_markup: seatsKeyboard });
                return;
            }
            if (driverState.step === 'price') {
                const num = parseInt(String(text).trim().replace(/\s/g, ''), 10);
                if (Number.isNaN(num) || num < 0) {
                    await bot?.sendMessage(chatId, 'Введіть число (ціна в гривнях), наприклад: 150, або натисніть Пропустити.');
                    return;
                }
                driverRideStateMap.set(chatId, { ...driverState, step: 'notes', priceUah: num, since: Date.now() });
                const notesKeyboard = {
                    inline_keyboard: [
                        [{ text: 'Пропустити', callback_data: 'adddriver_notes_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.sendMessage(chatId, `💰 Ціна: ${num} грн\n\n6️⃣ Додати примітку (опціонально)?\nНапишіть текст або натисніть Пропустити.`, { parse_mode: 'HTML', reply_markup: notesKeyboard });
                return;
            }
            if (driverState.step === 'notes') {
                driverRideStateMap.delete(chatId);
                try {
                    await createDriverListingFromState(chatId, driverState, text || null, senderName);
                }
                catch (err) {
                    console.error('Create driver listing error:', err);
                    await bot?.sendMessage(chatId, '❌ Помилка збереження. /adddriverride — спробувати знову.');
                }
                return;
            }
            if (driverState.step === 'phone') {
                const phoneRegex = /^[\+\d\s\-\(\)]{10,}$/;
                if (!phoneRegex.test(text)) {
                    await bot?.sendMessage(chatId, 'Введіть коректний номер телефону, наприклад: 0501234567');
                    return;
                }
                const phone = (0, exports.normalizePhone)(text);
                if (driverState.draftToken) {
                    const draft = getAnnounceDraft(driverState.draftToken);
                    if (draft) {
                        driverRideStateMap.set(chatId, { ...driverState, step: 'seats', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? undefined, priceUah: draft.priceUah ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
                        const seatsKeyboard = { inline_keyboard: [
                                [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
                                [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
                                [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
                                [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                            ] };
                        await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\n🎫 Скільки вільних місць?`, { parse_mode: 'HTML', reply_markup: seatsKeyboard });
                        return;
                    }
                }
                driverRideStateMap.set(chatId, { ...driverState, step: 'route', phone, since: Date.now() });
                const routeKeyboard = {
                    inline_keyboard: [
                        [{ text: '🚌 Київ → Малин', callback_data: 'adddriver_route_Kyiv-Malyn' }],
                        [{ text: '🚌 Малин → Київ', callback_data: 'adddriver_route_Malyn-Kyiv' }],
                        [{ text: '🚌 Малин → Житомир', callback_data: 'adddriver_route_Malyn-Zhytomyr' }],
                        [{ text: '🚌 Житомир → Малин', callback_data: 'adddriver_route_Zhytomyr-Malyn' }],
                        [{ text: '🚌 Коростень → Малин', callback_data: 'adddriver_route_Korosten-Malyn' }],
                        [{ text: '🚌 Малин → Коростень', callback_data: 'adddriver_route_Malyn-Korosten' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.sendMessage(chatId, '🚗 <b>Додати поїздку (водій)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
                return;
            }
        }
        // Потік "шукаю поїздку (пасажир)" — дата, час або примітка
        const passengerState = passengerRideStateMap.get(chatId);
        if (passengerState?.state === 'passenger_ride_flow') {
            if (Date.now() - passengerState.since > PASSENGER_RIDE_STATE_TTL_MS) {
                passengerRideStateMap.delete(chatId);
                await bot?.sendMessage(chatId, '⏱ Час вийшов. /addpassengerride — почати знову.');
                return;
            }
            const senderName = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
            if (passengerState.step === 'date_custom') {
                const date = (0, viber_parser_1.extractDate)(text);
                const dateStr = date.toISOString().slice(0, 10);
                passengerRideStateMap.set(chatId, { ...passengerState, step: 'time', date: dateStr, since: Date.now() });
                const timeKeyboard = {
                    inline_keyboard: [
                        [{ text: '08:00', callback_data: 'addpassenger_time_08:00' }, { text: '09:00', callback_data: 'addpassenger_time_09:00' }, { text: '10:00', callback_data: 'addpassenger_time_10:00' }],
                        [{ text: '11:00', callback_data: 'addpassenger_time_11:00' }, { text: '12:00', callback_data: 'addpassenger_time_12:00' }, { text: '13:00', callback_data: 'addpassenger_time_13:00' }],
                        [{ text: '14:00', callback_data: 'addpassenger_time_14:00' }, { text: '15:00', callback_data: 'addpassenger_time_15:00' }, { text: '16:00', callback_data: 'addpassenger_time_16:00' }],
                        [{ text: '17:00', callback_data: 'addpassenger_time_17:00' }, { text: '18:00', callback_data: 'addpassenger_time_18:00' }, { text: '19:00', callback_data: 'addpassenger_time_19:00' }],
                        [{ text: '✏️ Свій час', callback_data: 'addpassenger_time_custom' }, { text: 'Пропустити', callback_data: 'addpassenger_time_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                    ]
                };
                await bot?.sendMessage(chatId, `📅 Дата: ${formatDate(date)}\n\n🕐 Оберіть час (або Пропустити):`, { parse_mode: 'HTML', reply_markup: timeKeyboard });
                return;
            }
            if (passengerState.step === 'time_custom') {
                const time = (0, viber_parser_1.extractTime)(text);
                if (!time) {
                    await bot?.sendMessage(chatId, 'Не вдалося розпізнати час. Напишіть, наприклад: 18:00 або о 9:30');
                    return;
                }
                passengerRideStateMap.set(chatId, { ...passengerState, step: 'notes', departureTime: time, since: Date.now() });
                const notesKeyboard = {
                    inline_keyboard: [
                        [{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                    ]
                };
                await bot?.sendMessage(chatId, `🕐 Час: ${time}\n\nДодати примітку (опціонально)? Напишіть текст або натисніть Пропустити.`, { parse_mode: 'HTML', reply_markup: notesKeyboard });
                return;
            }
            if (passengerState.step === 'notes') {
                passengerRideStateMap.delete(chatId);
                try {
                    await createPassengerListingFromState(chatId, passengerState, text || null, senderName);
                }
                catch (err) {
                    console.error('Create passenger listing error:', err);
                    await bot?.sendMessage(chatId, '❌ Помилка збереження. /addpassengerride — спробувати знову.');
                }
                return;
            }
            if (passengerState.step === 'phone') {
                const phoneRegex = /^[\+\d\s\-\(\)]{10,}$/;
                if (!phoneRegex.test(text)) {
                    await bot?.sendMessage(chatId, 'Введіть коректний номер телефону, наприклад: 0501234567');
                    return;
                }
                const phone = (0, exports.normalizePhone)(text);
                if (passengerState.draftToken) {
                    const draft = getAnnounceDraft(passengerState.draftToken);
                    if (draft) {
                        passengerRideStateMap.set(chatId, { ...passengerState, step: 'notes', phone, route: draft.route, date: draft.date, departureTime: draft.departureTime ?? null, draftToken: undefined, notesFromDraft: draft.notes ?? null, since: Date.now() });
                        const notesKeyboard = { inline_keyboard: [[{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }], [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]] };
                        const notesHint = draft.notes ? `\n\nПримітка з сайту: ${draft.notes}\nМожете залишити або змінити:` : '';
                        await bot?.sendMessage(chatId, `🛣 ${getRouteName(draft.route)}\n📅 ${formatDate(new Date(draft.date))}\n${draft.departureTime ? `🕐 ${draft.departureTime}\n` : ''}\nДодати примітку (опціонально)? Напишіть текст або натисніть Пропустити.${notesHint}`, { parse_mode: 'HTML', reply_markup: notesKeyboard });
                        return;
                    }
                }
                passengerRideStateMap.set(chatId, { ...passengerState, step: 'route', phone, since: Date.now() });
                const routeKeyboard = {
                    inline_keyboard: [
                        [{ text: '🚌 Київ → Малин', callback_data: 'addpassenger_route_Kyiv-Malyn' }],
                        [{ text: '🚌 Малин → Київ', callback_data: 'addpassenger_route_Malyn-Kyiv' }],
                        [{ text: '🚌 Малин → Житомир', callback_data: 'addpassenger_route_Malyn-Zhytomyr' }],
                        [{ text: '🚌 Житомир → Малин', callback_data: 'addpassenger_route_Zhytomyr-Malyn' }],
                        [{ text: '🚌 Коростень → Малин', callback_data: 'addpassenger_route_Korosten-Malyn' }],
                        [{ text: '🚌 Малин → Коростень', callback_data: 'addpassenger_route_Malyn-Korosten' }],
                        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                    ]
                };
                await bot?.sendMessage(chatId, '👤 <b>Шукаю поїздку (пасажир)</b>\n\n1️⃣ Оберіть напрямок:', { parse_mode: 'HTML', reply_markup: routeKeyboard });
                return;
            }
        }
        // Перевіряємо чи це схоже на номер телефону
        const phoneRegex = /^[\+\d\s\-\(\)]{10,}$/;
        if (phoneRegex.test(text)) {
            const nameFromMessage = msg.from?.first_name ? [msg.from.first_name, msg.from?.last_name].filter(Boolean).join(' ') : null;
            await registerUserPhone(chatId, userId, text, nameFromMessage);
        }
        else {
            // Якщо користувач ще не зареєстрований, підказуємо
            const existingBooking = await prisma.booking.findFirst({
                where: { telegramUserId: userId }
            });
            if (!existingBooking) {
                await bot?.sendMessage(chatId, '❓ Для початку роботи, будь ласка, надішліть свій номер телефону.\n\n' +
                    'Використайте команду /start для інструкцій.');
            }
        }
    });
    // Команда /mybookings - показує ТІЛЬКИ бронювання поточного користувача
    bot.onText(/\/mybookings/, async (msg) => {
        await handleMybookings(msg.chat.id.toString(), msg.from?.id.toString() || '');
    });
    // Команда /cancel - скасування бронювання
    bot.onText(/\/cancel/, async (msg) => {
        await handleCancel(msg.chat.id.toString(), msg.from?.id.toString() || '');
    });
    // Команда /mydriverrides — мої поїздки як водій
    bot.onText(/\/mydriverrides/, async (msg) => {
        await handleMydriverrides(msg.chat.id.toString(), msg.from?.id.toString() || '');
    });
    // Команда /mypassengerrides — мої запити як пасажир
    bot.onText(/\/mypassengerrides/, async (msg) => {
        await handleMypassengerrides(msg.chat.id.toString(), msg.from?.id.toString() || '');
    });
    // Команда /adddriverride — додати поїздку як водій (меню)
    bot.onText(/\/adddriverride/, async (msg) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        await startDriverRideFlow(chatId, userId);
    });
    // Команда /addpassengerride — шукаю поїздку (пасажир)
    bot.onText(/\/addpassengerride/, async (msg) => {
        const chatId = msg.chat.id.toString();
        const userId = msg.from?.id.toString() || '';
        await startPassengerRideFlow(chatId, userId);
    });
    // Команда /book - створення нового бронювання
    bot.onText(/\/book/, async (msg) => {
        await handleBook(msg.chat.id.toString(), msg.from?.id.toString() || '');
    });
    // Обробка callback query (натискання inline кнопок)
    bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id.toString();
        const userId = query.from?.id.toString() || '';
        const data = query.data;
        const messageId = query.message?.message_id;
        if (!chatId || !data)
            return;
        try {
            // ---------- /allrides: фільтри списку ----------
            if (data === 'allrides_filter_future') {
                allridesAwaitingDateInputMap.delete(chatId);
                await sendAllrides(chatId, userId, '');
                await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки' });
                return;
            }
            if (data === 'allrides_filter_future_morning') {
                allridesAwaitingDateInputMap.delete(chatId);
                await sendAllrides(chatId, userId, '', 'morning');
                await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки (ранок)' });
                return;
            }
            if (data === 'allrides_filter_future_afternoon') {
                allridesAwaitingDateInputMap.delete(chatId);
                await sendAllrides(chatId, userId, '', 'afternoon');
                await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки (день)' });
                return;
            }
            if (data === 'allrides_filter_future_evening') {
                allridesAwaitingDateInputMap.delete(chatId);
                await sendAllrides(chatId, userId, '', 'evening');
                await bot?.answerCallbackQuery(query.id, { text: 'Показано майбутні попутки (вечір)' });
                return;
            }
            if (data === 'allrides_filter_all') {
                allridesAwaitingDateInputMap.delete(chatId);
                await sendAllrides(chatId, userId, 'all');
                await bot?.answerCallbackQuery(query.id, { text: 'Показано всі активні попутки' });
                return;
            }
            if (data === 'allrides_filter_today' || data === 'allrides_filter_tomorrow') {
                allridesAwaitingDateInputMap.delete(chatId);
                const d = data === 'allrides_filter_today' ? new Date() : (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t; })();
                d.setHours(0, 0, 0, 0);
                await sendAllrides(chatId, userId, d.toISOString().slice(0, 10));
                await bot?.answerCallbackQuery(query.id, { text: 'Фільтр за датою застосовано' });
                return;
            }
            if (data === 'allrides_filter_custom') {
                allridesAwaitingDateInputMap.set(chatId, Date.now());
                await bot?.sendMessage(chatId, '✏️ Введіть дату для /allrides, наприклад:\n' +
                    '• 21.02\n' +
                    '• 21.02.2026\n' +
                    '• 2026-02-21\n\n' +
                    'Або напишіть "скасувати".');
                await bot?.answerCallbackQuery(query.id, { text: 'Очікую дату від вас' });
                return;
            }
            // ---------- Потік "додати поїздку (водій)" ----------
            if (data === 'adddriver_cancel') {
                driverRideStateMap.delete(chatId);
                await bot?.editMessageText('❌ Скасовано. Можете почати знову кнопкою «🚗 Додати поїздку» або /adddriverride.', { chat_id: chatId, message_id: messageId });
                await bot?.sendMessage(chatId, 'Головне меню:', { reply_markup: getMainMenuKeyboard() });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data.startsWith('adddriver_route_')) {
                const route = data.replace('adddriver_route_', '');
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'route') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                driverRideStateMap.set(chatId, { ...state, step: 'date', route, since: Date.now() });
                const today = new Date();
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const dateKeyboard = {
                    inline_keyboard: [
                        [{ text: `Сьогодні (${formatDate(today)})`, callback_data: 'adddriver_date_today' }],
                        [{ text: `Завтра (${formatDate(tomorrow)})`, callback_data: 'adddriver_date_tomorrow' }],
                        [{ text: '✏️ Інша дата', callback_data: 'adddriver_date_custom' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.editMessageText(`🛣 Напрямок: ${getRouteName(route)}\n\n2️⃣ Оберіть дату:`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: dateKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'adddriver_date_today' || data === 'adddriver_date_tomorrow') {
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'date') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                const d = data === 'adddriver_date_today' ? new Date() : (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t; })();
                const dateStr = d.toISOString().slice(0, 10);
                driverRideStateMap.set(chatId, { ...state, step: 'time', date: dateStr, since: Date.now() });
                const timeKeyboard = {
                    inline_keyboard: [
                        [{ text: '08:00', callback_data: 'adddriver_time_08:00' }, { text: '09:00', callback_data: 'adddriver_time_09:00' }, { text: '10:00', callback_data: 'adddriver_time_10:00' }],
                        [{ text: '11:00', callback_data: 'adddriver_time_11:00' }, { text: '12:00', callback_data: 'adddriver_time_12:00' }, { text: '13:00', callback_data: 'adddriver_time_13:00' }],
                        [{ text: '14:00', callback_data: 'adddriver_time_14:00' }, { text: '15:00', callback_data: 'adddriver_time_15:00' }, { text: '16:00', callback_data: 'adddriver_time_16:00' }],
                        [{ text: '17:00', callback_data: 'adddriver_time_17:00' }, { text: '18:00', callback_data: 'adddriver_time_18:00' }, { text: '19:00', callback_data: 'adddriver_time_19:00' }],
                        [{ text: '✏️ Свій час', callback_data: 'adddriver_time_custom' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.editMessageText(`📅 Дата: ${formatDate(d)}\n\n3️⃣ Оберіть час:`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: timeKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'adddriver_date_custom') {
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'date') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                driverRideStateMap.set(chatId, { ...state, step: 'date_custom', since: Date.now() });
                await bot?.editMessageText('✏️ Напишіть дату, наприклад:\n• 15.02\n• завтра\n• сьогодні', { chat_id: chatId, message_id: messageId });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data.startsWith('adddriver_time_') && data !== 'adddriver_time_custom') {
                const time = data.replace('adddriver_time_', '');
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'time') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                driverRideStateMap.set(chatId, { ...state, step: 'seats', departureTime: time, since: Date.now() });
                const seatsKeyboard = {
                    inline_keyboard: [
                        [{ text: '1', callback_data: 'adddriver_seats_1' }, { text: '2', callback_data: 'adddriver_seats_2' }, { text: '3', callback_data: 'adddriver_seats_3' }],
                        [{ text: '4', callback_data: 'adddriver_seats_4' }, { text: '5', callback_data: 'adddriver_seats_5' }],
                        [{ text: 'Пропустити', callback_data: 'adddriver_seats_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.editMessageText(`🕐 Час: ${time}\n\n4️⃣ Скільки вільних місць?`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: seatsKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'adddriver_time_custom') {
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'time') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                driverRideStateMap.set(chatId, { ...state, step: 'time_custom', since: Date.now() });
                await bot?.editMessageText('✏️ Напишіть час, наприклад: 18:00 або о 9:30', { chat_id: chatId, message_id: messageId });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data.startsWith('adddriver_seats_')) {
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'seats') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                const seats = data === 'adddriver_seats_skip' ? null : parseInt(data.replace('adddriver_seats_', ''), 10);
                driverRideStateMap.set(chatId, { ...state, step: 'price', seats: seats ?? undefined, since: Date.now() });
                const priceKeyboard = {
                    inline_keyboard: [
                        [{ text: 'Пропустити', callback_data: 'adddriver_price_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.editMessageText((state.departureTime ? `🕐 Час: ${state.departureTime}\n` : '') +
                    (seats != null ? `🎫 Місць: ${seats}\n\n` : '') +
                    '5️⃣ Ціна в грн (опціонально)?\nНапишіть число або натисніть Пропустити.', { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: priceKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'adddriver_price_skip') {
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'price') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                driverRideStateMap.set(chatId, { ...state, step: 'notes', since: Date.now() });
                const notesKeyboard = {
                    inline_keyboard: [
                        [{ text: 'Пропустити', callback_data: 'adddriver_notes_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'adddriver_cancel' }]
                    ]
                };
                await bot?.editMessageText((state.departureTime ? `🕐 Час: ${state.departureTime}\n` : '') +
                    (state.seats != null ? `🎫 Місць: ${state.seats}\n` : '') +
                    '\n6️⃣ Додати примітку (опціонально)?\nНапишіть текст або натисніть Пропустити.', { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: notesKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'adddriver_notes_skip') {
                const state = driverRideStateMap.get(chatId);
                if (!state || state.state !== 'driver_ride_flow' || state.step !== 'notes') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                driverRideStateMap.delete(chatId);
                const senderName = query.from?.first_name ? [query.from.first_name, query.from?.last_name].filter(Boolean).join(' ') : null;
                const notes = state.notesFromDraft ?? null;
                try {
                    await createDriverListingFromState(chatId, state, notes, senderName);
                }
                catch (err) {
                    console.error('Create driver listing error:', err);
                    await bot?.sendMessage(chatId, '❌ Помилка збереження. /adddriverride — спробувати знову.');
                }
                await bot?.editMessageText('✅ Готово! Оголошення створено.', { chat_id: chatId, message_id: messageId });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            // ---------- Потік "шукаю поїздку (пасажир)" ----------
            if (data === 'addpassenger_cancel') {
                passengerRideStateMap.delete(chatId);
                await bot?.editMessageText('❌ Скасовано. Можете почати знову кнопкою «👤 Шукаю поїздку» або /addpassengerride.', { chat_id: chatId, message_id: messageId });
                await bot?.sendMessage(chatId, 'Головне меню:', { reply_markup: getMainMenuKeyboard() });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data.startsWith('addpassenger_route_')) {
                const route = data.replace('addpassenger_route_', '');
                const state = passengerRideStateMap.get(chatId);
                if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'route') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                passengerRideStateMap.set(chatId, { ...state, step: 'date', route, since: Date.now() });
                const today = new Date();
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const dateKeyboard = {
                    inline_keyboard: [
                        [{ text: `Сьогодні (${formatDate(today)})`, callback_data: 'addpassenger_date_today' }],
                        [{ text: `Завтра (${formatDate(tomorrow)})`, callback_data: 'addpassenger_date_tomorrow' }],
                        [{ text: '✏️ Інша дата', callback_data: 'addpassenger_date_custom' }],
                        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                    ]
                };
                await bot?.editMessageText(`🛣 Напрямок: ${getRouteName(route)}\n\n2️⃣ Оберіть дату:`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: dateKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'addpassenger_date_today' || data === 'addpassenger_date_tomorrow') {
                const state = passengerRideStateMap.get(chatId);
                if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'date') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                const d = data === 'addpassenger_date_today' ? new Date() : (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t; })();
                const dateStr = d.toISOString().slice(0, 10);
                passengerRideStateMap.set(chatId, { ...state, step: 'time', date: dateStr, since: Date.now() });
                const timeKeyboard = {
                    inline_keyboard: [
                        [{ text: '08:00', callback_data: 'addpassenger_time_08:00' }, { text: '09:00', callback_data: 'addpassenger_time_09:00' }, { text: '10:00', callback_data: 'addpassenger_time_10:00' }],
                        [{ text: '11:00', callback_data: 'addpassenger_time_11:00' }, { text: '12:00', callback_data: 'addpassenger_time_12:00' }, { text: '13:00', callback_data: 'addpassenger_time_13:00' }],
                        [{ text: '14:00', callback_data: 'addpassenger_time_14:00' }, { text: '15:00', callback_data: 'addpassenger_time_15:00' }, { text: '16:00', callback_data: 'addpassenger_time_16:00' }],
                        [{ text: '17:00', callback_data: 'addpassenger_time_17:00' }, { text: '18:00', callback_data: 'addpassenger_time_18:00' }, { text: '19:00', callback_data: 'addpassenger_time_19:00' }],
                        [{ text: '✏️ Свій час', callback_data: 'addpassenger_time_custom' }, { text: 'Пропустити', callback_data: 'addpassenger_time_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                    ]
                };
                await bot?.editMessageText(`📅 Дата: ${formatDate(d)}\n\n3️⃣ Оберіть час (або Пропустити):`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: timeKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'addpassenger_date_custom') {
                const state = passengerRideStateMap.get(chatId);
                if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'date') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                passengerRideStateMap.set(chatId, { ...state, step: 'date_custom', since: Date.now() });
                await bot?.editMessageText('✏️ Напишіть дату, наприклад:\n• 15.02\n• завтра\n• сьогодні', { chat_id: chatId, message_id: messageId });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data.startsWith('addpassenger_time_') && data !== 'addpassenger_time_custom' && data !== 'addpassenger_time_skip') {
                const time = data.replace('addpassenger_time_', '');
                const state = passengerRideStateMap.get(chatId);
                if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'time') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                passengerRideStateMap.set(chatId, { ...state, step: 'notes', departureTime: time, since: Date.now() });
                const notesKeyboard = {
                    inline_keyboard: [
                        [{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                    ]
                };
                await bot?.editMessageText(`🕐 Час: ${time}\n\n4️⃣ Додати примітку (опціонально)? Напишіть текст або натисніть Пропустити.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: notesKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'addpassenger_time_skip') {
                const state = passengerRideStateMap.get(chatId);
                if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'time') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                passengerRideStateMap.set(chatId, { ...state, step: 'notes', departureTime: null, since: Date.now() });
                const notesKeyboard = {
                    inline_keyboard: [
                        [{ text: 'Пропустити', callback_data: 'addpassenger_notes_skip' }],
                        [{ text: '❌ Скасувати', callback_data: 'addpassenger_cancel' }]
                    ]
                };
                await bot?.editMessageText('4️⃣ Додати примітку (опціонально)? Напишіть текст або натисніть Пропустити.', { chat_id: chatId, message_id: messageId, reply_markup: notesKeyboard });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'addpassenger_time_custom') {
                const state = passengerRideStateMap.get(chatId);
                if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'time') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                passengerRideStateMap.set(chatId, { ...state, step: 'time_custom', since: Date.now() });
                await bot?.editMessageText('✏️ Напишіть час, наприклад: 18:00 або о 9:30', { chat_id: chatId, message_id: messageId });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            if (data === 'addpassenger_notes_skip') {
                const state = passengerRideStateMap.get(chatId);
                if (!state || state.state !== 'passenger_ride_flow' || state.step !== 'notes') {
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                passengerRideStateMap.delete(chatId);
                const senderName = query.from?.first_name ? [query.from.first_name, query.from?.last_name].filter(Boolean).join(' ') : null;
                const notes = state.notesFromDraft ?? null;
                try {
                    await createPassengerListingFromState(chatId, state, notes, senderName);
                }
                catch (err) {
                    console.error('Create passenger listing error:', err);
                    await bot?.sendMessage(chatId, '❌ Помилка збереження. /addpassengerride — спробувати знову.');
                }
                await bot?.editMessageText('✅ Готово! Запит на поїздку створено.', { chat_id: chatId, message_id: messageId });
                await bot?.answerCallbackQuery(query.id);
                return;
            }
            // ---------- Попутка: водій надсилає запит пасажиру (реверс) ----------
            if (data.startsWith('vibermatch_book_driver_')) {
                const parts = data.replace('vibermatch_book_driver_', '').split('_');
                const driverListingId = parseInt(parts[0], 10);
                const passengerListingId = parseInt(parts[1], 10);
                if (isNaN(driverListingId) || isNaN(passengerListingId)) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка даних' });
                    return;
                }
                const [driverListing, passengerListing] = await Promise.all([
                    prisma.viberListing.findUnique({ where: { id: driverListingId } }),
                    prisma.viberListing.findUnique({ where: { id: passengerListingId } }),
                ]);
                if (!driverListing || !passengerListing || driverListing.listingType !== 'driver' || passengerListing.listingType !== 'passenger') {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Оголошення не знайдено' });
                    return;
                }
                const driverPerson = await (0, exports.getPersonByTelegram)(userId, chatId);
                const isDriverOwner = !!driverPerson && (0, exports.normalizePhone)(driverPerson.phoneNormalized) === (0, exports.normalizePhone)(driverListing.phone);
                if (!isDriverOwner) {
                    await bot?.answerCallbackQuery(query.id, { text: 'Ця дія доступна тільки водію цього оголошення' });
                    return;
                }
                const passengerChatId = await (0, exports.getChatIdByPhone)(passengerListing.phone);
                if (!passengerChatId) {
                    await bot?.answerCallbackQuery(query.id, { text: 'Пасажир не підключений до Telegram' });
                    return;
                }
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
                const request = await prisma.rideShareRequest.create({
                    data: { passengerListingId, driverListingId, status: 'pending', expiresAt },
                });
                const confirmKeyboard = {
                    inline_keyboard: [[{ text: '✅ Підтвердити поїздку (1 год)', callback_data: `vibermatch_confirm_passenger_${request.id}` }]],
                };
                await bot?.sendMessage(passengerChatId, `🎫 <b>Водій пропонує поїздку</b>\n\n` +
                    `🚗 ${driverListing.senderName ?? 'Водій'} пропонує вам поїздку.\n\n` +
                    `🛣 ${getRouteName(driverListing.route)}\n` +
                    `📅 ${formatDate(driverListing.date)}\n` +
                    (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
                    `📞 ${formatPhoneTelLink(driverListing.phone)}` +
                    (driverListing.notes ? `\n📝 ${driverListing.notes}` : '') +
                    `\n\n_У вас є 1 година на підтвердження._`, { parse_mode: 'HTML', reply_markup: confirmKeyboard }).catch(() => { });
                await bot?.answerCallbackQuery(query.id, { text: 'Запит надіслано пасажиру. Очікуйте підтвердження (1 год).' });
                await bot?.sendMessage(chatId, '✅ Запит надіслано пасажиру. Він отримає сповіщення і матиме 1 годину на підтвердження.', { parse_mode: 'HTML' }).catch(() => { });
                return;
            }
            // ---------- Попутка: пасажир натиснув "Забронювати у водія" ----------
            if (data.startsWith('vibermatch_book_')) {
                const parts = data.replace('vibermatch_book_', '').split('_');
                const passengerListingId = parseInt(parts[0], 10);
                const driverListingId = parseInt(parts[1], 10);
                if (isNaN(passengerListingId) || isNaN(driverListingId)) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка даних' });
                    return;
                }
                const [passengerListing, driverListing] = await Promise.all([
                    prisma.viberListing.findUnique({ where: { id: passengerListingId } }),
                    prisma.viberListing.findUnique({ where: { id: driverListingId } })
                ]);
                if (!passengerListing || !driverListing || passengerListing.listingType !== 'passenger' || driverListing.listingType !== 'driver') {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Оголошення не знайдено' });
                    return;
                }
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 година
                const request = await prisma.rideShareRequest.create({
                    data: { passengerListingId, driverListingId, status: 'pending', expiresAt }
                });
                const driverChatId = await (0, exports.getChatIdByPhone)(driverListing.phone);
                const passengerName = passengerListing.senderName ?? 'Пасажир';
                if (driverChatId) {
                    const confirmKeyboard = {
                        inline_keyboard: [[{ text: '✅ Підтвердити бронювання (1 год)', callback_data: `vibermatch_confirm_${request.id}` }]]
                    };
                    await bot?.sendMessage(driverChatId, `🎫 <b>Запит на попутку</b>\n\n` +
                        `👤 ${passengerName} хоче поїхати з вами.\n\n` +
                        `🛣 ${getRouteName(driverListing.route)}\n` +
                        `📅 ${formatDate(driverListing.date)}\n` +
                        (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
                        `📞 ${formatPhoneTelLink(passengerListing.phone)}` +
                        (passengerListing.notes ? `\n📝 ${passengerListing.notes}` : '') +
                        `\n\n_У вас є 1 година на підтвердження._`, { parse_mode: 'HTML', reply_markup: confirmKeyboard }).catch(() => { });
                }
                await bot?.answerCallbackQuery(query.id, { text: 'Запит надіслано водію. Очікуйте підтвердження (1 год).' });
                await bot?.sendMessage(chatId, '✅ Запит на бронювання надіслано водію. Він отримає сповіщення і матиме 1 годину на підтвердження. Якщо підтвердить — ви побачите поїздку в /mybookings.', { parse_mode: 'HTML' }).catch(() => { });
                return;
            }
            // ---------- /book: немає рейсів — пасажир натиснув "Забронювати у водія" (кнопка або посилання) ----------
            if (data.startsWith('book_viber_')) {
                const driverListingId = parseInt(data.replace('book_viber_', ''), 10);
                if (isNaN(driverListingId)) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка даних' });
                    return;
                }
                const result = await executeBookViberRideShare(chatId, userId, driverListingId, query.from?.first_name ?? undefined);
                if (result.ok) {
                    await bot?.answerCallbackQuery(query.id, { text: 'Запит надіслано водію. Очікуйте підтвердження (1 год).' });
                    await bot?.sendMessage(chatId, '✅ Запит на бронювання надіслано водію. Він отримає сповіщення і матиме 1 годину на підтвердження. Якщо підтвердить — ви побачите поїздку в /mybookings.', { parse_mode: 'HTML' }).catch(() => { });
                }
                else {
                    await bot?.answerCallbackQuery(query.id, { text: 'Спочатку поділіться номером телефону' });
                    await sendSharePhoneOnly(chatId);
                }
                return;
            }
            // ---------- Попутка: водій натиснув "Підтвердити бронювання" ----------
            if (data.startsWith('vibermatch_confirm_') && !data.startsWith('vibermatch_confirm_passenger_')) {
                const requestId = parseInt(data.replace('vibermatch_confirm_', ''), 10);
                if (isNaN(requestId)) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
                    return;
                }
                const request = await prisma.rideShareRequest.findUnique({
                    where: { id: requestId },
                    include: { passengerListing: true, driverListing: true }
                });
                if (!request) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Запит не знайдено' });
                    return;
                }
                if (request.status !== 'pending') {
                    await bot?.answerCallbackQuery(query.id, { text: request.status === 'confirmed' ? '✅ Вже підтверджено' : 'Запит не активний' });
                    return;
                }
                if (new Date() > request.expiresAt) {
                    await prisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'expired' } });
                    await bot?.answerCallbackQuery(query.id, { text: '⏱ Час на підтвердження минув' });
                    return;
                }
                const { passengerListing, driverListing } = request;
                await (0, exports.findOrCreatePersonByPhone)(passengerListing.phone, { fullName: passengerListing.senderName ?? undefined });
                const passengerPerson = await (0, exports.getPersonByPhone)(passengerListing.phone);
                const driverPerson = await (0, exports.getPersonByTelegram)(userId, chatId);
                const isDriver = driverPerson && (0, exports.normalizePhone)(driverPerson.phoneNormalized) === (0, exports.normalizePhone)(driverListing.phone);
                if (!isDriver) {
                    await bot?.answerCallbackQuery(query.id, { text: 'Це підтвердження лише для водія цієї поїздки' });
                    return;
                }
                if (!passengerPerson) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка: пасажир не знайдений' });
                    return;
                }
                const booking = await prisma.booking.create({
                    data: {
                        route: driverListing.route,
                        date: driverListing.date,
                        departureTime: driverListing.departureTime ?? '—',
                        seats: 1,
                        name: passengerListing.senderName ?? 'Пасажир',
                        phone: passengerListing.phone,
                        personId: passengerPerson.id,
                        telegramChatId: passengerPerson.telegramChatId,
                        telegramUserId: passengerPerson.telegramUserId,
                        source: 'viber_match',
                        viberListingId: driverListing.id
                    }
                });
                await prisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'confirmed' } });
                const passengerChatId = passengerPerson.telegramChatId;
                if (passengerChatId) {
                    await bot?.sendMessage(passengerChatId, `✅ <b>Водій підтвердив ваше бронювання!</b>\n\n` +
                        `🎫 №${booking.id} · 🚗 Попутка\n` +
                        `🛣 ${getRouteName(driverListing.route)}\n` +
                        `📅 ${formatDate(driverListing.date)}\n` +
                        (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
                        `👤 Водій: ${driverListing.senderName ?? '—'}\n` +
                        `📞 ${formatPhoneTelLink(driverListing.phone)}\n\n` +
                        `Поїздка з\'явиться у /mybookings.`, { parse_mode: 'HTML' }).catch(() => { });
                }
                await bot?.answerCallbackQuery(query.id, { text: 'Бронювання підтверджено! Пасажир отримав сповіщення.' });
                await bot?.sendMessage(chatId, '✅ Ви підтвердили бронювання. Пасажир отримав сповіщення.', { parse_mode: 'HTML' }).catch(() => { });
                if (adminChatId) {
                    await bot?.sendMessage(adminChatId, `🚗 <b>Попутка підтверджена</b>\n\n` +
                        `Бронювання #${booking.id} (viber_match)\n` +
                        `Пасажир: ${booking.name}, ${formatPhoneTelLink(booking.phone)}\n` +
                        `Водій: ${driverListing.senderName ?? '—'}, ${formatPhoneTelLink(driverListing.phone)}\n` +
                        `${getRouteName(driverListing.route)} · ${formatDate(driverListing.date)}`, { parse_mode: 'HTML' }).catch(() => { });
                }
                return;
            }
            // ---------- Попутка: пасажир підтверджує запит від водія (реверс) ----------
            if (data.startsWith('vibermatch_confirm_passenger_')) {
                const requestId = parseInt(data.replace('vibermatch_confirm_passenger_', ''), 10);
                if (isNaN(requestId)) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
                    return;
                }
                const request = await prisma.rideShareRequest.findUnique({
                    where: { id: requestId },
                    include: { passengerListing: true, driverListing: true },
                });
                if (!request) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Запит не знайдено' });
                    return;
                }
                if (request.status !== 'pending') {
                    await bot?.answerCallbackQuery(query.id, { text: request.status === 'confirmed' ? '✅ Вже підтверджено' : 'Запит не активний' });
                    return;
                }
                if (new Date() > request.expiresAt) {
                    await prisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'expired' } });
                    await bot?.answerCallbackQuery(query.id, { text: '⏱ Час на підтвердження минув' });
                    return;
                }
                const { passengerListing, driverListing } = request;
                await (0, exports.findOrCreatePersonByPhone)(passengerListing.phone, { fullName: passengerListing.senderName ?? undefined });
                const passengerPerson = await (0, exports.getPersonByTelegram)(userId, chatId);
                const isPassenger = !!passengerPerson && (0, exports.normalizePhone)(passengerPerson.phoneNormalized) === (0, exports.normalizePhone)(passengerListing.phone);
                if (!isPassenger) {
                    await bot?.answerCallbackQuery(query.id, { text: 'Це підтвердження лише для пасажира цього запиту' });
                    return;
                }
                const booking = await prisma.booking.create({
                    data: {
                        route: driverListing.route,
                        date: driverListing.date,
                        departureTime: driverListing.departureTime ?? '—',
                        seats: 1,
                        name: passengerListing.senderName ?? passengerPerson.fullName?.trim() ?? 'Пасажир',
                        phone: passengerListing.phone,
                        personId: passengerPerson.id,
                        telegramChatId: passengerPerson.telegramChatId,
                        telegramUserId: passengerPerson.telegramUserId,
                        source: 'viber_match',
                        viberListingId: driverListing.id,
                    },
                });
                await prisma.rideShareRequest.update({ where: { id: requestId }, data: { status: 'confirmed' } });
                const driverChatId = await (0, exports.getChatIdByPhone)(driverListing.phone);
                if (driverChatId) {
                    await bot?.sendMessage(driverChatId, `✅ <b>Пасажир підтвердив вашу пропозицію!</b>\n\n` +
                        `🎫 №${booking.id} · 🚗 Попутка\n` +
                        `🛣 ${getRouteName(driverListing.route)}\n` +
                        `📅 ${formatDate(driverListing.date)}\n` +
                        (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
                        `👤 Пасажир: ${booking.name}\n` +
                        `📞 ${formatPhoneTelLink(booking.phone)}\n\n` +
                        `Поїздка з'явиться у /mybookings.`, { parse_mode: 'HTML' }).catch(() => { });
                }
                await bot?.answerCallbackQuery(query.id, { text: 'Поїздку підтверджено! Водій отримав сповіщення.' });
                await bot?.sendMessage(chatId, '✅ Ви підтвердили поїздку. Водій отримав сповіщення.', { parse_mode: 'HTML' }).catch(() => { });
                if (adminChatId) {
                    await bot?.sendMessage(adminChatId, `🚗 <b>Попутка підтверджена (реверс)</b>\n\n` +
                        `Бронювання #${booking.id} (viber_match)\n` +
                        `Пасажир: ${booking.name}, ${formatPhoneTelLink(booking.phone)}\n` +
                        `Водій: ${driverListing.senderName ?? '—'}, ${formatPhoneTelLink(driverListing.phone)}\n` +
                        `${getRouteName(driverListing.route)} · ${formatDate(driverListing.date)}`, { parse_mode: 'HTML' }).catch(() => { });
                }
                return;
            }
            // Скасування бронювання - показати підтвердження
            if (data.startsWith('cancel_')) {
                const bookingId = data.replace('cancel_', '');
                // Отримати інформацію про бронювання
                const booking = await prisma.booking.findUnique({
                    where: { id: Number(bookingId) }
                });
                if (!booking) {
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Бронювання не знайдено' });
                    return;
                }
                const confirmKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ Так, скасувати', callback_data: `confirm_cancel_${bookingId}` },
                            { text: '❌ Ні, залишити', callback_data: 'cancel_abort' }
                        ]
                    ]
                };
                await bot?.editMessageText('⚠️ <b>Підтвердження скасування</b>\n\n' +
                    `🎫 <b>Бронювання #${booking.id}</b>\n` +
                    `📍 ${getRouteName(booking.route)}\n` +
                    `📅 ${formatDate(booking.date)} о ${booking.departureTime}\n` +
                    `🎫 Місць: ${booking.seats}\n` +
                    `👤 ${booking.name}\n\n` +
                    'Ви впевнені що хочете скасувати це бронювання?', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: confirmKeyboard
                });
                await bot?.answerCallbackQuery(query.id);
            }
            // Підтвердження скасування
            if (data.startsWith('confirm_cancel_')) {
                const bookingId = data.replace('confirm_cancel_', '');
                try {
                    const booking = await prisma.booking.findUnique({
                        where: { id: Number(bookingId) },
                        include: { viberListing: true }
                    });
                    if (!booking) {
                        throw new Error('Бронювання не знайдено');
                    }
                    if (booking.telegramUserId !== userId) {
                        throw new Error('Це не ваше бронювання');
                    }
                    const bookingData = {
                        id: booking.id,
                        route: booking.route,
                        date: booking.date
                    };
                    const isRideShare = booking.source === 'viber_match';
                    const driverListing = booking.viberListing;
                    await prisma.booking.delete({
                        where: { id: Number(bookingId) }
                    });
                    console.log(`✅ Користувач ${userId} скасував бронювання #${bookingId}`);
                    // Сповістити водія про скасування попутки
                    if (isRideShare && driverListing) {
                        const driverChatId = await (0, exports.getChatIdByPhone)(driverListing.phone);
                        if (driverChatId) {
                            await bot?.sendMessage(driverChatId, `🚫 <b>Пасажир скасував бронювання попутки</b>\n\n` +
                                `🎫 №${bookingData.id}\n` +
                                `👤 Пасажир: ${booking.name}\n` +
                                `📞 ${formatPhoneTelLink(booking.phone)}\n` +
                                `🛣 ${getRouteName(bookingData.route)}\n` +
                                `📅 ${formatDate(bookingData.date)}\n\n` +
                                `Місце знову вільне — можете запропонувати його іншим.`, { parse_mode: 'HTML' }).catch((err) => console.error('Notify driver about cancel:', err));
                        }
                    }
                    await bot?.editMessageText('✅ <b>Бронювання успішно скасовано!</b>\n\n' +
                        `🎫 Номер: #${bookingData.id}\n` +
                        `📍 ${getRouteName(bookingData.route)}\n` +
                        `📅 ${formatDate(bookingData.date)}\n\n` +
                        '💡 Ви можете:\n' +
                        '🎫 /book - Створити нове бронювання\n' +
                        '🌐 /allrides - Переглянути всі активні попутки\n' +
                        '📋 /mybookings - Переглянути інші бронювання', {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML'
                    });
                    await bot?.answerCallbackQuery(query.id, { text: '✅ Бронювання скасовано' });
                }
                catch (error) {
                    console.error('❌ Помилка скасування:', error);
                    await bot?.editMessageText('❌ <b>Помилка при скасуванні бронювання</b>\n\n' +
                        `Деталі: ${error.message || 'Невідома помилка'}\n\n` +
                        'Спробуйте команду /mybookings щоб переглянути актуальний список.', {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML'
                    });
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
                }
            }
            // Відміна скасування
            if (data === 'cancel_abort') {
                await bot?.editMessageText('✅ <b>Скасування відмінено</b>\n\n' +
                    'Ваше бронювання збережено.\n\n' +
                    '📋 /mybookings - Переглянути всі бронювання\n' +
                    '🌐 /allrides - Переглянути всі активні попутки', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML'
                });
                await bot?.answerCallbackQuery(query.id, { text: '✅ Залишено' });
            }
            // Вибір напрямку для нового бронювання
            if (data.startsWith('book_dir_')) {
                const direction = data.replace('book_dir_', '');
                // Створити кнопки з датами (наступні 7 днів)
                const dates = [];
                for (let i = 0; i < 7; i++) {
                    const date = new Date();
                    date.setDate(date.getDate() + i);
                    const dateStr = date.toISOString().split('T')[0];
                    const label = i === 0 ? ' (сьогодні)' : i === 1 ? ' (завтра)' : '';
                    dates.push({
                        text: formatDate(date) + label,
                        callback_data: `book_date_${direction}_${dateStr.replace(/-/g, '_')}`
                    });
                }
                const dateKeyboard = {
                    inline_keyboard: dates.map(d => [d]).concat([[
                            { text: '❌ Скасувати', callback_data: 'book_cancel' }
                        ]])
                };
                await bot?.editMessageText('🎫 <b>Нове бронювання</b>\n\n' +
                    `✅ Напрямок: ${getRouteName(direction)}\n\n` +
                    '2️⃣ Оберіть дату:', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: dateKeyboard
                });
                await bot?.answerCallbackQuery(query.id);
            }
            // Вибір дати - показати доступні часи
            if (data.startsWith('book_date_')) {
                const parts = data.replace('book_date_', '').split('_');
                // Дата завжди остання (YYYY-MM-DD = 3 частини)
                const selectedDate = parts.slice(-3).join('-');
                // Direction - все що до дати
                const direction = parts.slice(0, -3).join('-');
                // Отримати графіки для обраного напрямку
                const schedules = await prisma.schedule.findMany({
                    where: { route: { startsWith: direction } },
                    orderBy: { departureTime: 'asc' }
                });
                if (schedules.length === 0) {
                    // Запропонувати поїздки з Viber, якщо є
                    const startOfDay = new Date(selectedDate);
                    startOfDay.setHours(0, 0, 0, 0);
                    const endOfDay = new Date(selectedDate);
                    endOfDay.setHours(23, 59, 59, 999);
                    const viberListings = await prisma.viberListing.findMany({
                        where: {
                            route: direction,
                            date: { gte: startOfDay, lte: endOfDay },
                            isActive: true
                        },
                        orderBy: [{ departureTime: 'asc' }]
                    });
                    const driverListings = viberListings.filter((l) => l.listingType === 'driver');
                    const viberBlock = viberListings.length > 0
                        ? '\n\n📱 <b>Поїздки з Viber</b> (можна замовити по телефону або натиснути кнопку):\n' +
                            `🛣 ${getRouteName(direction)}\n\n` +
                            viberListings
                                .map((l) => {
                                const type = l.listingType === 'driver' ? '🚗 Водій' : '👤 Пасажир';
                                const time = l.departureTime || '—';
                                const seats = l.seats != null ? `, ${l.seats} місць` : '';
                                const notes = l.notes != null ? `\n💡 ${l.notes}` : '';
                                const namePart = l.senderName ? ` — ${l.senderName}` : '';
                                return `${type} ${time}${seats}${notes}\n📞 ${formatPhoneTelLink(l.phone)}${namePart}`;
                            })
                                .join('\n\n')
                        : '';
                    const helpBlock = viberListings.length === 0
                        ? '\n\n<b>Ви можете:</b>\n' +
                            '🎫 /book - Почати заново\n' +
                            '🌐 /allrides - Переглянути всі активні попутки\n' +
                            '📋 /mybookings - Переглянути існуючі бронювання\n' +
                            '🌐 https://malin.kiev.ua - Забронювати на сайті'
                        : '';
                    const bookViberButtons = driverListings.length > 0
                        ? { inline_keyboard: driverListings.map((d) => [{ text: `🎫 Забронювати у ${d.senderName ?? 'водія'}`, callback_data: `book_viber_${d.id}` }]) }
                        : undefined;
                    await bot?.editMessageText('❌ <b>Немає доступних рейсів</b> за розкладом.\n\n' +
                        'Спробуйте інший напрямок або дату.' +
                        viberBlock +
                        helpBlock, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML',
                        ...(bookViberButtons && { reply_markup: bookViberButtons })
                    });
                    await bot?.answerCallbackQuery(query.id);
                    return;
                }
                // Перевірити доступність для кожного часу
                const timeButtons = await Promise.all(schedules.map(async (schedule) => {
                    // Підрахувати зайняті місця
                    const startOfDay = new Date(selectedDate);
                    startOfDay.setHours(0, 0, 0, 0);
                    const endOfDay = new Date(selectedDate);
                    endOfDay.setHours(23, 59, 59, 999);
                    const existingBookings = await prisma.booking.findMany({
                        where: {
                            route: schedule.route,
                            departureTime: schedule.departureTime,
                            date: {
                                gte: startOfDay,
                                lte: endOfDay
                            }
                        }
                    });
                    const bookedSeats = existingBookings.reduce((sum, b) => sum + b.seats, 0);
                    const availableSeats = schedule.maxSeats - bookedSeats;
                    const isAvailable = availableSeats > 0;
                    const emoji = isAvailable ? '✅' : '❌';
                    const routeLabel = schedule.route.includes('Irpin') ? ' (Ірпінь)' :
                        schedule.route.includes('Bucha') ? ' (Буча)' : '';
                    return {
                        text: `${emoji} ${schedule.departureTime}${routeLabel} (${availableSeats}/${schedule.maxSeats})`,
                        callback_data: isAvailable ?
                            `book_time_${schedule.route}_${schedule.departureTime}_${selectedDate.replace(/-/g, '_')}` :
                            'book_unavailable'
                    };
                }));
                const timeKeyboard = {
                    inline_keyboard: timeButtons.map(b => [b]).concat([[
                            { text: '⬅️ Назад', callback_data: `book_dir_${direction}` },
                            { text: '❌ Скасувати', callback_data: 'book_cancel' }
                        ]])
                };
                await bot?.editMessageText('🎫 <b>Нове бронювання</b>\n\n' +
                    `✅ Напрямок: ${getRouteName(direction)}\n` +
                    `✅ Дата: ${formatDate(new Date(selectedDate))}\n\n` +
                    '3️⃣ Оберіть час відправлення:', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: timeKeyboard
                });
                await bot?.answerCallbackQuery(query.id);
            }
            // Вибір часу - запитати кількість місць
            if (data.startsWith('book_time_') && data !== 'book_unavailable') {
                const parts = data.replace('book_time_', '').split('_');
                // Формат: route_time_YYYY_MM_DD (дата - останні 3 частини)
                const selectedDate = parts.slice(-3).join('-');
                const time = parts[parts.length - 4]; // час перед датою
                // Route - все що до часу
                const route = parts.slice(0, -4).join('-');
                const dateForCallback = selectedDate.replace(/-/g, '_');
                const seatsKeyboard = {
                    inline_keyboard: [
                        [{ text: '1 місце', callback_data: `book_seats_${route}_${time}_${dateForCallback}_1` }],
                        [{ text: '2 місця', callback_data: `book_seats_${route}_${time}_${dateForCallback}_2` }],
                        [{ text: '3 місця', callback_data: `book_seats_${route}_${time}_${dateForCallback}_3` }],
                        [{ text: '4 місця', callback_data: `book_seats_${route}_${time}_${dateForCallback}_4` }],
                        [
                            { text: '⬅️ Назад', callback_data: `book_date_${route}_${dateForCallback}` },
                            { text: '❌ Скасувати', callback_data: 'book_cancel' }
                        ]
                    ]
                };
                await bot?.editMessageText('🎫 <b>Нове бронювання</b>\n\n' +
                    `✅ Напрямок: ${getRouteName(route)}\n` +
                    `✅ Дата: ${formatDate(new Date(selectedDate))}\n` +
                    `✅ Час: ${time}\n\n` +
                    '4️⃣ Скільки місць забронювати?', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: seatsKeyboard
                });
                await bot?.answerCallbackQuery(query.id);
            }
            // Вибір кількості місць - показати підтвердження
            if (data.startsWith('book_seats_')) {
                const parts = data.replace('book_seats_', '').split('_');
                // Формат: route_time_YYYY_MM_DD_seats (останній - seats, перед ним дата)
                const seats = parts[parts.length - 1];
                const selectedDate = parts.slice(-4, -1).join('-');
                const time = parts[parts.length - 5];
                const route = parts.slice(0, -5).join('-');
                const dateForCallback = selectedDate.replace(/-/g, '_');
                const confirmKeyboard = {
                    inline_keyboard: [
                        [{ text: '✅ Підтвердити бронювання', callback_data: `book_confirm_${route}_${time}_${dateForCallback}_${seats}` }],
                        [{ text: '❌ Скасувати', callback_data: 'book_cancel' }]
                    ]
                };
                await bot?.editMessageText('🎫 <b>Підтвердження бронювання</b>\n\n' +
                    `📍 <b>Маршрут:</b> ${getRouteName(route)}\n` +
                    `📅 <b>Дата:</b> ${formatDate(new Date(selectedDate))}\n` +
                    `🕐 <b>Час:</b> ${time}\n` +
                    `🎫 <b>Місць:</b> ${seats}\n\n` +
                    '⚠️ Підтверджуєте бронювання?', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: confirmKeyboard
                });
                await bot?.answerCallbackQuery(query.id);
            }
            // Підтвердження створення бронювання
            if (data.startsWith('book_confirm_')) {
                const parts = data.replace('book_confirm_', '').split('_');
                // Формат: route_time_YYYY_MM_DD_seats
                const seats = Number(parts[parts.length - 1]);
                const selectedDate = parts.slice(-4, -1).join('-');
                const time = parts[parts.length - 5];
                const route = parts.slice(0, -5).join('-');
                try {
                    // Дані користувача: з останнього бронювання або з Person (якщо реєструвався тільки через бота)
                    const userBooking = await prisma.booking.findFirst({
                        where: { telegramUserId: userId }
                    });
                    const person = await (0, exports.getPersonByTelegram)(userId, chatId);
                    const userName = userBooking?.name ?? person?.fullName?.trim() ?? 'Клієнт';
                    const userPhone = userBooking?.phone ?? person?.phoneNormalized;
                    const userPersonId = userBooking?.personId ?? person?.id;
                    if (!userPhone) {
                        throw new Error('Користувач не знайдений. Напишіть /start і надішліть номер телефону.');
                    }
                    // Перевірити доступність місць
                    const startOfDay = new Date(selectedDate);
                    startOfDay.setHours(0, 0, 0, 0);
                    const endOfDay = new Date(selectedDate);
                    endOfDay.setHours(23, 59, 59, 999);
                    const schedule = await prisma.schedule.findFirst({
                        where: {
                            route,
                            departureTime: time
                        }
                    });
                    if (!schedule) {
                        throw new Error('Графік не знайдено');
                    }
                    const existingBookings = await prisma.booking.findMany({
                        where: {
                            route,
                            departureTime: time,
                            date: {
                                gte: startOfDay,
                                lte: endOfDay
                            }
                        }
                    });
                    const bookedSeats = existingBookings.reduce((sum, b) => sum + b.seats, 0);
                    const availableSeats = schedule.maxSeats - bookedSeats;
                    if (availableSeats < seats) {
                        throw new Error(`Недостатньо місць. Доступно: ${availableSeats}, запитано: ${seats}`);
                    }
                    // Створити бронювання (прив'язка до Person якщо є)
                    const booking = await prisma.booking.create({
                        data: {
                            route,
                            date: new Date(selectedDate),
                            departureTime: time,
                            seats,
                            name: userName,
                            phone: userPhone,
                            telegramChatId: chatId,
                            telegramUserId: userId,
                            personId: userPersonId ?? undefined,
                        },
                    });
                    console.log(`✅ Створено бронювання #${booking.id} користувачем ${userId} через бот`);
                    const supportPhoneLine = schedule.supportPhone
                        ? `\n⚠️ Краще уточнити бронювання за телефоном: ${schedule.supportPhone}\n\n`
                        : '\n\n';
                    await bot?.editMessageText('📋 <b>Заявку прийнято</b> (працюємо в технічному режимі)\n\n' +
                        `🎫 <b>Номер:</b> #${booking.id}\n` +
                        `📍 <b>Маршрут:</b> ${getRouteName(booking.route)}\n` +
                        `📅 <b>Дата:</b> ${formatDate(booking.date)}\n` +
                        `🕐 <b>Час:</b> ${booking.departureTime}\n` +
                        `🎫 <b>Місць:</b> ${booking.seats}\n` +
                        `👤 <b>Пасажир:</b> ${booking.name}` +
                        supportPhoneLine +
                        '💡 Корисні команди:\n' +
                        '📋 /mybookings - Переглянути всі бронювання\n' +
                        '🌐 /allrides - Переглянути всі активні попутки\n' +
                        '🚫 /cancel - Скасувати бронювання\n' +
                        '🎫 /book - Створити ще одне бронювання', {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML'
                    });
                    await bot?.answerCallbackQuery(query.id, {
                        text: schedule.supportPhone
                            ? 'Заявку прийнято. Краще уточнити за тел. ' + schedule.supportPhone
                            : '✅ Заявку прийнято!'
                    });
                    // Відправити сповіщення адміну (використовується TELEGRAM_ADMIN_CHAT_ID)
                    await (0, exports.sendBookingNotificationToAdmin)(booking).catch((err) => console.error('Telegram notify admin:', err));
                }
                catch (error) {
                    console.error('❌ Помилка створення бронювання:', error);
                    await bot?.editMessageText('❌ <b>Помилка при створенні бронювання</b>\n\n' +
                        `Деталі: ${error.message || 'Невідома помилка'}\n\n` +
                        'Спробуйте:\n' +
                        '🎫 /book - Почати заново\n' +
                        '🌐 https://malin.kiev.ua - Забронювати на сайті', {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML'
                    });
                    await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
                }
            }
            // Скасування процесу бронювання
            if (data === 'book_cancel') {
                await bot?.editMessageText('❌ <b>Бронювання скасовано</b>\n\n' +
                    'Ви можете:\n' +
                    '🎫 /book - Почати заново\n' +
                    '🌐 /allrides - Переглянути всі активні попутки\n' +
                    '📋 /mybookings - Переглянути існуючі бронювання\n' +
                    '🌐 https://malin.kiev.ua - Забронювати на сайті', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML'
                });
                await bot?.answerCallbackQuery(query.id, { text: '❌ Скасовано' });
            }
            // Недоступний час
            if (data === 'book_unavailable') {
                await bot?.answerCallbackQuery(query.id, {
                    text: '❌ На цей час немає вільних місць',
                    show_alert: true
                });
            }
        }
        catch (error) {
            console.error('❌ Помилка обробки callback:', error);
            await bot?.answerCallbackQuery(query.id, { text: '❌ Помилка' });
        }
    });
    console.log('✅ Bot commands налаштовано');
}
// Ініціалізація бота (якщо токен є)
if (token) {
    bot = new node_telegram_bot_api_1.default(token, { polling: true });
    console.log('✅ Telegram Bot ініціалізовано з polling');
    // Обробка команд
    setupBotCommands();
}
else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN не знайдено - Telegram notifications вимкнено');
}
/**
 * Отримання chat_id по номеру телефону: спочатку Person, інакше Booking.
 */
const getChatIdByPhone = async (phone) => {
    try {
        const person = await (0, exports.getPersonByPhone)(phone);
        if (person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '') {
            return person.telegramChatId;
        }
        const bookings = await prisma.booking.findMany({
            where: {
                telegramChatId: { not: null },
                telegramUserId: { not: null },
            },
            orderBy: { createdAt: 'desc' },
        });
        const normalizedPhone = (0, exports.normalizePhone)(phone);
        const matching = bookings.find((b) => (0, exports.normalizePhone)(b.phone) === normalizedPhone);
        return matching?.telegramChatId ?? null;
    }
    catch (error) {
        console.error('❌ Помилка отримання chat_id:', error);
        return null;
    }
};
exports.getChatIdByPhone = getChatIdByPhone;
/**
 * Chat_id водія для кнопки «Забронювати» в /allrides: по телефону, а якщо не знайдено — по personId оголошення.
 */
async function getChatIdForDriverListing(listing) {
    const byPhone = await (0, exports.getChatIdByPhone)(listing.phone);
    if (byPhone)
        return byPhone;
    if (listing.personId) {
        const person = await prisma.person.findUnique({
            where: { id: listing.personId },
            select: { telegramChatId: true },
        });
        if (person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '') {
            return person.telegramChatId;
        }
    }
    return null;
}
/**
 * Виконати запит на попутку до водія (Viber-оголошення). Викликається з callback book_viber_ та з /start?start=book_viber_ID.
 */
async function executeBookViberRideShare(chatId, userId, driverListingId, passengerDisplayName) {
    const driverListing = await prisma.viberListing.findUnique({ where: { id: driverListingId } });
    if (!driverListing || driverListing.listingType !== 'driver' || !driverListing.isActive) {
        return { ok: false, error: '❌ Оголошення водія не знайдено' };
    }
    const person = await (0, exports.getPersonByTelegram)(userId, chatId);
    if (!person?.phoneNormalized) {
        return { ok: false, error: 'Спочатку надішліть номер телефону: /start' };
    }
    const { listing: passengerListing } = await createOrMergeViberListing({
        rawMessage: `[Бот] ${driverListing.route} ${driverListing.date.toISOString().slice(0, 10)} ${driverListing.departureTime ?? ''}`,
        senderName: person.fullName?.trim() ?? passengerDisplayName ?? 'Пасажир',
        listingType: 'passenger',
        route: driverListing.route,
        date: driverListing.date,
        departureTime: driverListing.departureTime,
        seats: null,
        phone: person.phoneNormalized,
        notes: null,
        isActive: true,
        personId: person.id,
    });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const request = await prisma.rideShareRequest.create({
        data: { passengerListingId: passengerListing.id, driverListingId: driverListing.id, status: 'pending', expiresAt },
    });
    const driverChatId = await getChatIdForDriverListing(driverListing);
    const passengerName = passengerListing.senderName ?? 'Пасажир';
    if (driverChatId) {
        const confirmKeyboard = {
            inline_keyboard: [[{ text: '✅ Підтвердити бронювання (1 год)', callback_data: `vibermatch_confirm_${request.id}` }]],
        };
        await bot?.sendMessage(driverChatId, `🎫 <b>Запит на попутку</b>\n\n` +
            `👤 ${passengerName} хоче поїхати з вами.\n\n` +
            `🛣 ${getRouteName(driverListing.route)}\n` +
            `📅 ${formatDate(driverListing.date)}\n` +
            (driverListing.departureTime ? `🕐 ${driverListing.departureTime}\n` : '') +
            `📞 ${formatPhoneTelLink(passengerListing.phone)}` +
            `\n\n_У вас є 1 година на підтвердження._`, { parse_mode: 'HTML', reply_markup: confirmKeyboard }).catch(() => { });
    }
    return { ok: true };
}
exports.default = bot;
