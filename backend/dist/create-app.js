"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportPhoneForRoute = exports.CODE_VERSION = void 0;
exports.createApp = createApp;
exports.getRegisteredRoutes = getRegisteredRoutes;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const telegram_1 = require("./telegram");
const viber_parser_1 = require("./viber-parser");
const phonecheck_1 = require("./phonecheck");
const index_helpers_1 = require("./index-helpers");
const poputky_1 = require("./routes/poputky");
const require_admin_1 = require("./middleware/require-admin");
const public_routes_1 = require("./routes/public-routes");
const admin_session_1 = require("./routes/admin-session");
const admin_maintenance_1 = require("./routes/admin-maintenance");
const schedules_bookings_1 = require("./routes/schedules-bookings");
// Маркер версії коду — змінити при оновленні, щоб у логах Railway було видно новий деплой
exports.CODE_VERSION = 'viber-v2-2026';
// Лог при завантаженні модуля — якщо це є в Deploy Logs, деплой новий
console.log('[KYIV-MALYN-BACKEND] BOOT codeVersion=' + exports.CODE_VERSION + ' build=' + (typeof __dirname !== 'undefined' ? 'node' : 'unknown'));
// Сесія для одноразового промо: якщо TELEGRAM_USER_SESSION_PATH не задано — шукаємо файл у репо (telegram-user/session_telegram_user.session)
if (!process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim()) {
    const defaultSessionPath = path_1.default.join(process.cwd(), 'telegram-user', 'session_telegram_user');
    const defaultSessionFile = defaultSessionPath + '.session';
    if (fs_1.default.existsSync(defaultSessionFile)) {
        process.env.TELEGRAM_USER_SESSION_PATH = defaultSessionPath;
        console.log('[KYIV-MALYN-BACKEND] Telegram user session loaded from repo file telegram-user/session_telegram_user.session');
    }
}
function createApp(deps) {
    const prisma = deps.prisma;
    const app = (0, express_1.default)();
    // CORS: дозволяємо фронт (malin.kiev.ua + Railway preview)
    const allowedOrigins = [
        'https://malin.kiev.ua',
        'https://www.malin.kiev.ua',
        'http://localhost:5173',
        'http://localhost:3000',
    ];
    const corsOptions = {
        origin: (origin, cb) => {
            if (!origin || allowedOrigins.some((o) => origin === o || origin.endsWith('.railway.app'))) {
                cb(null, true);
            }
            else {
                cb(null, true); // для зручності залишаємо приймати всі; за потреби звужте
            }
        },
        credentials: true,
    };
    app.use((0, cors_1.default)(corsOptions));
    app.use(express_1.default.json());
    app.use('/poputky', (0, poputky_1.createPoputkyRouter)());
    const ADMIN_PASSWORD = deps.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'admin123';
    app.use((0, public_routes_1.createPublicRoutesRouter)({ codeVersion: exports.CODE_VERSION }));
    app.use((0, admin_session_1.createAdminSessionRouter)({ adminPassword: ADMIN_PASSWORD }));
    app.use((0, admin_maintenance_1.createAdminMaintenanceRouter)({ prisma }));
    app.use((0, schedules_bookings_1.createSchedulesBookingsRouter)({ prisma }));
    // ——— Профіль користувача (Telegram) ———
    const startOfToday = () => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    };
    /** GET /user/profile?telegramUserId= — профіль: person, поточні бронювання, оголошення як пасажир/водій */
    app.get('/user/profile', async (req, res) => {
        const telegramUserId = req.query.telegramUserId?.trim();
        if (!telegramUserId) {
            return res.status(400).json({ error: 'telegramUserId is required' });
        }
        try {
            const person = await (0, telegram_1.getPersonByTelegram)(telegramUserId, '');
            const since = startOfToday();
            const [bookings, passengerListings, driverListings] = await Promise.all([
                prisma.booking.findMany({
                    where: { telegramUserId, date: { gte: since } },
                    orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                }),
                person
                    ? prisma.viberListing.findMany({
                        where: { personId: person.id, listingType: 'passenger', isActive: true, date: { gte: since } },
                        orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                    })
                    : [],
                person
                    ? prisma.viberListing.findMany({
                        where: { personId: person.id, listingType: 'driver', isActive: true, date: { gte: since } },
                        orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                    })
                    : [],
            ]);
            const profile = {
                person: person
                    ? {
                        id: person.id,
                        fullName: person.fullName,
                        phoneNormalized: person.phoneNormalized,
                        telegramUserId: person.telegramUserId,
                    }
                    : null,
                bookings: bookings.map((b) => ({
                    id: b.id,
                    route: b.route,
                    date: b.date instanceof Date ? b.date.toISOString() : b.date,
                    departureTime: b.departureTime,
                    seats: b.seats,
                    name: b.name,
                    phone: b.phone,
                    source: b.source,
                    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
                })),
                passengerListings: passengerListings.map((l) => (0, index_helpers_1.serializeViberListing)(l)),
                driverListings: driverListings.map((l) => (0, index_helpers_1.serializeViberListing)(l)),
            };
            res.json(profile);
        }
        catch (error) {
            console.error('❌ GET /user/profile:', error);
            res.status(500).json({ error: 'Failed to load profile' });
        }
    });
    /** PUT /user/profile/name — оновити ім'я (fullName) по telegramUserId та синхронізувати в бронюваннях і оголошеннях */
    app.put('/user/profile/name', async (req, res) => {
        const { telegramUserId, fullName } = req.body;
        if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
            return res.status(400).json({ error: 'telegramUserId is required' });
        }
        try {
            const person = await (0, telegram_1.getPersonByTelegram)(telegramUserId.trim(), '');
            if (!person) {
                return res.status(404).json({ error: 'Профіль не знайдено. Підключіть номер телефону в боті.' });
            }
            const newName = fullName != null && String(fullName).trim() !== '' ? String(fullName).trim() : null;
            const displayName = newName ?? '';
            await prisma.$transaction([
                prisma.person.update({
                    where: { id: person.id },
                    data: { fullName: newName },
                }),
                prisma.booking.updateMany({
                    where: { personId: person.id },
                    data: { name: displayName },
                }),
                prisma.viberListing.updateMany({
                    where: { personId: person.id },
                    data: { senderName: newName },
                }),
            ]);
            res.json({ success: true, fullName: newName });
        }
        catch (error) {
            if (error.code === 'P2025')
                return res.status(404).json({ error: 'Profile not found' });
            console.error('❌ PUT /user/profile/name:', error);
            res.status(500).json({ error: 'Failed to update name' });
        }
    });
    /** Перевірка, що оголошення належить користувачу за telegramUserId */
    async function getViberListingForUser(listingId, telegramUserId) {
        const person = await (0, telegram_1.getPersonByTelegram)(telegramUserId, '');
        if (!person)
            return null;
        const listing = await prisma.viberListing.findFirst({
            where: { id: listingId, personId: person.id },
        });
        return listing;
    }
    /** PATCH /viber-listings/:id/by-user — редагування оголошення власником (поля: route, date, departureTime, seats, notes, priceUah) */
    app.patch('/viber-listings/:id/by-user', async (req, res) => {
        const id = Number(req.params.id);
        const { telegramUserId, ...body } = req.body;
        if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
            return res.status(400).json({ error: 'telegramUserId is required' });
        }
        try {
            const listing = await getViberListingForUser(id, telegramUserId.trim());
            if (!listing) {
                return res.status(404).json({ error: 'Оголошення не знайдено або це не ваше оголошення' });
            }
            const allowed = ['route', 'date', 'departureTime', 'seats', 'notes', 'priceUah'];
            const updates = {};
            for (const key of allowed) {
                if (body[key] !== undefined) {
                    if (key === 'date')
                        updates[key] = new Date(body[key]);
                    else if (key === 'seats' || key === 'priceUah') {
                        const v = body[key];
                        updates[key] = v === null || v === '' ? null : (typeof v === 'number' ? v : parseInt(String(v), 10));
                    }
                    else
                        updates[key] = body[key];
                }
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No allowed fields to update' });
            }
            const updated = await prisma.viberListing.update({
                where: { id },
                data: updates,
            });
            // Після редагування власником — повторно проганяємо matching-нотифікації
            // за тими самими правилами, що й при створенні.
            const matchingRecheckTriggered = (0, telegram_1.isTelegramEnabled)();
            if (matchingRecheckTriggered) {
                const authorChatId = updated.phone?.trim() ? await (0, telegram_1.getChatIdByPhone)(updated.phone) : null;
                if (updated.listingType === 'driver') {
                    (0, telegram_1.notifyMatchingPassengersForNewDriver)(updated, authorChatId).catch((err) => console.error('Telegram match notify after user update (driver):', err));
                }
                else if (updated.listingType === 'passenger') {
                    (0, telegram_1.notifyMatchingDriversForNewPassenger)(updated, authorChatId).catch((err) => console.error('Telegram match notify after user update (passenger):', err));
                }
            }
            res.json({ ...(0, index_helpers_1.serializeViberListing)(updated), matchingRecheckTriggered });
        }
        catch (error) {
            if (error.code === 'P2025')
                return res.status(404).json({ error: 'Listing not found' });
            console.error('❌ PATCH /viber-listings/:id/by-user:', error);
            res.status(500).json({ error: 'Failed to update listing' });
        }
    });
    /** PATCH /viber-listings/:id/deactivate/by-user — скасувати оголошення (isActive: false) власником */
    app.patch('/viber-listings/:id/deactivate/by-user', async (req, res) => {
        const id = Number(req.params.id);
        const { telegramUserId } = req.body;
        if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
            return res.status(400).json({ error: 'telegramUserId is required' });
        }
        try {
            const listing = await getViberListingForUser(id, telegramUserId.trim());
            if (!listing) {
                return res.status(404).json({ error: 'Оголошення не знайдено або це не ваше оголошення' });
            }
            const updated = await prisma.viberListing.update({
                where: { id },
                data: { isActive: false },
            });
            res.json((0, index_helpers_1.serializeViberListing)(updated));
        }
        catch (error) {
            if (error.code === 'P2025')
                return res.status(404).json({ error: 'Listing not found' });
            console.error('❌ PATCH /viber-listings/:id/deactivate/by-user:', error);
            res.status(500).json({ error: 'Failed to deactivate listing' });
        }
    });
    // Відправка нагадувань про поїздки на завтра (admin endpoint)
    app.post('/telegram/send-reminders', require_admin_1.requireAdmin, async (_req, res) => {
        if (!(0, telegram_1.isTelegramEnabled)()) {
            return res.status(400).json({ error: 'Telegram bot не налаштовано' });
        }
        try {
            // Знаходимо всі бронювання на завтра
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const startOfDay = new Date(tomorrow);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(tomorrow);
            endOfDay.setHours(23, 59, 59, 999);
            const bookings = await prisma.booking.findMany({
                where: {
                    date: {
                        gte: startOfDay,
                        lte: endOfDay
                    },
                    telegramChatId: { not: null }
                },
                include: { viberListing: true }
            });
            let sent = 0;
            let failed = 0;
            for (const booking of bookings) {
                if (booking.telegramChatId) {
                    try {
                        const driver = booking.viberListing
                            ? { senderName: booking.viberListing.senderName, phone: booking.viberListing.phone }
                            : undefined;
                        await (0, telegram_1.sendTripReminder)(booking.telegramChatId, {
                            route: booking.route,
                            date: booking.date,
                            departureTime: booking.departureTime,
                            name: booking.name,
                            driver
                        });
                        sent++;
                    }
                    catch (error) {
                        console.error(`❌ Не вдалося надіслати нагадування для booking #${booking.id}:`, error);
                        failed++;
                    }
                }
            }
            res.json({
                success: true,
                message: `Нагадування відправлено: ${sent}, помилок: ${failed}`,
                total: bookings.length,
                sent,
                failed
            });
        }
        catch (error) {
            console.error('❌ Помилка відправки нагадувань:', error);
            res.status(500).json({ error: 'Failed to send reminders' });
        }
    });
    // Автоматичне завантаження нових повідомлень з групи PoDoroguem — для cron кожні 2 год
    app.post('/telegram/fetch-group-messages', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const result = await (0, telegram_1.fetchAndImportTelegramGroupMessages)();
            if (!result.success) {
                return res.status(500).json({
                    success: false,
                    error: result.error,
                    created: 0,
                    total: 0,
                });
            }
            res.json({
                success: true,
                message: result.created > 0 ? `Імпортовано ${result.created} нових з ${result.total} повідомлень` : 'Немає нових повідомлень',
                created: result.created,
                total: result.total,
            });
        }
        catch (error) {
            console.error('❌ /telegram/fetch-group-messages:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch and import', created: 0, total: 0 });
        }
    });
    // Нагадування в день поїздки (сьогодні) — для cron щодня вранці
    app.post('/telegram/send-reminders-today', require_admin_1.requireAdmin, async (_req, res) => {
        if (!(0, telegram_1.isTelegramEnabled)()) {
            return res.status(400).json({ error: 'Telegram bot не налаштовано' });
        }
        try {
            const today = new Date();
            const startOfDay = new Date(today);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(today);
            endOfDay.setHours(23, 59, 59, 999);
            const bookings = await prisma.booking.findMany({
                where: {
                    date: {
                        gte: startOfDay,
                        lte: endOfDay
                    },
                    telegramChatId: { not: null }
                },
                include: { viberListing: true }
            });
            let sent = 0;
            let failed = 0;
            for (const booking of bookings) {
                if (booking.telegramChatId) {
                    try {
                        const driver = booking.viberListing
                            ? { senderName: booking.viberListing.senderName, phone: booking.viberListing.phone }
                            : undefined;
                        await (0, telegram_1.sendTripReminderToday)(booking.telegramChatId, {
                            route: booking.route,
                            date: booking.date,
                            departureTime: booking.departureTime,
                            name: booking.name,
                            driver
                        });
                        sent++;
                    }
                    catch (error) {
                        console.error(`❌ Не вдалося надіслати нагадування (сьогодні) для booking #${booking.id}:`, error);
                        failed++;
                    }
                }
            }
            res.json({
                success: true,
                message: `Нагадування (сьогодні) відправлено: ${sent}, помилок: ${failed}`,
                total: bookings.length,
                sent,
                failed
            });
        }
        catch (error) {
            console.error('❌ Помилка відправки нагадувань (сьогодні):', error);
            res.status(500).json({ error: 'Failed to send reminders (today)' });
        }
    });
    // Тестовий endpoint для перевірки Telegram підключення
    app.get('/telegram/status', require_admin_1.requireAdmin, (_req, res) => {
        res.json({
            enabled: (0, telegram_1.isTelegramEnabled)(),
            adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ? 'configured' : 'not configured',
            botToken: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'
        });
    });
    // Публічний опис Telegram-сценаріїв для фронтенду/лендінгу
    app.get('/telegram/scenarios', (_req, res) => {
        const links = (0, telegram_1.getTelegramScenarioLinks)();
        res.json({
            enabled: (0, telegram_1.isTelegramEnabled)(),
            scenarios: {
                driver: {
                    title: 'Запит на поїздку як водій',
                    command: '/adddriverride',
                    deepLink: links.driver,
                },
                passenger: {
                    title: 'Запит на поїздку як пасажир',
                    command: '/addpassengerride',
                    deepLink: links.passenger,
                },
                view: {
                    title: 'Вільний перегляд поїздок',
                    command: '/poputky',
                    deepLink: links.view,
                    webLink: links.poputkyWeb,
                },
            },
        });
    });
    // Створити запит на попутку з сайту (потрібен Telegram login у вебі)
    app.post('/rideshare/request', async (req, res) => {
        const { driverListingId, telegramUserId } = req.body;
        if (!driverListingId || !telegramUserId) {
            return res.status(400).json({ error: 'driverListingId and telegramUserId are required' });
        }
        try {
            const driverListing = await prisma.viberListing.findUnique({ where: { id: Number(driverListingId) } });
            if (!driverListing || driverListing.listingType !== 'driver' || !driverListing.isActive) {
                return res.status(404).json({ error: 'Оголошення водія не знайдено або неактивне' });
            }
            const person = await (0, telegram_1.getPersonByTelegram)(String(telegramUserId), '');
            if (!person?.phoneNormalized) {
                return res.status(400).json({
                    error: 'Щоб бронювати попутки, підключіть номер телефону в Telegram боті через /start',
                });
            }
            const driverDate = new Date(driverListing.date);
            const startOfDay = new Date(driverDate.getFullYear(), driverDate.getMonth(), driverDate.getDate());
            const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
            const driverTime = driverListing.departureTime ?? null;
            const existingPassenger = await prisma.viberListing.findFirst({
                where: {
                    listingType: 'passenger',
                    isActive: true,
                    phone: person.phoneNormalized,
                    route: driverListing.route,
                    date: { gte: startOfDay, lt: endOfDay },
                    departureTime: driverTime,
                },
                orderBy: { createdAt: 'desc' },
            });
            if (existingPassenger) {
                const existingRequest = await prisma.rideShareRequest.findFirst({
                    where: {
                        passengerListingId: existingPassenger.id,
                        driverListingId: driverListing.id,
                        status: { in: ['pending', 'confirmed'] },
                    },
                });
                if (existingRequest) {
                    return res.status(400).json({
                        error: 'Ви вже надсилали запит цьому водію на цей маршрут і дату. Очікуйте підтвердження або перегляньте /mybookings.',
                    });
                }
            }
            const passengerListing = existingPassenger ?? await prisma.viberListing.create({
                data: {
                    rawMessage: `[Сайт /poputky] ${driverListing.route} ${driverListing.date.toISOString().slice(0, 10)} ${driverListing.departureTime ?? ''}`,
                    source: 'Viber1',
                    senderName: person.fullName?.trim() || 'Пасажир',
                    listingType: 'passenger',
                    route: driverListing.route,
                    date: driverListing.date,
                    departureTime: driverListing.departureTime,
                    seats: null,
                    phone: person.phoneNormalized,
                    notes: 'Запит створено з сайту /poputky',
                    isActive: true,
                    personId: person.id,
                },
            });
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
            const requestRecord = await prisma.rideShareRequest.create({
                data: {
                    passengerListingId: passengerListing.id,
                    driverListingId: driverListing.id,
                    status: 'pending',
                    expiresAt,
                },
            });
            const driverNotified = await (0, telegram_1.sendRideShareRequestToDriver)(requestRecord.id, {
                route: driverListing.route,
                date: driverListing.date,
                departureTime: driverListing.departureTime,
                phone: driverListing.phone,
                senderName: driverListing.senderName,
            }, {
                phone: passengerListing.phone,
                senderName: passengerListing.senderName,
                notes: passengerListing.notes,
            }).catch((err) => {
                console.error('Telegram ride-share notify driver error:', err);
                return false;
            });
            res.status(201).json({
                success: true,
                requestId: requestRecord.id,
                message: driverNotified
                    ? 'Запит надіслано водію. Очікуйте підтвердження до 1 години.'
                    : 'Запит створено, але водій ще не підключений до Telegram. Спробуйте зв’язатися телефоном.',
                driverNotified,
            });
        }
        catch (error) {
            console.error('❌ Помилка створення ride-share запиту з сайту:', error);
            res.status(500).json({ error: 'Не вдалося створити запит на попутку' });
        }
    });
    async function createOrMergeViberListing(data) {
        const personId = data.personId ?? null;
        const date = data.date;
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
        const normalizedPhone = data.phone?.trim() ? (0, telegram_1.normalizePhone)(data.phone) : '';
        // Шукаємо існуючий запис за route+date+time+phone (незалежно від source — Viber1 чи telegram1)
        const candidates = await prisma.viberListing.findMany({
            where: {
                listingType: data.listingType,
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
        let existing = null;
        if (normalizedPhone) {
            existing = candidates.find((c) => (0, telegram_1.normalizePhone)(c.phone) === normalizedPhone) ?? null;
        }
        if (!existing && personId) {
            existing = candidates.find((c) => c.personId === personId) ?? null;
        }
        if (!existing) {
            const listing = await prisma.viberListing.create({
                data: { ...data, source: data.source ?? 'Viber1' },
            });
            return { listing, isNew: true };
        }
        // Оновлюємо існуючий — source залишаємо перший (як потрапило в базу)
        const mergedNotes = (0, index_helpers_1.mergeTextField)(existing.notes, data.notes);
        const mergedSenderName = (0, index_helpers_1.mergeSenderName)(existing.senderName, data.senderName ?? null);
        const updated = await prisma.viberListing.update({
            where: { id: existing.id },
            data: {
                rawMessage: (0, index_helpers_1.mergeRawMessage)(existing.rawMessage, data.rawMessage),
                senderName: mergedSenderName ?? undefined,
                seats: data.seats != null ? data.seats : existing.seats,
                phone: existing.phone || data.phone,
                notes: mergedNotes,
                priceUah: data.priceUah != null ? data.priceUah : existing.priceUah,
                isActive: existing.isActive || data.isActive,
                personId: existing.personId ?? personId,
                // source не оновлюємо — залишаємо перший
            },
        });
        console.log(`♻️ Listing merged with existing #${existing.id} (route+date+time+phone match, source=${existing.source})`);
        return { listing: updated, isNew: false };
    }
    // Отримати всі активні Viber оголошення
    app.get('/viber-listings', async (req, res) => {
        try {
            const { active } = req.query;
            const where = active === 'true' ? { isActive: true } : {};
            const listings = await prisma.viberListing.findMany({
                where,
                orderBy: [
                    { date: 'asc' },
                    { createdAt: 'desc' }
                ]
            });
            res.json(listings.map(index_helpers_1.serializeViberListing));
        }
        catch (error) {
            console.error('❌ Помилка отримання Viber оголошень:', error);
            res.status(500).json({ error: 'Не вдалося завантажити Viber оголошення. Перевірте логи сервера.' });
        }
    });
    // Отримати Viber оголошення по маршруту та даті
    app.get('/viber-listings/search', async (req, res) => {
        const { route, date } = req.query;
        if (!route || !date) {
            return res.status(400).json({ error: 'Route and date are required' });
        }
        try {
            const searchDate = new Date(date);
            const startOfDay = new Date(searchDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(searchDate);
            endOfDay.setHours(23, 59, 59, 999);
            const listings = await prisma.viberListing.findMany({
                where: {
                    route: route,
                    date: {
                        gte: startOfDay,
                        lte: endOfDay
                    },
                    isActive: true
                },
                orderBy: [{ date: 'asc' }, { departureTime: 'asc' }]
            });
            res.json(listings.map(index_helpers_1.serializeViberListing));
        }
        catch (error) {
            console.error('❌ Помилка пошуку Viber оголошень:', error);
            res.status(500).json({ error: 'Не вдалося пошукати Viber оголошення.' });
        }
    });
    // Створити Viber оголошення (Admin)
    app.post('/viber-listings', require_admin_1.requireAdmin, async (req, res) => {
        const { rawMessage } = req.body;
        if (!rawMessage) {
            return res.status(400).json({ error: 'rawMessage is required' });
        }
        try {
            // Спроба парсингу повідомлення
            const parsed = (0, viber_parser_1.parseViberMessage)(rawMessage);
            if (!parsed) {
                return res.status(400).json({
                    error: 'Не вдалося розпарсити повідомлення. Перевірте формат.'
                });
            }
            const nameFromDb = parsed.phone ? await (0, telegram_1.getNameByPhone)(parsed.phone) : null;
            let senderName = nameFromDb ?? parsed.senderName ?? null;
            if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
                const nameFromTg = await (0, telegram_1.resolveNameByPhoneFromTelegram)(parsed.phone);
                if (nameFromTg?.trim())
                    senderName = nameFromTg.trim();
            }
            const person = parsed.phone
                ? await (0, telegram_1.findOrCreatePersonByPhone)(parsed.phone, { fullName: senderName ?? undefined })
                : null;
            const { listing } = await createOrMergeViberListing({
                rawMessage,
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
            console.log(`✅ Створено Viber оголошення #${listing.id}:`, {
                type: listing.listingType,
                route: listing.route,
                date: listing.date,
                phone: listing.phone
            });
            const matchingRecheckTriggered = (0, telegram_1.isTelegramEnabled)();
            if (matchingRecheckTriggered) {
                (0, telegram_1.sendViberListingNotificationToAdmin)({
                    id: listing.id,
                    listingType: listing.listingType,
                    route: listing.route,
                    date: listing.date,
                    departureTime: listing.departureTime,
                    seats: listing.seats,
                    phone: listing.phone,
                    senderName: listing.senderName,
                    notes: listing.notes,
                    priceUah: listing.priceUah ?? undefined,
                }).catch((err) => console.error('Telegram Viber notify:', err));
                // Якщо є телефон — спроба надіслати автору оголошення в Telegram (якщо він є в базі)
                if (listing.phone && listing.phone.trim()) {
                    (0, telegram_1.sendViberListingConfirmationToUser)(listing.phone, {
                        id: listing.id,
                        route: listing.route,
                        date: listing.date,
                        departureTime: listing.departureTime,
                        seats: listing.seats,
                        listingType: listing.listingType,
                        priceUah: listing.priceUah ?? undefined,
                    }).catch((err) => console.error('Telegram Viber user notify:', err));
                }
                // Збіги після збереження (новий рядок або merge): дедуп пар у БД не дає спамити старі пари; повторний прогін — нові оголошення в базі та повтор невдалих доставок
                const authorChatId = listing.phone?.trim() ? await (0, telegram_1.getChatIdByPhone)(listing.phone) : null;
                if (listing.listingType === 'driver') {
                    (0, telegram_1.notifyMatchingPassengersForNewDriver)(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
                }
                else if (listing.listingType === 'passenger') {
                    (0, telegram_1.notifyMatchingDriversForNewPassenger)(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
                }
            }
            res.status(201).json({ ...(0, index_helpers_1.serializeViberListing)(listing), matchingRecheckTriggered });
        }
        catch (error) {
            console.error('❌ Помилка створення Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to create Viber listing' });
        }
    });
    // Масове створення Viber оголошень з копіювання чату (Admin)
    app.post('/viber-listings/bulk', require_admin_1.requireAdmin, async (req, res) => {
        const { rawMessages } = req.body;
        if (!rawMessages) {
            return res.status(400).json({ error: 'rawMessages is required' });
        }
        try {
            const parsedMessages = (0, viber_parser_1.parseViberMessages)(rawMessages);
            if (parsedMessages.length === 0) {
                return res.status(400).json({
                    error: 'Не вдалося розпарсити жодне повідомлення'
                });
            }
            const created = [];
            const errors = [];
            const matchingRecheckTriggered = (0, telegram_1.isTelegramEnabled)();
            for (let i = 0; i < parsedMessages.length; i++) {
                const { parsed, rawMessage: rawText } = parsedMessages[i];
                try {
                    const nameFromDb = parsed.phone ? await (0, telegram_1.getNameByPhone)(parsed.phone) : null;
                    let senderName = nameFromDb ?? parsed.senderName ?? null;
                    if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
                        const nameFromTg = await (0, telegram_1.resolveNameByPhoneFromTelegram)(parsed.phone);
                        if (nameFromTg?.trim())
                            senderName = nameFromTg.trim();
                    }
                    const person = parsed.phone
                        ? await (0, telegram_1.findOrCreatePersonByPhone)(parsed.phone, { fullName: senderName ?? undefined })
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
                        created.push(listing);
                    }
                    if (matchingRecheckTriggered) {
                        (0, telegram_1.sendViberListingNotificationToAdmin)({
                            id: listing.id,
                            listingType: listing.listingType,
                            route: listing.route,
                            date: listing.date,
                            departureTime: listing.departureTime,
                            seats: listing.seats,
                            phone: listing.phone,
                            senderName: listing.senderName,
                            notes: listing.notes,
                            priceUah: listing.priceUah ?? undefined,
                        }).catch((err) => console.error('Telegram Viber notify:', err));
                        if (listing.phone && listing.phone.trim()) {
                            (0, telegram_1.sendViberListingConfirmationToUser)(listing.phone, {
                                id: listing.id,
                                route: listing.route,
                                date: listing.date,
                                departureTime: listing.departureTime,
                                seats: listing.seats,
                                listingType: listing.listingType,
                                priceUah: listing.priceUah ?? undefined,
                            }).catch((err) => console.error('Telegram Viber user notify:', err));
                        }
                        const authorChatId = listing.phone?.trim() ? await (0, telegram_1.getChatIdByPhone)(listing.phone) : null;
                        if (listing.listingType === 'driver') {
                            (0, telegram_1.notifyMatchingPassengersForNewDriver)(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
                        }
                        else if (listing.listingType === 'passenger') {
                            (0, telegram_1.notifyMatchingDriversForNewPassenger)(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
                        }
                    }
                }
                catch (error) {
                    errors.push({ index: i, error: error instanceof Error ? error.message : 'Unknown error' });
                }
            }
            console.log(`✅ Створено ${created.length} Viber оголошень з ${parsedMessages.length}`);
            res.status(201).json({
                success: true,
                created: created.length,
                total: parsedMessages.length,
                errors: errors.length > 0 ? errors : undefined,
                listings: created,
                matchingRecheckTriggered,
            });
        }
        catch (error) {
            console.error('❌ Помилка масового створення Viber оголошень:', error);
            res.status(500).json({ error: 'Failed to create Viber listings' });
        }
    });
    // Дозволені поля для оновлення Viber оголошення (без id, createdAt, updatedAt)
    const VIBER_LISTING_UPDATE_FIELDS = [
        'rawMessage', 'senderName', 'listingType', 'route', 'date', 'departureTime', 'seats', 'phone', 'notes', 'priceUah', 'isActive'
    ];
    // Оновити Viber оголошення (Admin)
    app.put('/viber-listings/:id', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        const body = req.body;
        const updates = {};
        for (const key of VIBER_LISTING_UPDATE_FIELDS) {
            if (body[key] !== undefined) {
                if (key === 'date' && typeof body[key] === 'string') {
                    updates[key] = new Date(body[key]);
                }
                else if (key === 'priceUah') {
                    const v = body[key];
                    updates[key] = v === null || v === '' ? null : (typeof v === 'number' ? v : parseInt(String(v), 10));
                }
                else {
                    updates[key] = body[key];
                }
            }
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No allowed fields to update' });
        }
        try {
            const listing = await prisma.viberListing.update({
                where: { id: Number(id) },
                data: updates
            });
            let matchingRecheckTriggered = false;
            // Після редагування оголошення — повторно проганяємо matching-нотифікації
            // (дедуп пар у БД не дає дублювати вже доставлені пари).
            if ((0, telegram_1.isTelegramEnabled)()) {
                matchingRecheckTriggered = true;
                const authorChatId = listing.phone?.trim() ? await (0, telegram_1.getChatIdByPhone)(listing.phone) : null;
                if (listing.listingType === 'driver') {
                    (0, telegram_1.notifyMatchingPassengersForNewDriver)(listing, authorChatId).catch((err) => console.error('Telegram match notify after admin update (driver):', err));
                }
                else if (listing.listingType === 'passenger') {
                    (0, telegram_1.notifyMatchingDriversForNewPassenger)(listing, authorChatId).catch((err) => console.error('Telegram match notify after admin update (passenger):', err));
                }
            }
            res.json({ ...(0, index_helpers_1.serializeViberListing)(listing), matchingRecheckTriggered });
        }
        catch (error) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Viber listing not found' });
            }
            console.error('❌ Помилка оновлення Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to update Viber listing' });
        }
    });
    // Деактивувати Viber оголошення (Admin)
    app.patch('/viber-listings/:id/deactivate', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const listing = await prisma.viberListing.update({
                where: { id: Number(id) },
                data: { isActive: false }
            });
            res.json(listing);
        }
        catch (error) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Viber listing not found' });
            }
            console.error('❌ Помилка деактивації Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to deactivate Viber listing' });
        }
    });
    // Видалити Viber оголошення (Admin)
    app.delete('/viber-listings/:id', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            await prisma.viberListing.delete({
                where: { id: Number(id) }
            });
            res.status(204).send();
        }
        catch (error) {
            if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Viber listing not found' });
            }
            console.error('❌ Помилка видалення Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to delete Viber listing' });
        }
    });
    // Автоматичне деактивування старих оголошень (можна викликати з cron).
    // «Дата по» = date + кінець часу з departureTime (один час "15:00" або кінець діапазону "14:30-16:00" → 16:00).
    // Деактивуємо, якщо дата по < зараз − 1 год.
    const CLEANUP_CUTOFF_HOURS = 1;
    app.post('/viber-listings/cleanup-old', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const cutoff = new Date();
            cutoff.setHours(cutoff.getHours() - CLEANUP_CUTOFF_HOURS);
            const activeListings = await prisma.viberListing.findMany({
                where: { isActive: true },
                select: { id: true, date: true, departureTime: true }
            });
            const idsToDeactivate = activeListings
                .filter((l) => (0, index_helpers_1.getViberListingEndDateTime)(l.date, l.departureTime) < cutoff)
                .map((l) => l.id);
            const count = idsToDeactivate.length;
            if (count > 0) {
                await prisma.viberListing.updateMany({
                    where: { id: { in: idsToDeactivate } },
                    data: { isActive: false }
                });
            }
            console.log(`🧹 Деактивовано ${count} старих Viber оголошень (дата по < ${cutoff.toISOString()})`);
            res.json({
                success: true,
                deactivated: count,
                message: `Деактивовано ${count} оголошень`
            });
        }
        catch (error) {
            console.error('❌ Помилка очищення старих Viber оголошень:', error);
            res.status(500).json({ error: 'Failed to cleanup old listings' });
        }
    });
    // ——— Одноразова реклама каналу (Person без Telegram). Без зміни telegramPromoSentAt. ———
    function buildChannelPromoMessage() {
        const links = (0, telegram_1.getTelegramScenarioLinks)();
        const channelLink = process.env.TELEGRAM_CHANNEL_LINK?.trim() || links.poputkyWeb;
        return `
📢 <b>Поїздки Київ ↔ Малин ↔ Житомир ↔ Коростень</b>

Підпишіться на наш бот — бронювання маршруток та попуток у один клік:
• як водій: ${links.driver}
• як пасажир: ${links.passenger}

Сайт: <a href="https://malin.kiev.ua">malin.kiev.ua</a>
  `.trim();
    }
    /** Створити контакт (Person) за телефоном та іменем. Якщо номер вже є — оновлює fullName. */
    app.post('/admin/person', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const { phone, fullName } = req.body;
            const rawPhone = typeof phone === 'string' ? phone.trim() : '';
            const rawName = typeof fullName === 'string' ? fullName.trim() : '';
            if (!rawPhone) {
                res.status(400).json({ error: 'Потрібен номер телефону' });
                return;
            }
            if (!rawName) {
                res.status(400).json({ error: 'Потрібне ім\'я' });
                return;
            }
            const person = await (0, telegram_1.findOrCreatePersonByPhone)(rawPhone, { fullName: rawName });
            res.json(person);
        }
        catch (e) {
            console.error('❌ POST /admin/person:', e);
            res.status(500).json({ error: 'Не вдалося створити контакт' });
        }
    });
    /** Список Person для управління даними. Query: ?search= — пошук по телефону або імені. */
    app.get('/admin/persons', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const search = req.query.search?.trim() || '';
            const where = search
                ? {
                    OR: [
                        { phoneNormalized: { contains: search.replace(/\D/g, '') } },
                        { fullName: { contains: search, mode: 'insensitive' } },
                    ],
                }
                : {};
            const persons = await prisma.person.findMany({
                where,
                orderBy: { id: 'asc' },
                include: {
                    _count: { select: { bookings: true, viberListings: true } },
                },
            });
            res.json(persons);
        }
        catch (e) {
            console.error('❌ GET /admin/persons:', e);
            res.status(500).json({ error: 'Не вдалося завантажити список персон' });
        }
    });
    /** Оновити імена персон: спочатку по боту, потім по номеру (ваш акаунт), потім через Opendatabot. Якщо імені не було — заповнити будь-яким; інакше вибрати найдовше кириличне серед усіх. onlyEmpty: true — лише персони без імені в базі. onlyLatin: true — лише персони з іменем, де немає кирилиці (латиниця). */
    app.post('/admin/persons/refresh-names', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const body = (req.body || {});
            const personIds = Array.isArray(body.personIds) ? body.personIds.filter((id) => Number.isInteger(id) && id > 0) : undefined;
            const onlyEmpty = body.onlyEmpty === true;
            const onlyLatin = body.onlyLatin === true;
            const emptyNameCondition = { OR: [{ fullName: null }, { fullName: '' }] };
            const where = onlyEmpty && personIds && personIds.length > 0
                ? { id: { in: personIds }, ...emptyNameCondition }
                : onlyEmpty
                    ? emptyNameCondition
                    : personIds && personIds.length > 0
                        ? { id: { in: personIds } }
                        : {};
            let persons = await prisma.person.findMany({
                where,
                orderBy: { id: 'asc' },
            });
            const totalPersons = persons.length;
            if (onlyEmpty) {
                persons = persons.filter((p) => !p.fullName || !p.fullName.trim());
            }
            let latinCandidates = 0;
            if (onlyLatin) {
                latinCandidates = persons.filter((p) => p.fullName && p.fullName.trim() && !(0, telegram_1.hasCyrillic)(p.fullName)).length;
                persons = persons.filter((p) => p.fullName && p.fullName.trim() && !(0, telegram_1.hasCyrillic)(p.fullName));
            }
            console.log(`[refresh-names] Старт: total=${totalPersons}, latinCandidates=${latinCandidates}, для_перевірки=${persons.length}` +
                `${onlyEmpty ? ' (onlyEmpty)' : ''}` +
                `${onlyLatin ? ' (onlyLatin)' : ''}`);
            const changes = [];
            let updated = 0;
            let skipped = 0;
            const errors = [];
            for (const p of persons) {
                try {
                    const { nameFromBot, nameFromUser, nameFromOpendatabot } = await (0, telegram_1.getResolvedNameForPerson)(p.phoneNormalized, p.telegramChatId);
                    const currentName = p.fullName?.trim() || null;
                    const { newName, source } = (0, telegram_1.pickBestNameFromCandidates)(currentName, nameFromBot, nameFromUser, nameFromOpendatabot);
                    console.log(`[refresh-names] #${p.id} ${p.phoneNormalized}: поточне="${currentName ?? ''}" | бот="${nameFromBot ?? ''}" | по_номеру="${nameFromUser ?? ''}" | opendatabot="${nameFromOpendatabot ?? ''}" → обрано="${newName ?? ''}" (${source ?? '—'})`);
                    if (newName !== currentName && newName) {
                        await prisma.person.update({
                            where: { id: p.id },
                            data: { fullName: newName },
                        });
                        await prisma.booking.updateMany({ where: { personId: p.id }, data: { name: newName } });
                        await prisma.viberListing.updateMany({ where: { personId: p.id }, data: { senderName: newName } });
                        updated++;
                        changes.push({ personId: p.id, phone: p.phoneNormalized, oldName: currentName, newName, source });
                        console.log(`[refresh-names] #${p.id} оновлено: "${currentName ?? ''}" → "${newName}" (${source})`);
                    }
                    else {
                        skipped++;
                    }
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    errors.push(`#${p.id} ${p.phoneNormalized}: ${msg}`);
                    console.error(`[refresh-names] #${p.id} ${p.phoneNormalized} помилка:`, msg);
                }
            }
            console.log(`[refresh-names] Підсумок: total=${persons.length}, updated=${updated}, skipped=${skipped}, errors=${errors.length}`);
            res.json({
                total: persons.length,
                updated,
                skipped,
                errors: errors.length > 0 ? errors : undefined,
                changes,
            });
        }
        catch (e) {
            console.error('❌ POST /admin/persons/refresh-names:', e);
            res.status(500).json({ error: 'Не вдалося оновити імена' });
        }
    });
    /** Перевірити номера: знайти персон без telegramChatId, спробувати ResolvePhone і оновити telegramUsername. */
    app.post('/admin/persons/check-usernames', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const persons = await prisma.person.findMany({
                where: {
                    telegramChatId: null,
                    OR: [{ telegramUsername: null }, { telegramUsername: '' }],
                },
                orderBy: { id: 'asc' },
            });
            let updated = 0;
            const errors = [];
            for (const p of persons) {
                try {
                    const username = await (0, telegram_1.resolveUsernameByPhoneFromTelegram)(p.phoneNormalized);
                    if (username?.trim()) {
                        await prisma.person.update({
                            where: { id: p.id },
                            data: { telegramUsername: username.trim() },
                        });
                        updated++;
                        console.log(`[check-usernames] #${p.id} ${p.phoneNormalized} → @${username}`);
                    }
                    // Пауза між запитами, щоб не перевищити rate limit
                    await new Promise((r) => setTimeout(r, 1500));
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    errors.push(`#${p.id} ${p.phoneNormalized}: ${msg}`);
                }
            }
            console.log(`[check-usernames] Підсумок: total=${persons.length}, updated=${updated}`);
            res.json({ total: persons.length, updated, errors: errors.length > 0 ? errors : undefined });
        }
        catch (e) {
            console.error('❌ POST /admin/persons/check-usernames:', e);
            res.status(500).json({ error: 'Не вдалося перевірити номера' });
        }
    });
    /** Одна персона за id. */
    app.get('/admin/persons/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const person = await prisma.person.findUnique({
                where: { id },
                include: {
                    _count: { select: { bookings: true, viberListings: true } },
                },
            });
            if (!person) {
                res.status(404).json({ error: 'Персону не знайдено' });
                return;
            }
            res.json(person);
        }
        catch (e) {
            console.error('❌ GET /admin/persons/:id:', e);
            res.status(500).json({ error: 'Не вдалося завантажити персону' });
        }
    });
    /** Оновити персону. При зміні телефону або імені оновлюються пов’язані Booking (phone, name) та ViberListing (phone, senderName). */
    app.put('/admin/persons/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const body = req.body;
            const person = await prisma.person.findUnique({ where: { id } });
            if (!person) {
                res.status(404).json({ error: 'Персону не знайдено' });
                return;
            }
            const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : (typeof body.phoneNormalized === 'string' ? body.phoneNormalized.trim() : '');
            const newPhoneNormalized = rawPhone ? (0, telegram_1.normalizePhone)(rawPhone) : person.phoneNormalized;
            const newFullName = body.fullName !== undefined ? (typeof body.fullName === 'string' ? body.fullName.trim() || null : null) : person.fullName;
            const newTelegramChatId = body.telegramChatId !== undefined ? (body.telegramChatId === '' ? null : body.telegramChatId) : person.telegramChatId;
            const newTelegramUserId = body.telegramUserId !== undefined ? (body.telegramUserId === '' ? null : body.telegramUserId) : person.telegramUserId;
            const newTelegramUsername = body.telegramUsername !== undefined ? (body.telegramUsername === '' ? null : body.telegramUsername) : person.telegramUsername;
            let newTelegramPromoSentAt = person.telegramPromoSentAt;
            if (body.telegramPromoSentAt !== undefined) {
                if (body.telegramPromoSentAt === null || body.telegramPromoSentAt === '') {
                    newTelegramPromoSentAt = null;
                }
                else {
                    const parsed = new Date(body.telegramPromoSentAt);
                    newTelegramPromoSentAt = Number.isNaN(parsed.getTime()) ? person.telegramPromoSentAt : parsed;
                }
            }
            let newTelegramReminderSentAt = person.telegramReminderSentAt;
            if (body.telegramReminderSentAt !== undefined) {
                if (body.telegramReminderSentAt === null || body.telegramReminderSentAt === '') {
                    newTelegramReminderSentAt = null;
                }
                else {
                    const parsed = new Date(body.telegramReminderSentAt);
                    newTelegramReminderSentAt = Number.isNaN(parsed.getTime()) ? person.telegramReminderSentAt : parsed;
                }
            }
            if (!newPhoneNormalized) {
                res.status(400).json({ error: 'Телефон не може бути порожнім' });
                return;
            }
            const phoneChanged = newPhoneNormalized !== person.phoneNormalized;
            const nameChanged = newFullName !== person.fullName;
            const updated = await prisma.person.update({
                where: { id },
                data: {
                    phoneNormalized: newPhoneNormalized,
                    fullName: newFullName,
                    telegramChatId: newTelegramChatId,
                    telegramUserId: newTelegramUserId,
                    telegramUsername: newTelegramUsername,
                    telegramPromoSentAt: newTelegramPromoSentAt,
                    telegramReminderSentAt: newTelegramReminderSentAt,
                },
            });
            if (phoneChanged || nameChanged) {
                const bookingData = {};
                if (phoneChanged)
                    bookingData.phone = newPhoneNormalized;
                if (nameChanged)
                    bookingData.name = newFullName ?? '';
                const viberData = {};
                if (phoneChanged)
                    viberData.phone = newPhoneNormalized;
                if (nameChanged)
                    viberData.senderName = newFullName;
                const [bookingsUpdated, viberUpdated] = await Promise.all([
                    Object.keys(bookingData).length > 0
                        ? prisma.booking.updateMany({ where: { personId: id }, data: bookingData })
                        : Promise.resolve({ count: 0 }),
                    Object.keys(viberData).length > 0
                        ? prisma.viberListing.updateMany({ where: { personId: id }, data: viberData })
                        : Promise.resolve({ count: 0 }),
                ]);
                if (bookingsUpdated.count > 0 || viberUpdated.count > 0) {
                    console.log(`📝 Оновлено персону #${id}: booking.count=${bookingsUpdated.count}, viberListing.count=${viberUpdated.count}`);
                }
            }
            res.json(updated);
        }
        catch (e) {
            console.error('❌ PUT /admin/persons/:id:', e);
            res.status(500).json({ error: 'Не вдалося оновити персону' });
        }
    });
    /** Видалити персону та всі залежні записи по personId (Booking, ViberListing, ViberRideEvent). */
    app.delete('/admin/persons/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const result = await prisma.$transaction(async (tx) => {
                const person = await tx.person.findUnique({ where: { id } });
                if (!person)
                    return null;
                const [bookingsDeleted, viberListingsDeleted, viberRideEventsDeleted] = await Promise.all([
                    tx.booking.deleteMany({ where: { personId: id } }),
                    tx.viberListing.deleteMany({ where: { personId: id } }),
                    tx.viberRideEvent.deleteMany({ where: { personId: id } }),
                ]);
                await tx.person.delete({ where: { id } });
                return {
                    id,
                    deleted: {
                        bookings: bookingsDeleted.count,
                        viberListings: viberListingsDeleted.count,
                        viberRideEvents: viberRideEventsDeleted.count,
                    },
                };
            });
            if (!result) {
                res.status(404).json({ error: 'Персону не знайдено' });
                return;
            }
            console.log(`🗑️ Видалено персону #${result.id}: booking.count=${result.deleted.bookings}, viberListing.count=${result.deleted.viberListings}, viberRideEvent.count=${result.deleted.viberRideEvents}`);
            res.json(result);
        }
        catch (e) {
            console.error('❌ DELETE /admin/persons/:id:', e);
            res.status(500).json({ error: 'Не вдалося видалити персону' });
        }
    });
    /** Список Person для Telegram-нагадувань (база = з ботом). Query: ?filter=all|no_active_viber|no_reminder_7_days */
    app.get('/admin/telegram-reminder-persons', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const filter = req.query.filter?.trim() || 'all';
            const where = (0, index_helpers_1.getTelegramReminderWhere)(filter);
            const persons = await prisma.person.findMany({
                where,
                select: {
                    id: true,
                    phoneNormalized: true,
                    fullName: true,
                    telegramChatId: true,
                    telegramReminderSentAt: true,
                },
                orderBy: { id: 'asc' },
            });
            res.json(persons.map((p) => ({
                id: p.id,
                phoneNormalized: p.phoneNormalized,
                fullName: p.fullName,
                telegramReminderSentAt: p.telegramReminderSentAt ? p.telegramReminderSentAt.toISOString() : null,
            })));
        }
        catch (e) {
            console.error('❌ telegram-reminder-persons:', e);
            res.status(500).json({ error: 'Failed to load telegram reminder persons' });
        }
    });
    /** Помилки відправки через персональний акаунт (PRIVACY_PREMIUM_REQUIRED тощо) */
    app.get('/admin/telegram-user-send-errors', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const rows = await prisma.telegramUserSendError.findMany({
                orderBy: { createdAt: 'desc' },
                take: 200,
            });
            res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
        }
        catch (e) {
            console.error('❌ telegram-user-send-errors:', e);
            res.status(500).json({ error: 'Не вдалося завантажити помилки' });
        }
    });
    /** Обнулити таблицю помилок user-sender */
    app.delete('/admin/telegram-user-send-errors', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const result = await prisma.telegramUserSendError.deleteMany({});
            res.json({ deleted: result.count });
        }
        catch (e) {
            console.error('❌ DELETE telegram-user-send-errors:', e);
            res.status(500).json({ error: 'Не вдалося обнулити' });
        }
    });
    /** Відправити Telegram-нагадування неактивним користувачам. Body: { filter?, limit?, delaysMs? } */
    app.post('/admin/send-telegram-reminders', require_admin_1.requireAdmin, async (req, res) => {
        if (!(0, telegram_1.isTelegramEnabled)()) {
            return res.status(400).json({ error: 'Telegram bot не налаштовано' });
        }
        try {
            const filter = req.body?.filter?.trim() || 'all';
            if (!['all', 'no_active_viber', 'no_reminder_7_days'].includes(filter)) {
                res.status(400).json({ error: 'Invalid filter' });
                return;
            }
            const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
            const delaysMs = Array.isArray(req.body?.delaysMs)
                ? req.body.delaysMs.filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
                : undefined;
            const where = (0, index_helpers_1.getTelegramReminderWhere)(filter);
            let persons = await prisma.person.findMany({
                where,
                select: { id: true, phoneNormalized: true, fullName: true, telegramChatId: true },
                orderBy: { id: 'asc' },
            });
            if (limit !== undefined) {
                persons = persons.slice(0, limit);
            }
            let sent = 0;
            let failed = 0;
            const blocked = [];
            for (let i = 0; i < persons.length; i++) {
                const p = persons[i];
                const chatId = p.telegramChatId;
                if (!chatId || chatId === '0' || !chatId.trim()) {
                    failed++;
                }
                else {
                    try {
                        await (0, telegram_1.sendInactivityReminder)(chatId);
                        sent++;
                        await prisma.person.update({
                            where: { id: p.id },
                            data: { telegramReminderSentAt: new Date() },
                        });
                    }
                    catch (err) {
                        const errMsg = String(err?.message ?? err);
                        const isBlocked = errMsg.includes('blocked by the user') || (errMsg.includes('403') && errMsg.toLowerCase().includes('forbidden'));
                        if (isBlocked) {
                            blocked.push({ id: p.id, phoneNormalized: p.phoneNormalized, fullName: p.fullName });
                        }
                        console.error(`❌ send-telegram-reminders person #${p.id}:`, err);
                        failed++;
                    }
                }
                if (delaysMs?.length && i < persons.length - 1) {
                    const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
                    if (delayMs > 0) {
                        await new Promise((r) => setTimeout(r, delayMs));
                    }
                }
            }
            const total = persons.length;
            const message = `Нагадування відправлено: ${sent}, помилок: ${failed}, всього в вибірці: ${total}${blocked.length > 0 ? `; заблокували бота: ${blocked.length}` : ''}`;
            console.log(`📢 Telegram reminders (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent}, failed=${failed}, blocked=${blocked.length}, total=${total}`);
            res.json({ success: true, total, sent, failed, message, blocked });
        }
        catch (e) {
            console.error('❌ send-telegram-reminders:', e);
            res.status(500).json({ error: 'Failed to send telegram reminders' });
        }
    });
    /** Нагадати від особистого акаунта тим, хто заблокував бота. Body: { phones: string[], delaysSec?: number[] }. */
    app.post('/admin/send-reminder-via-user-account', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const phones = Array.isArray(req.body?.phones) ? req.body.phones.map((p) => String(p).trim()).filter(Boolean) : [];
            if (phones.length === 0) {
                return res.status(400).json({ error: 'Потрібен масив phones' });
            }
            const delaysSec = Array.isArray(req.body?.delaysSec)
                ? req.body.delaysSec.filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120))
                : [2, 15, 25, 30];
            const delaysMs = delaysSec.length > 0 ? delaysSec.map((s) => s * 1000) : [];
            const message = (0, telegram_1.buildInactivityReminderMessage)();
            let sent = 0;
            let failed = 0;
            for (let i = 0; i < phones.length; i++) {
                const rawPhone = phones[i];
                const phone = (0, telegram_1.normalizePhone)(rawPhone);
                if (!phone) {
                    failed++;
                }
                else {
                    const person = await (0, telegram_1.getPersonByPhone)(phone);
                    const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, message, {
                        telegramUsername: person?.telegramUsername ?? undefined,
                    });
                    if (ok)
                        sent++;
                    else
                        failed++;
                }
                if (delaysMs.length > 0 && i < phones.length - 1) {
                    const delayMs = delaysMs[i % delaysMs.length] ?? 30000;
                    await new Promise((r) => setTimeout(r, delayMs));
                }
            }
            const resultMessage = `Відправлено від вашого імені: ${sent}, помилок: ${failed}`;
            console.log(`📢 Reminder via user account: ${sent} sent, ${failed} failed`);
            res.json({ success: true, sent, failed, message: resultMessage });
        }
        catch (e) {
            console.error('❌ send-reminder-via-user-account:', e);
            res.status(500).json({ error: 'Failed to send reminder via user account' });
        }
    });
    /** Список Person для реклами каналу (база = без бота). Query: ?filter=no_telegram|no_communication|promo_not_found */
    app.get('/admin/channel-promo-persons', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const filter = req.query.filter?.trim() || 'no_telegram';
            const where = (0, index_helpers_1.getChannelPromoWhere)(filter);
            const persons = await prisma.person.findMany({
                where,
                select: { id: true, phoneNormalized: true, fullName: true },
                orderBy: { id: 'asc' },
            });
            res.json(persons);
        }
        catch (e) {
            console.error('❌ channel-promo-persons:', e);
            res.status(500).json({ error: 'Failed to load persons' });
        }
    });
    /** Відправити рекламу каналу. Body: { filter?, limit?, delaysMs? }. limit — лише перші N; delaysMs — паузи в мс між відправками [після 1-го, після 2-го, ...]. */
    app.post('/admin/send-channel-promo', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const filter = req.body?.filter?.trim() || 'no_telegram';
            if (!['no_telegram', 'no_communication', 'promo_not_found'].includes(filter)) {
                res.status(400).json({ error: 'Invalid filter' });
                return;
            }
            const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
            const delaysMs = Array.isArray(req.body?.delaysMs)
                ? req.body.delaysMs.filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
                : undefined;
            const where = (0, index_helpers_1.getChannelPromoWhere)(filter);
            let persons = await prisma.person.findMany({
                where,
                select: { id: true, phoneNormalized: true, fullName: true, telegramUsername: true },
                orderBy: { id: 'asc' },
            });
            if (limit !== undefined) {
                persons = persons.slice(0, limit);
            }
            const message = buildChannelPromoMessage();
            const sent = [];
            const notFound = [];
            for (let i = 0; i < persons.length; i++) {
                const p = persons[i];
                const phone = (0, telegram_1.normalizePhone)(p.phoneNormalized);
                if (!phone)
                    continue;
                const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, message, {
                    telegramUsername: p.telegramUsername ?? undefined,
                });
                if (ok) {
                    sent.push({ phone: p.phoneNormalized, fullName: p.fullName });
                    await prisma.person.update({
                        where: { id: p.id },
                        data: { telegramPromoSentAt: new Date() },
                    });
                }
                else {
                    notFound.push({ phone: p.phoneNormalized, fullName: p.fullName });
                    await prisma.person.update({
                        where: { id: p.id },
                        data: { telegramPromoSentAt: index_helpers_1.PROMO_NOT_FOUND_SENTINEL },
                    });
                }
                if (delaysMs?.length && i < persons.length - 1) {
                    const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
                    if (delayMs > 0)
                        await new Promise((r) => setTimeout(r, delayMs));
                }
            }
            console.log(`📢 Channel promo (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent.length}, notFound=${notFound.length}`);
            res.json({ sent, notFound });
        }
        catch (e) {
            console.error('❌ send-channel-promo:', e);
            res.status(500).json({ error: 'Failed to send channel promo' });
        }
    });
    // Історичні дані з окремої таблиці "ViberRide" (сервіс парсингу Viber чату) → аналітична таблиця ViberRideEvent.
    // Endpoint: тільки нові записи, щоб можна було викликати кілька разів.
    app.post('/admin/viber-analytics/import', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            // Які ViberListing вже імпортовані в ViberRideEvent (по viberRideId)
            const existing = await prisma.viberRideEvent.findMany({
                select: { viberRideId: true },
            });
            const importedIds = new Set(existing.map((r) => r.viberRideId));
            // Читаємо всі (або більшість) записів з ViberListing
            const rows = (await prisma.viberListing.findMany({
                orderBy: { id: 'asc' },
            }));
            const newRows = rows.filter((r) => !importedIds.has(r.id));
            if (newRows.length === 0) {
                const totalEvents = await prisma.viberRideEvent.count();
                return res.json({
                    success: true,
                    totalSource: rows.length,
                    alreadyImported: rows.length,
                    importedNow: 0,
                    message: 'Нових записів ViberRide немає — все вже імпортовано раніше.',
                    totalListings: rows.length,
                    totalEvents,
                });
            }
            const toInsert = [];
            for (const r of newRows) {
                const rawPhone = (r.phone ?? '').trim();
                const normalized = rawPhone ? (0, telegram_1.normalizePhone)(rawPhone) : '';
                let weekday = null;
                let hour = null;
                if (r.date instanceof Date) {
                    // JS: 0 = неділя ... 6 = субота
                    weekday = r.date.getDay();
                }
                if (r.departureTime) {
                    const timePart = r.departureTime.split('-')[0].trim();
                    const [hStr] = timePart.split(':');
                    const hNum = parseInt(hStr, 10);
                    if (!Number.isNaN(hNum) && hNum >= 0 && hNum <= 23) {
                        hour = hNum;
                    }
                }
                const phoneNormalized = normalized || rawPhone || '';
                const personId = r.personId ?? null;
                toInsert.push({
                    viberRideId: r.id,
                    contactPhone: rawPhone || phoneNormalized,
                    phoneNormalized,
                    personId,
                    route: r.route ?? null,
                    departureDate: r.date ?? null,
                    departureTime: r.departureTime ?? null,
                    availableSeats: r.seats ?? null,
                    priceUah: r.priceUah ?? null,
                    isParsed: true,
                    isActive: r.isActive ?? null,
                    parsingErrors: null,
                    weekday,
                    hour,
                    createdAt: r.createdAt ?? new Date(),
                });
            }
            let created = 0;
            const chunkSize = 500;
            for (let i = 0; i < toInsert.length; i += chunkSize) {
                const chunk = toInsert.slice(i, i + chunkSize);
                if (!chunk.length)
                    continue;
                const result = await prisma.viberRideEvent.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                created += result.count;
            }
            // Після імпорту чистимо джерело: видаляємо записи старше ніж "дата запиту - 1 місяць".
            // У поточній схемі історія "ViberRide" зберігається в таблиці ViberListing (поле date = дата поїздки).
            const requestDate = new Date();
            const cutoff = new Date(requestDate);
            cutoff.setMonth(cutoff.getMonth() - 1);
            const deletedOldSource = await prisma.viberListing.deleteMany({
                where: {
                    date: { lt: cutoff },
                },
            });
            const totalEvents = await prisma.viberRideEvent.count();
            res.json({
                success: true,
                totalSource: rows.length,
                alreadyImported: rows.length - newRows.length,
                importedNow: created,
                totalListings: rows.length,
                totalEvents,
                deletedSourceOld: deletedOldSource.count,
                sourceCleanupBefore: cutoff.toISOString(),
            });
        }
        catch (e) {
            console.error('❌ Помилка імпорту з ViberRide в ViberRideEvent:', e);
            res.status(500).json({
                error: 'Не вдалося імпортувати історичні ViberRide дані. Переконайтеся, що таблиця "ViberRide" існує і має очікувані колонки.',
            });
        }
    });
    // Аналіз телефонів через phonecheck.top: для кожного телефону дивимося, чи є дані (ігноруємо "Данные не найдены").
    app.post('/admin/phonecheck/analyze', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const body = (req.body || {});
            const rawPhones = Array.isArray(body.phones) ? body.phones : [];
            const uniquePhones = Array.from(new Set(rawPhones
                .map((p) => (typeof p === 'string' ? p.trim() : ''))
                .filter((p) => p.length > 0)));
            if (uniquePhones.length === 0) {
                return res.status(400).json({ error: 'Потрібен масив phones' });
            }
            const results = [];
            for (const phone of uniquePhones) {
                const result = await (0, phonecheck_1.runPhoneCheckForPhone)(phone);
                if (result) {
                    results.push(result);
                }
            }
            const withDataCount = results.filter((r) => r.hasData).length;
            console.log(`[phonecheck] analyze: totalPhones=${uniquePhones.length}, results=${results.length}, withData=${withDataCount}`);
            for (const r of results) {
                console.log(`[phonecheck] ${r.phone}: ${r.hasData ? 'HAS_DATA' : 'NO_DATA'}`);
            }
            res.json({
                total: uniquePhones.length,
                withData: withDataCount,
                results,
            });
        }
        catch (e) {
            console.error('❌ POST /admin/phonecheck/analyze:', e);
            res.status(500).json({ error: 'Не вдалося виконати аналіз phonecheck.top' });
        }
    });
    // Аналітика поведінки клієнтів на основі ViberRideEvent.
    // Повертає до N клієнтів з найбільшою кількістю поїздок та коротким описом патернів.
    app.get('/admin/viber-analytics/summary', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const pageParam = Number(req.query.page);
            const pageSizeParam = Number(req.query.pageSize ?? req.query.limit);
            const minRidesParam = Number(req.query.minRides);
            const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0
                ? Math.min(200, Math.max(10, Math.floor(pageSizeParam)))
                : 50;
            const requestedPage = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
            const minRides = Number.isFinite(minRidesParam) && minRidesParam > 0
                ? Math.floor(minRidesParam)
                : 3;
            const grouped = await prisma.viberRideEvent.groupBy({
                by: ['phoneNormalized'],
                _count: { _all: true },
                where: {
                    phoneNormalized: { not: '' },
                    isParsed: true,
                },
            });
            const filteredTop = grouped
                .filter((t) => t._count._all >= minRides)
                .sort((a, b) => b._count._all - a._count._all);
            const total = filteredTop.length;
            if (total === 0) {
                return res.json({
                    clients: [],
                    total: 0,
                    page: 1,
                    pageSize,
                    totalPages: 0,
                });
            }
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const page = Math.min(Math.max(requestedPage, 1), totalPages);
            const startIndex = (page - 1) * pageSize;
            const pageSlice = filteredTop.slice(startIndex, startIndex + pageSize);
            if (pageSlice.length === 0) {
                return res.json({
                    clients: [],
                    total,
                    page,
                    pageSize,
                    totalPages,
                });
            }
            const phones = pageSlice.map((t) => t.phoneNormalized);
            const [events, persons] = await Promise.all([
                prisma.viberRideEvent.findMany({
                    where: { phoneNormalized: { in: phones } },
                    orderBy: { departureDate: 'asc' },
                }),
                prisma.person.findMany({
                    where: { phoneNormalized: { in: phones } },
                    select: {
                        id: true,
                        phoneNormalized: true,
                        fullName: true,
                        telegramChatId: true,
                        telegramPromoSentAt: true,
                    },
                }),
            ]);
            // Мапимо id оголошення ViberListing → тип (водій/пасажир), щоб розрізняти ролі
            const listingIdsSet = new Set();
            for (const ev of events) {
                if (typeof ev.viberRideId === 'number') {
                    listingIdsSet.add(ev.viberRideId);
                }
            }
            const listingIds = Array.from(listingIdsSet);
            const listings = listingIds.length
                ? await prisma.viberListing.findMany({
                    where: { id: { in: listingIds } },
                    select: { id: true, listingType: true },
                })
                : [];
            const listingTypeById = new Map();
            for (const l of listings) {
                if (l && typeof l.id === 'number' && l.listingType) {
                    listingTypeById.set(l.id, l.listingType);
                }
            }
            const personByPhone = new Map();
            for (const p of persons) {
                personByPhone.set(p.phoneNormalized, p);
            }
            const eventsByPhone = new Map();
            for (const ev of events) {
                if (!ev.phoneNormalized)
                    continue;
                if (!eventsByPhone.has(ev.phoneNormalized)) {
                    eventsByPhone.set(ev.phoneNormalized, []);
                }
                eventsByPhone.get(ev.phoneNormalized).push(ev);
            }
            const clients = [];
            for (const phone of phones) {
                const evs = eventsByPhone.get(phone) ?? [];
                if (!evs.length)
                    continue;
                const totalRides = evs.length;
                const firstRideDate = (evs[0].departureDate ?? evs[0].createdAt);
                const lastRideDate = (evs[evs.length - 1].departureDate ?? evs[evs.length - 1].createdAt);
                // Статистика по маршрутах
                const routeCounts = new Map();
                for (const e of evs) {
                    const r = e.route || 'Unknown';
                    routeCounts.set(r, (routeCounts.get(r) ?? 0) + 1);
                }
                const routes = Array.from(routeCounts.entries())
                    .map(([route, count]) => ({ route, count, share: count / totalRides }))
                    .sort((a, b) => b.count - a.count);
                // Статистика по днях тижня
                const weekdayCounts = new Array(7).fill(0);
                for (const e of evs) {
                    const wd = typeof e.weekday === 'number'
                        ? e.weekday
                        : e.departureDate instanceof Date
                            ? e.departureDate.getDay()
                            : null;
                    if (wd != null && wd >= 0 && wd <= 6) {
                        weekdayCounts[wd]++;
                    }
                }
                const weekdayStats = weekdayCounts.map((count, weekday) => ({ weekday, count }));
                // Статистика по часу доби
                let morning = 0;
                let day = 0;
                let evening = 0;
                let night = 0;
                for (const e of evs) {
                    const h = typeof e.hour === 'number' ? e.hour : null;
                    if (h == null)
                        continue;
                    if (h >= 5 && h < 11)
                        morning++;
                    else if (h >= 11 && h < 17)
                        day++;
                    else if (h >= 17 && h < 23)
                        evening++;
                    else
                        night++;
                }
                const timeOfDayStats = { morning, day, evening, night };
                // Ролі: скільки оголошень як "driver" та "passenger"
                let driverTrips = 0;
                let passengerTrips = 0;
                for (const e of evs) {
                    const viberRideId = typeof e.viberRideId === 'number' ? e.viberRideId : null;
                    if (!viberRideId)
                        continue;
                    const lt = listingTypeById.get(viberRideId);
                    if (lt === 'driver')
                        driverTrips++;
                    else if (lt === 'passenger')
                        passengerTrips++;
                }
                let profileRole = 'mixed';
                if (driverTrips >= passengerTrips * 1.5 && driverTrips > 0) {
                    profileRole = 'driver';
                }
                else if (passengerTrips >= driverTrips * 1.5 && passengerTrips > 0) {
                    profileRole = 'passenger';
                }
                const mainRoute = routes[0];
                const person = personByPhone.get(phone) || null;
                const name = person?.fullName ?? null;
                const activeDays = (lastRideDate.getTime() - firstRideDate.getTime()) / (1000 * 60 * 60 * 24) || 1;
                const ridesPerWeek = (totalRides / (activeDays / 7)).toFixed(1);
                const weekdayWorkdays = weekdayCounts[1] + weekdayCounts[2] + weekdayCounts[3] + weekdayCounts[4] + weekdayCounts[5];
                const weekdayWeekend = weekdayCounts[0] + weekdayCounts[6];
                const tags = [];
                if (profileRole === 'driver') {
                    tags.push('часто виступає як водій');
                }
                else if (profileRole === 'passenger') {
                    tags.push('часті поїздки як пасажир');
                }
                else {
                    tags.push('активний як водій і пасажир');
                }
                if (mainRoute && mainRoute.route !== 'Unknown') {
                    tags.push(`часто їздить маршрутом ${mainRoute.route}`);
                }
                if (weekdayWorkdays > weekdayWeekend * 1.5) {
                    tags.push('переважно їздить у будні дні');
                }
                else if (weekdayWeekend > weekdayWorkdays * 1.5) {
                    tags.push('часті поїздки на вихідних');
                }
                if (evening > morning && evening > day && evening > night) {
                    tags.push('частіше їздить ввечері');
                }
                else if (morning > evening && morning > day && morning > night) {
                    tags.push('частіше їздить зранку');
                }
                const behaviorSummary = `${name ?? phone}: ${totalRides} поїздок за весь період (~${ridesPerWeek} на тиждень)` +
                    (tags.length ? `. Основні патерни: ${tags.join(', ')}.` : '.');
                let recommendations;
                if (profileRole === 'driver') {
                    recommendations = [
                        'Технічна: показувати цьому водію список пасажирів на його типових маршрутах і годинах.',
                        'Технічна: запропонувати автопідказку для повторного створення оголошень з тим самим маршрутом і часом.',
                        'Технічна: можна показувати персональні рекомендації щодо цін/завантаженості поїздок для водія.',
                    ];
                }
                else if (profileRole === 'passenger') {
                    recommendations = [
                        'Технічна: запропонувати автосповіщення про нових водіїв на його основних маршрутах і годинах.',
                        'Технічна: додати «швидке бронювання» на часті для нього напрямки (1–2 кліки).',
                        'Технічна: можна показувати персональні акції/знижки на популярні для нього поїздки.',
                    ];
                }
                else {
                    recommendations = [
                        'Технічна: для цього користувача поєднати сценарії водія та пасажира в один персональний блок.',
                        'Технічна: показувати йому як пасажирів, так і водіїв на його основних напрямках.',
                        'Технічна: у майбутньому дозволити швидко перемикатися між ролями «Я водій» / «Я пасажир» з урахуванням його історії.',
                    ];
                }
                const hasTelegramBot = !!(person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '');
                const promoFailedAt = person?.telegramPromoSentAt ? new Date(person.telegramPromoSentAt).getTime() : null;
                const communicationFailed = !hasTelegramBot && promoFailedAt !== null && promoFailedAt === new Date(0).getTime();
                clients.push({
                    phoneNormalized: phone,
                    fullName: name,
                    totalRides,
                    firstRideDate: firstRideDate.toISOString(),
                    lastRideDate: lastRideDate.toISOString(),
                    routes,
                    weekdayStats,
                    timeOfDayStats,
                    behaviorSummary,
                    recommendations,
                    hasTelegramBot,
                    communicationFailed,
                    profileRole,
                });
            }
            // Сортування: «Комунікація не вдалася» — внизу сторінки
            clients.sort((a, b) => (a.communicationFailed === b.communicationFailed ? 0 : a.communicationFailed ? 1 : -1));
            res.json({ clients, total, page, pageSize, totalPages });
        }
        catch (e) {
            console.error('❌ Помилка аналітики ViberRideEvent:', e);
            res.status(500).json({
                error: 'Не вдалося побудувати аналітику поведінки клієнтів за ViberRideEvent',
                details: e instanceof Error ? e.message : String(e),
            });
        }
    });
    /** Сценарії реклами для UI: ключ → лейбл і для якого профілю. */
    const PROMO_SCENARIO_KEYS = [
        'driver_passengers',
        'driver_autocreate',
        'passenger_notify',
        'passenger_quick',
        'mixed_unified',
        'mixed_both',
    ];
    app.get('/admin/viber-analytics/promo-scenarios', require_admin_1.requireAdmin, (_req, res) => {
        res.json({
            scenarios: PROMO_SCENARIO_KEYS.map((key) => ({
                key,
                label: telegram_1.BEHAVIOR_PROMO_SCENARIO_LABELS[key],
                profiles: telegram_1.BEHAVIOR_PROMO_SCENARIO_PROFILES[key],
            })),
            scenarioKeysByProfile: {
                driver: (0, index_helpers_1.getScenarioKeysForProfile)('driver'),
                passenger: (0, index_helpers_1.getScenarioKeysForProfile)('passenger'),
                mixed: (0, index_helpers_1.getScenarioKeysForProfile)('mixed'),
            },
        });
    });
    /**
     * Відправити персональну рекламу по клієнту з аналітики ViberRide.
     * Якщо є Telegram бот — через бота, інакше через особистий акаунт.
     * При невдалій комунікації (не знайдено в Telegram) проставляється маркер — кнопка стає неактивною.
     */
    app.post('/admin/viber-analytics/send-person-promo', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const { phoneNormalized: rawPhone, scenarioKey, mainRoute } = req.body;
            const phone = rawPhone ? (0, telegram_1.normalizePhone)(String(rawPhone).trim()) : '';
            if (!phone) {
                return res.status(400).json({ error: 'Потрібен phoneNormalized' });
            }
            if (!scenarioKey || !PROMO_SCENARIO_KEYS.includes(scenarioKey)) {
                return res.status(400).json({ error: 'Невірний scenarioKey' });
            }
            const key = scenarioKey;
            const person = await prisma.person.findFirst({
                where: { phoneNormalized: phone },
                select: { id: true, fullName: true, telegramChatId: true, telegramPromoSentAt: true, telegramUsername: true },
            });
            const context = {
                fullName: person?.fullName ?? null,
                mainRoute: typeof mainRoute === 'string' ? mainRoute.trim() || undefined : undefined,
            };
            if (person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '') {
                try {
                    await (0, telegram_1.sendBehaviorPromoMessage)(person.telegramChatId, key, context);
                    console.log(`📢 Behavior promo (bot) sent to ${phone}, scenario=${key}`);
                    return res.json({ success: true, sentVia: 'bot' });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const isChatNotFound = /chat not found|400 Bad Request|bad request: chat/i.test(msg) ||
                        (msg.includes('400') && msg.toLowerCase().includes('chat'));
                    if (isChatNotFound && person?.id) {
                        await prisma.person.update({
                            where: { id: person.id },
                            data: { telegramChatId: null, telegramUserId: null },
                        });
                        console.log(`ℹ️ send-person-promo: chat not found для ${phone}, прив'язку Telegram скинуто, пробуємо особистий акаунт`);
                    }
                    else {
                        console.error('❌ send-person-promo (bot):', err);
                        return res.status(500).json({ success: false, sentVia: 'bot', error: msg });
                    }
                }
            }
            const htmlMessage = (0, telegram_1.buildBehaviorPromoMessage)(key, context);
            const plainMessage = htmlMessage
                .replace(/<b>/g, '')
                .replace(/<\/b>/g, '')
                .replace(/<i>/g, '')
                .replace(/<\/i>/g, '')
                .replace(/<a href="([^"]+)">[^<]*<\/a>/g, '$1')
                .replace(/<[^>]+>/g, '')
                .trim();
            const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, plainMessage, {
                telegramUsername: person?.telegramUsername ?? undefined,
            });
            if (ok) {
                await prisma.person.updateMany({
                    where: { phoneNormalized: phone },
                    data: { telegramPromoSentAt: new Date() },
                });
                console.log(`📢 Behavior promo (user) sent to ${phone}, scenario=${key}`);
                return res.json({ success: true, sentVia: 'user' });
            }
            await prisma.person.updateMany({
                where: { phoneNormalized: phone },
                data: { telegramPromoSentAt: index_helpers_1.PROMO_NOT_FOUND_SENTINEL },
            });
            return res.json({
                success: false,
                sentVia: 'user',
                error: 'Не знайдено в Telegram; кнопки реклами для цього контакту будуть неактивні.',
            });
        }
        catch (e) {
            console.error('❌ send-person-promo:', e);
            res.status(500).json({
                error: e instanceof Error ? e.message : 'Помилка відправки реклами',
            });
        }
    });
    // Глобальний обробник помилок — завжди повертаємо JSON
    app.use((err, _req, res, _next) => {
        console.error('❌ Unhandled error:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    });
    return app;
}
/** Список зареєстрованих роутів для логів (Express 4) */
function getRegisteredRoutes(app) {
    const routes = [];
    try {
        const router = app._router;
        const stack = router?.stack ?? [];
        function walk(layer, prefix = '') {
            if (!layer)
                return;
            const path = (prefix + (layer.route?.path ?? layer.path ?? '')).replace(/\/\//g, '/') || '/';
            if (layer.route) {
                const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
                methods.forEach((m) => routes.push(`${m.toUpperCase()} ${path}`));
            }
            if (layer.name === 'router' && layer.handle?.stack) {
                layer.handle.stack.forEach((l) => walk(l, path));
            }
        }
        stack.forEach((layer) => walk(layer));
    }
    catch (e) {
        console.warn('[KYIV-MALYN-BACKEND] Could not list routes:', e);
    }
    return [...new Set(routes)].sort();
}
var support_phone_route_1 = require("./support-phone-route");
Object.defineProperty(exports, "getSupportPhoneForRoute", { enumerable: true, get: function () { return support_phone_route_1.getSupportPhoneForRoute; } });
