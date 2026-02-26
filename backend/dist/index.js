"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportPhoneForRoute = getSupportPhoneForRoute;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const telegram_1 = require("./telegram");
const crypto_1 = __importDefault(require("crypto"));
const viber_parser_1 = require("./viber-parser");
// Маркер версії коду — змінити при оновленні, щоб у логах Railway було видно новий деплой
const CODE_VERSION = 'viber-v2-2026';
// Лог при завантаженні модуля — якщо це є в Deploy Logs, деплой новий
console.log('[KYIV-MALYN-BACKEND] BOOT codeVersion=' + CODE_VERSION + ' build=' + (typeof __dirname !== 'undefined' ? 'node' : 'unknown'));
// Сесія для одноразового промо: якщо TELEGRAM_USER_SESSION_PATH не задано — шукаємо файл у репо (telegram-user/session_telegram_user.session)
if (!process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim()) {
    const defaultSessionPath = path_1.default.join(process.cwd(), 'telegram-user', 'session_telegram_user');
    const defaultSessionFile = defaultSessionPath + '.session';
    if (fs_1.default.existsSync(defaultSessionFile)) {
        process.env.TELEGRAM_USER_SESSION_PATH = defaultSessionPath;
        console.log('[KYIV-MALYN-BACKEND] Telegram user session loaded from repo file telegram-user/session_telegram_user.session');
    }
}
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
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
// Простий токен для авторизації (в продакшені використовуйте JWT)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = 'admin-authenticated';
// Middleware для перевірки авторизації адміна
const requireAdmin = (req, res, next) => {
    const token = req.headers.authorization;
    if (token === ADMIN_TOKEN) {
        next();
    }
    else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};
