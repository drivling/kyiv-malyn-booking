"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const telegram_1 = require("./telegram");
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
app.use((0, cors_1.default)());
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
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
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
app.post('/schedules', requireAdmin, async (req, res) => {
    const { route, departureTime, maxSeats } = req.body;
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
                maxSeats: maxSeats ? Number(maxSeats) : 20
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
    const { route, departureTime, maxSeats } = req.body;
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
                maxSeats: maxSeats ? Number(maxSeats) : undefined
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
    // Шукаємо попередні бронювання з цим номером телефону
    // Якщо користувач вже підписувався - автоматично копіюємо його Telegram дані
    let telegramChatId = null;
    let bookingTelegramUserId = telegramUserId || null; // Використовуємо переданий з frontend
    try {
        const normalizedPhone = (0, telegram_1.normalizePhone)(phone);
        // Отримуємо всі бронювання і шукаємо по нормалізованому номеру
        const allBookings = await prisma.booking.findMany({
            where: {
                telegramUserId: { not: null } // Тільки ті що мають Telegram прив'язку
            },
            orderBy: { createdAt: 'desc' }
        });
        // Шукаємо бронювання з таким же нормалізованим номером
        const previousBooking = allBookings.find(b => (0, telegram_1.normalizePhone)(b.phone) === normalizedPhone);
        if (previousBooking) {
            telegramChatId = previousBooking.telegramChatId;
            // Якщо не було передано з frontend - беремо з попереднього бронювання
            if (!bookingTelegramUserId) {
                bookingTelegramUserId = previousBooking.telegramUserId;
            }
            console.log(`✅ Знайдено попереднє бронювання для ${phone}, копіюємо Telegram дані (userId: ${bookingTelegramUserId})`);
        }
        else if (bookingTelegramUserId) {
            // Якщо це перше бронювання але є telegramUserId з frontend
            console.log(`✅ Перше бронювання для ${phone} з Telegram Login (userId: ${bookingTelegramUserId})`);
        }
    }
    catch (error) {
        console.error('❌ Помилка пошуку попередніх бронювань:', error);
        // Продовжуємо з тим що є
    }
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
            telegramUserId: bookingTelegramUserId
        }
    });
    // Відправка повідомлень в Telegram (якщо налаштовано)
    if ((0, telegram_1.isTelegramEnabled)()) {
        try {
            // Повідомлення адміну
            await (0, telegram_1.sendBookingNotificationToAdmin)({
                id: booking.id,
                route: booking.route,
                date: booking.date,
                departureTime: booking.departureTime,
                seats: booking.seats,
                name: booking.name,
                phone: booking.phone,
            });
            // Повідомлення клієнту (якщо він підписаний)
            const customerChatId = await (0, telegram_1.getChatIdByPhone)(booking.phone);
            if (customerChatId) {
                await (0, telegram_1.sendBookingConfirmationToCustomer)(customerChatId, {
                    id: booking.id,
                    route: booking.route,
                    date: booking.date,
                    departureTime: booking.departureTime,
                    seats: booking.seats,
                    name: booking.name,
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
// Пошук останнього бронювання по телефону
app.get('/bookings/by-phone/:phone', async (req, res) => {
    const { phone } = req.params;
    try {
        const lastBooking = await prisma.booking.findFirst({
            where: { phone },
            orderBy: { createdAt: 'desc' },
        });
        res.json(lastBooking || null);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to find booking' });
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
            }
        });
        let sent = 0;
        let failed = 0;
        for (const booking of bookings) {
            if (booking.telegramChatId) {
                try {
                    await (0, telegram_1.sendTripReminder)(booking.telegramChatId, {
                        route: booking.route,
                        date: booking.date,
                        departureTime: booking.departureTime,
                        name: booking.name
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
// Тестовий endpoint для перевірки Telegram підключення
app.get('/telegram/status', requireAdmin, (_req, res) => {
    res.json({
        enabled: (0, telegram_1.isTelegramEnabled)(),
        adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ? 'configured' : 'not configured',
        botToken: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'
    });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