app.get('/health', (_req, res) => {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
    });
    res.json({
        status: 'ok',
        version: 3,
        viber: true,
        codeVersion: CODE_VERSION,
        deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
        cwd: process.cwd(),
    });
});
app.get('/status', (_req, res) => {
    res.json({
        status: 'ok',
        version: 3,
        viber: true,
        codeVersion: CODE_VERSION,
        deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
        cwd: process.cwd(),
    });
});
// Endpoint для виправлення telegramUserId в існуючих бронюваннях
app.post('/admin/fix-telegram-ids', requireAdmin, async (_req, res) => {
    try {
        console.log('🔧 Початок виправлення telegramUserId...');
        // 1. Знаходимо всі бронювання де є chatId але немає валідного userId
        const problematicBookings = await prisma.booking.findMany({
            where: {
                telegramChatId: { not: null },
                OR: [
                    { telegramUserId: null },
                    { telegramUserId: '0' },
                    { telegramUserId: '' }
                ]
            }
        });
        console.log(`📋 Знайдено ${problematicBookings.length} бронювань з невалідним telegramUserId`);
        if (problematicBookings.length === 0) {
            return res.json({
                success: true,
                message: 'Всі записи вже правильні!',
                fixed: 0,
                skipped: 0,
                total: 0
            });
        }
        // 2. Виправляємо кожне бронювання
        let fixed = 0;
        let skipped = 0;
        const details = [];
        for (const booking of problematicBookings) {
            if (booking.telegramChatId &&
                booking.telegramChatId !== '0' &&
                booking.telegramChatId.trim() !== '') {
                // Для приватних чатів chat_id = user_id
                await prisma.booking.update({
                    where: { id: booking.id },
                    data: {
                        telegramUserId: booking.telegramChatId
                    }
                });
                const msg = `✅ #${booking.id}: telegramUserId оновлено з '${booking.telegramUserId}' на '${booking.telegramChatId}'`;
                console.log(msg);
                details.push(msg);
                fixed++;
            }
            else {
                const msg = `⚠️ #${booking.id}: пропущено (невалідний chatId: '${booking.telegramChatId}')`;
                console.log(msg);
                details.push(msg);
                skipped++;
            }
        }
        console.log(`📊 Виправлено: ${fixed}, Пропущено: ${skipped}, Всього: ${problematicBookings.length}`);
        res.json({
            success: true,
            message: 'Виправлення завершено!',
            fixed,
            skipped,
            total: problematicBookings.length,
            details
        });
    }
    catch (error) {
        console.error('❌ Помилка виправлення:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Авторизація адміна
app.post('/admin/login', async (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ token: ADMIN_TOKEN, success: true });
    }
    else {
        res.status(401).json({ error: 'Невірний пароль' });
    }
});
// Перевірка авторизації
app.get('/admin/check', requireAdmin, (_req, res) => {
    res.json({ authenticated: true });
});
// Schedule CRUD endpoints
app.get('/schedules', async (req, res) => {
    const { route } = req.query;
    const where = route ? { route: route } : {};
    const schedules = await prisma.schedule.findMany({
        where,
        orderBy: [{ route: 'asc' }, { departureTime: 'asc' }]
    });
    res.json(schedules);
});
app.get('/schedules/:route', async (req, res) => {
    const { route } = req.params;
    const schedules = await prisma.schedule.findMany({
        where: { route },
        orderBy: { departureTime: 'asc' }
    });
    res.json(schedules);
});
// Телефон підтримки для уточнення бронювання (з графіка; для напрямків з Києвом)
app.get('/schedules-support-phone', async (_req, res) => {
    try {
        const schedule = await prisma.schedule.findFirst({
            where: { supportPhone: { not: null } },
            select: { supportPhone: true }
        });
        res.json({ supportPhone: schedule?.supportPhone ?? null });
    }
    catch (error) {
        res.status(500).json({ supportPhone: null });
    }
});
// Перевірка доступності місць для конкретного рейсу та дати
app.get('/schedules/:route/:departureTime/availability', async (req, res) => {
    const { route, departureTime } = req.params;
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'Date parameter is required' });
    }
    try {
        // Знаходимо графік
        const schedule = await prisma.schedule.findUnique({
            where: {
                route_departureTime: {
                    route,
                    departureTime
                }
            }
        });
        if (!schedule) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        // Підраховуємо зайняті місця для цієї дати та часу
        const bookingDate = new Date(date);
        const startOfDay = new Date(bookingDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(bookingDate);
        endOfDay.setHours(23, 59, 59, 999);
        const bookings = await prisma.booking.findMany({
            where: {
                route,
                departureTime,
                date: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });
        const bookedSeats = bookings.reduce((sum, booking) => sum + booking.seats, 0);
        const availableSeats = schedule.maxSeats - bookedSeats;
        res.json({
            scheduleId: schedule.id,
            maxSeats: schedule.maxSeats,
            bookedSeats,
            availableSeats,
            isAvailable: availableSeats > 0
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to check availability' });
    }
});
/** Телефон підтримки для маршруту з графіка (формат +380(93)1701835) */
async function getSupportPhoneForRoute(route) {
    const schedule = await prisma.schedule.findFirst({
        where: { route, supportPhone: { not: null } },
        select: { supportPhone: true }
    });
    return schedule?.supportPhone ?? null;
}
app.post('/schedules', requireAdmin, async (req, res) => {
    const { route, departureTime, maxSeats, supportPhone } = req.body;
    if (!route || !departureTime) {
        return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
    }
    // Валідація формату часу (HH:MM)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(departureTime)) {
        return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
    }
    try {
        const schedule = await prisma.schedule.create({
            data: {
                route,
                departureTime,
                maxSeats: maxSeats ? Number(maxSeats) : 20,
                supportPhone: supportPhone != null && String(supportPhone).trim() !== '' ? String(supportPhone).trim() : null
            }
        });
        res.status(201).json(schedule);
    }
    catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Schedule with this route and time already exists' });
        }
        res.status(500).json({ error: 'Failed to create schedule' });
    }
});
app.put('/schedules/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { route, departureTime, maxSeats, supportPhone } = req.body;
    if (!route || !departureTime) {
        return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
    }
    // Валідація формату часу
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(departureTime)) {
        return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
    }
    try {
        const schedule = await prisma.schedule.update({
            where: { id: Number(id) },
            data: {
                route,
                departureTime,
                maxSeats: maxSeats ? Number(maxSeats) : undefined,
                supportPhone: supportPhone !== undefined ? (supportPhone != null && String(supportPhone).trim() !== '' ? String(supportPhone).trim() : null) : undefined
            }
        });
        res.json(schedule);
    }
    catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Schedule with this route and time already exists' });
        }
        res.status(500).json({ error: 'Failed to update schedule' });
    }
});
app.delete('/schedules/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.schedule.delete({
            where: { id: Number(id) }
        });
        res.status(204).send();
    }
    catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});
// Booking endpoints
app.post('/bookings', async (req, res) => {
    const { route, date, departureTime, seats, name, phone, scheduleId, telegramUserId } = req.body;
    if (!route || !date || !departureTime || !seats || !name || !phone) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // Валідація формату часу
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(departureTime)) {
        return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
    }
    // Перевірка доступності місць
    try {
        const schedule = await prisma.schedule.findUnique({
            where: {
                route_departureTime: {
                    route,
                    departureTime
                }
            }
        });
        if (schedule) {
            const bookingDate = new Date(date);
            const startOfDay = new Date(bookingDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(bookingDate);
            endOfDay.setHours(23, 59, 59, 999);
            const existingBookings = await prisma.booking.findMany({
                where: {
                    route,
                    departureTime,
                    date: {
                        gte: startOfDay,
                        lte: endOfDay
                    }
                }
            });
            const bookedSeats = existingBookings.reduce((sum, booking) => sum + booking.seats, 0);
            const requestedSeats = Number(seats);
            const availableSeats = schedule.maxSeats - bookedSeats;
            if (requestedSeats > availableSeats) {
                return res.status(400).json({
                    error: `Недостатньо місць. Доступно: ${availableSeats}, запитується: ${requestedSeats}`
                });
            }
        }
    }
    catch (error) {
        // Якщо графік не знайдено, все одно дозволяємо бронювання
    }
    // Прив'язка до Person та пошук Telegram: спочатку Person, потім попередні бронювання
    let telegramChatId = null;
    let bookingTelegramUserId = telegramUserId || null;
    const fullNameForPerson = typeof name === 'string' && name.trim() ? name.trim() : name;
    const person = await (0, telegram_1.findOrCreatePersonByPhone)(phone, { fullName: fullNameForPerson });
    // Оновлюємо ім'я в усіх попередніх бронюваннях та в Viber оголошеннях цієї персони
    if (fullNameForPerson) {
        try {
            const [bookingsUpdated, viberUpdated] = await Promise.all([
                prisma.booking.updateMany({
                    where: { personId: person.id },
                    data: { name: fullNameForPerson },
                }),
                prisma.viberListing.updateMany({
                    where: { personId: person.id },
                    data: { senderName: fullNameForPerson },
                }),
            ]);
            if (bookingsUpdated.count > 0 || viberUpdated.count > 0) {
                console.log(`📝 Оновлено ім'я персони: booking.count=${bookingsUpdated.count}, viberListing.count=${viberUpdated.count}`);
            }
        }
        catch (err) {
            console.error('Помилка оновлення імені в бронюваннях/Viber:', err);
            // Не блокуємо створення бронювання
        }
    }
    try {
        const normalizedPhone = (0, telegram_1.normalizePhone)(phone);
        const personRecord = await (0, telegram_1.getPersonByPhone)(phone);
        if (personRecord?.telegramChatId && personRecord.telegramChatId !== '0' && personRecord.telegramChatId.trim() !== '') {
            telegramChatId = personRecord.telegramChatId;
        }
        if (personRecord?.telegramUserId && personRecord.telegramUserId !== '0' && personRecord.telegramUserId.trim() !== '') {
            bookingTelegramUserId = bookingTelegramUserId || personRecord.telegramUserId;
        }
        if (!telegramChatId || !bookingTelegramUserId) {
            const allBookings = await prisma.booking.findMany({
                where: {
                    telegramUserId: { not: null, notIn: ['0', '', ' '] },
                },
                orderBy: { createdAt: 'desc' },
            });
            const previousBooking = allBookings.find((b) => (0, telegram_1.normalizePhone)(b.phone) === normalizedPhone);
            if (previousBooking) {
                if (previousBooking.telegramChatId && previousBooking.telegramChatId !== '0' && previousBooking.telegramChatId.trim() !== '') {
                    telegramChatId = telegramChatId || previousBooking.telegramChatId;
                }
                if (!bookingTelegramUserId && previousBooking.telegramUserId && previousBooking.telegramUserId !== '0' && previousBooking.telegramUserId.trim() !== '') {
                    bookingTelegramUserId = previousBooking.telegramUserId;
                }
                else if (!bookingTelegramUserId && previousBooking.telegramChatId) {
                    bookingTelegramUserId = previousBooking.telegramChatId;
                }
            }
        }
        console.log(`🔍 Person id=${person.id}, Telegram: chatId=${telegramChatId}, userId=${bookingTelegramUserId}`);
    }
    catch (error) {
        console.error('❌ Помилка пошуку Person/попередніх бронювань:', error);
    }
    // Фінальна валідація: для приватних чатів chat_id = user_id
    // Якщо є chatId але немає userId - використовуємо chatId як userId
    if (telegramChatId &&
        telegramChatId !== '0' &&
        telegramChatId.trim() !== '' &&
        !bookingTelegramUserId) {
        bookingTelegramUserId = telegramChatId;
        console.log(`⚠️ Використовуємо telegramChatId як telegramUserId для приватного чату: ${bookingTelegramUserId}`);
    }
    // Додаткова валідація перед записом
    if (telegramChatId === '0' || telegramChatId === '') {
        console.log(`⚠️ Невалідний telegramChatId (${telegramChatId}), встановлюємо null`);
        telegramChatId = null;
    }
    if (bookingTelegramUserId === '0' || bookingTelegramUserId === '') {
        console.log(`⚠️ Невалідний telegramUserId (${bookingTelegramUserId}), встановлюємо null`);
        bookingTelegramUserId = null;
    }
    console.log(`📝 Створюємо бронювання з Telegram даними:`, {
        chatId: telegramChatId,
        userId: bookingTelegramUserId,
        phone: phone
    });
    const booking = await prisma.booking.create({
        data: {
            route,
            date: new Date(date),
            departureTime,
            seats: Number(seats),
            name,
            phone,
            scheduleId: scheduleId ? Number(scheduleId) : null,
            telegramChatId,
            telegramUserId: bookingTelegramUserId,
            personId: person.id,
        },
    });
    // Відправка повідомлень в Telegram (якщо налаштовано)
    if ((0, telegram_1.isTelegramEnabled)()) {
        try {
            // Повідомлення адміну (тільки для маршруток; source за замовч. "schedule")
            await (0, telegram_1.sendBookingNotificationToAdmin)({
                id: booking.id,
                route: booking.route,
                date: booking.date,
                departureTime: booking.departureTime,
                seats: booking.seats,
                name: booking.name,
                phone: booking.phone,
                source: booking.source,
            });
            // Повідомлення клієнту (якщо він підписаний; тільки для маршруток). Телефон підтримки — з графіка для цього маршруту.
            const customerChatId = await (0, telegram_1.getChatIdByPhone)(booking.phone);
            if (customerChatId) {
                const supportPhone = await getSupportPhoneForRoute(booking.route);
                await (0, telegram_1.sendBookingConfirmationToCustomer)(customerChatId, {
                    id: booking.id,
                    route: booking.route,
                    date: booking.date,
                    departureTime: booking.departureTime,
                    seats: booking.seats,
                    name: booking.name,
                    source: booking.source,
                    supportPhone: supportPhone ?? undefined,
                });
            }
        }
        catch (error) {
            console.error('Помилка відправки Telegram повідомлення:', error);
            // Не блокуємо бронювання якщо Telegram не працює
        }
    }
    res.status(201).json(booking);
});
app.get('/bookings', requireAdmin, async (_req, res) => {
    res.json(await prisma.booking.findMany({ orderBy: { createdAt: 'desc' } }));
});
// Пошук останнього бронювання або персони по телефону (для автозаповнення імені на сторінці бронювання)
app.get('/bookings/by-phone/:phone', async (req, res) => {
    const { phone } = req.params;
    try {
        const normalized = (0, telegram_1.normalizePhone)(phone);
        // 1) Шукаємо Person за телефоном
        const person = await (0, telegram_1.getPersonByPhone)(phone);
        if (person) {
            const byPerson = await prisma.booking.findFirst({
                where: { personId: person.id },
                orderBy: { createdAt: 'desc' },
            });
            if (byPerson) {
                return res.json(byPerson);
            }
            // Персона є, але бронювань немає — повертаємо ім'я з Person для автозаповнення
            if (person.fullName && person.fullName.trim()) {
                return res.json({ name: person.fullName.trim(), phone: person.phoneNormalized });
            }
        }
        // 2) Шукаємо в таблиці Booking по нормалізованому телефону
        const allRecent = await prisma.booking.findMany({
            orderBy: { createdAt: 'desc' },
            take: 500,
        });
        const lastBooking = allRecent.find((b) => (0, telegram_1.normalizePhone)(b.phone) === normalized) ?? null;
        res.json(lastBooking);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to find booking' });
    }
});
// Скасування бронювання користувачем (через Telegram)
app.delete('/bookings/:id/by-user', async (req, res) => {
    const { id } = req.params;
    const { telegramUserId } = req.body;
    if (!telegramUserId) {
        return res.status(400).json({ error: 'telegramUserId is required' });
    }
    try {
        // Перевірка що бронювання належить користувачу
        const booking = await prisma.booking.findUnique({
            where: { id: Number(id) }
        });
        if (!booking) {
            return res.status(404).json({ error: 'Бронювання не знайдено' });
        }
        if (booking.telegramUserId !== telegramUserId) {
            return res.status(403).json({ error: 'Це не ваше бронювання' });
        }
        // Видалити бронювання
        await prisma.booking.delete({
            where: { id: Number(id) }
        });
        console.log(`✅ Користувач ${telegramUserId} скасував бронювання #${id}`);
        res.json({
            success: true,
            message: 'Бронювання скасовано',
            booking: {
                id: booking.id,
                route: booking.route,
                date: booking.date,
                departureTime: booking.departureTime
            }
        });
    }
    catch (error) {
        console.error('❌ Помилка скасування бронювання:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.status(500).json({ error: 'Failed to cancel booking' });
    }
});
app.delete('/bookings/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.booking.delete({
            where: { id: Number(id) }
        });
        res.status(204).send();
    }
    catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.status(500).json({ error: 'Failed to delete booking' });
    }
});
// Відправка нагадувань про поїздки на завтра (admin endpoint)
app.post('/telegram/send-reminders', requireAdmin, async (_req, res) => {
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
// Нагадування в день поїздки (сьогодні) — для cron щодня вранці
app.post('/telegram/send-reminders-today', requireAdmin, async (_req, res) => {
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
app.get('/telegram/status', requireAdmin, (_req, res) => {
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
/** Маппінг "звідки–куди" (сайт) → route (бот). Значення: malyn, kyiv, zhytomyr, korosten */
function mapFromToToRoute(from, to) {
    const f = (from || '').toLowerCase().trim();
    const t = (to || '').toLowerCase().trim();
    if (f === 'kyiv' && t === 'malyn')
        return 'Kyiv-Malyn';
    if (f === 'malyn' && t === 'kyiv')
        return 'Malyn-Kyiv';
    if (f === 'zhytomyr' && t === 'malyn')
        return 'Zhytomyr-Malyn';
    if (f === 'malyn' && t === 'zhytomyr')
        return 'Malyn-Zhytomyr';
    if (f === 'korosten' && t === 'malyn')
        return 'Korosten-Malyn';
    if (f === 'malyn' && t === 'korosten')
        return 'Malyn-Korosten';
    return null;
}
// Чернетка оголошення з сайту poputky: зберігає маршрут/дату/час/примітки, повертає посилання на бота з токеном
app.post('/poputky/announce-draft', express_1.default.json(), (req, res) => {
    const { role, from, to, date, time, notes, priceUah } = req.body;
    let priceUahParsed;
    if (priceUah !== undefined) {
        const num = Number(priceUah);
        if (!Number.isFinite(num) || num < 0) {
            return res.status(400).json({ error: "Ціна має бути невід'ємним числом" });
        }
        priceUahParsed = Math.round(num);
    }
    if (!role || (role !== 'driver' && role !== 'passenger')) {
        return res.status(400).json({ error: 'role має бути driver або passenger' });
    }
    const route = mapFromToToRoute(from ?? '', to ?? '');
    if (!route) {
        return res.status(400).json({ error: 'Поїздки можуть бути лише з/до Малина. Оберіть звідки та куди (наприклад Малин ↔ Київ).' });
    }
    const dateStr = (date || '').toString().trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ error: 'Вкажіть коректну дату поїздки' });
    }
    const departureTime = (time || '').toString().trim() || null;
    if (departureTime) {
        const singleTime = /^\d{1,2}:\d{2}$/;
        const timeRange = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
        if (!singleTime.test(departureTime) && !timeRange.test(departureTime)) {
            return res.status(400).json({ error: 'Час: HH:MM або HH:MM-HH:MM (інтервал)' });
        }
    }
    const token = crypto_1.default.randomBytes(8).toString('hex');
    (0, telegram_1.setAnnounceDraft)(token, { role: role, route, date: dateStr, departureTime: departureTime || undefined, notes: (notes || '').trim() || undefined, priceUah: priceUahParsed ?? undefined });
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';
    const deepLink = `https://t.me/${botUsername}?start=${role}_${token}`;
    return res.json({ token, deepLink });
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
// Допоміжна функція: серіалізація Viber listing для JSON (дати в ISO рядок)
function serializeViberListing(row) {
    return {
        ...row,
        date: row.date instanceof Date ? row.date.toISOString() : row.date,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
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
        res.json(listings.map(serializeViberListing));
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
        res.json(listings.map(serializeViberListing));
    }
    catch (error) {
        console.error('❌ Помилка пошуку Viber оголошень:', error);
        res.status(500).json({ error: 'Не вдалося пошукати Viber оголошення.' });
    }
});
// Створити Viber оголошення (Admin)
app.post('/viber-listings', requireAdmin, async (req, res) => {
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
        if ((0, telegram_1.isTelegramEnabled)()) {
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
            // Сповістити про збіги водій/пасажир — як при додаванні через бота
            const authorChatId = listing.phone?.trim() ? await (0, telegram_1.getChatIdByPhone)(listing.phone) : null;
            if (listing.listingType === 'driver') {
                (0, telegram_1.notifyMatchingPassengersForNewDriver)(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
            }
            else if (listing.listingType === 'passenger') {
                (0, telegram_1.notifyMatchingDriversForNewPassenger)(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
            }
        }
        res.status(201).json(serializeViberListing(listing));
    }
    catch (error) {
        console.error('❌ Помилка створення Viber оголошення:', error);
        res.status(500).json({ error: 'Failed to create Viber listing' });
    }
});
// Масове створення Viber оголошень з копіювання чату (Admin)
app.post('/viber-listings/bulk', requireAdmin, async (req, res) => {
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
                if ((0, telegram_1.isTelegramEnabled)()) {
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
                    // Сповістити про збіги водій/пасажир (як при додаванні через бота)
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
            listings: created
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
app.put('/viber-listings/:id', requireAdmin, async (req, res) => {
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
        res.json(serializeViberListing(listing));
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
app.patch('/viber-listings/:id/deactivate', requireAdmin, async (req, res) => {
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
app.delete('/viber-listings/:id', requireAdmin, async (req, res) => {
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
// Автоматичне деактивування старих оголошень (можна викликати з cron)
app.post('/viber-listings/cleanup-old', requireAdmin, async (_req, res) => {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(23, 59, 59, 999);
        const result = await prisma.viberListing.updateMany({
            where: {
                date: { lt: yesterday },
                isActive: true
            },
            data: { isActive: false }
        });
        console.log(`🧹 Деактивовано ${result.count} старих Viber оголошень`);
        res.json({
            success: true,
            deactivated: result.count,
            message: `Деактивовано ${result.count} оголошень`
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
app.post('/admin/person', requireAdmin, async (req, res) => {
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
app.get('/admin/persons', requireAdmin, async (req, res) => {
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
/** Одна персона за id. */
app.get('/admin/persons/:id', requireAdmin, async (req, res) => {
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
app.put('/admin/persons/:id', requireAdmin, async (req, res) => {
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
/** База нагадувань — тільки персони з Telegram ботом (мають telegramChatId). filter: all = всі, no_active_viber = без активних Viber оголошень. */
const hasTelegramReminderBaseCondition = {
    telegramChatId: {
        not: null,
    },
    NOT: [{ telegramChatId: '' }, { telegramChatId: '0' }],
};
const TELEGRAM_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 днів
function getTelegramReminderWhere(filter) {
    if (filter === 'no_active_viber') {
        return {
            ...hasTelegramReminderBaseCondition,
            viberListings: {
                none: {
                    isActive: true,
                },
            },
        };
    }
    if (filter === 'no_reminder_7_days') {
        const sevenDaysAgo = new Date(Date.now() - TELEGRAM_REMINDER_COOLDOWN_MS);
        return {
            ...hasTelegramReminderBaseCondition,
            OR: [
                { telegramReminderSentAt: null },
                { telegramReminderSentAt: { lt: sevenDaysAgo } },
            ],
        };
    }
    return hasTelegramReminderBaseCondition;
}
/** Список Person для Telegram-нагадувань (база = з ботом). Query: ?filter=all|no_active_viber|no_reminder_7_days */
app.get('/admin/telegram-reminder-persons', requireAdmin, async (req, res) => {
    try {
        const filter = req.query.filter?.trim() || 'all';
        const where = getTelegramReminderWhere(filter);
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
/** Відправити Telegram-нагадування неактивним користувачам. Body: { filter?, limit?, delaysMs? } */
app.post('/admin/send-telegram-reminders', requireAdmin, async (req, res) => {
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
        const where = getTelegramReminderWhere(filter);
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
app.post('/admin/send-reminder-via-user-account', requireAdmin, async (req, res) => {
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
                const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, message);
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
/** База реклами — завжди тільки персони без Telegram бота. filter: no_telegram = всі з бази, no_communication = з бази тільки ті, до кого ще не комунікували. */
const noTelegramCondition = {
    OR: [
        { telegramChatId: null },
        { telegramChatId: '' },
        { telegramChatId: '0' },
    ],
};
/** Мінімальна дата-маркер: пробували відправити промо, але номер не знайдено в Telegram. Для подальшої фільтрації. */
const PROMO_NOT_FOUND_SENTINEL = new Date(0);
function getChannelPromoWhere(filter) {
    if (filter === 'no_communication') {
        return { ...noTelegramCondition, telegramPromoSentAt: null };
    }
    if (filter === 'promo_not_found') {
        return { ...noTelegramCondition, telegramPromoSentAt: PROMO_NOT_FOUND_SENTINEL };
    }
    return noTelegramCondition;
}
/** Список Person для реклами каналу (база = без бота). Query: ?filter=no_telegram|no_communication|promo_not_found */
app.get('/admin/channel-promo-persons', requireAdmin, async (req, res) => {
    try {
        const filter = req.query.filter?.trim() || 'no_telegram';
        const where = getChannelPromoWhere(filter);
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
app.post('/admin/send-channel-promo', requireAdmin, async (req, res) => {
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
        const where = getChannelPromoWhere(filter);
        let persons = await prisma.person.findMany({
            where,
            select: { id: true, phoneNormalized: true, fullName: true },
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
            const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, message);
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
                    data: { telegramPromoSentAt: PROMO_NOT_FOUND_SENTINEL },
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
// Глобальний обробник помилок — завжди повертаємо JSON
app.use((err, _req, res, _next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({ error: 'Помилка сервера' });
});
const PORT = process.env.PORT || 3000;
// Збираємо список зареєстрованих роутів для логів (Express 4)
function getRegisteredRoutes() {
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
app.listen(PORT, () => {
    const routes = getRegisteredRoutes();
    const hasViber = routes.some((r) => r.includes('viber-listings'));
    console.log('========================================');
    console.log(`[KYIV-MALYN-BACKEND] CODE_VERSION=${CODE_VERSION}`);
    console.log(`[KYIV-MALYN-BACKEND] cwd=${process.cwd()}`);
    console.log(`[KYIV-MALYN-BACKEND] RAILWAY_DEPLOYMENT_ID=${process.env.RAILWAY_DEPLOYMENT_ID ?? 'not set'}`);
    console.log(`[KYIV-MALYN-BACKEND] /viber-listings registered: ${hasViber ? 'YES' : 'NO'}`);
    console.log('[KYIV-MALYN-BACKEND] Routes:', routes.filter((r) => r.startsWith('GET ') || r.startsWith('POST ')).slice(0, 25).join(', '));
    if (!hasViber)
        console.warn('[KYIV-MALYN-BACKEND] WARNING: Viber routes missing — likely old build/cache');
    console.log('========================================');
    console.log(`API on http://localhost:${PORT} [${CODE_VERSION}]`);
});
