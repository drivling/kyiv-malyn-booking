"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSchedulesBookingsRouter = createSchedulesBookingsRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const support_phone_route_1 = require("../support-phone-route");
const schedule_departure_time_1 = require("../validation/schedule-departure-time");
const booking_phone_1 = require("../validation/booking-phone");
const require_admin_1 = require("../middleware/require-admin");
function createSchedulesBookingsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.get('/schedules', async (req, res) => {
        const { route } = req.query;
        const where = route ? { route: route } : {};
        const schedules = await prisma.schedule.findMany({
            where,
            orderBy: [{ route: 'asc' }, { departureTime: 'asc' }],
        });
        res.json(schedules);
    });
    r.get('/schedules/:route', async (req, res) => {
        const { route } = req.params;
        const schedules = await prisma.schedule.findMany({
            where: { route },
            orderBy: { departureTime: 'asc' },
        });
        res.json(schedules);
    });
    r.get('/schedules-support-phone', async (_req, res) => {
        try {
            const schedule = await prisma.schedule.findFirst({
                where: { supportPhone: { not: null } },
                select: { supportPhone: true },
            });
            res.json({ supportPhone: schedule?.supportPhone ?? null });
        }
        catch (_error) {
            res.status(500).json({ supportPhone: null });
        }
    });
    r.get('/schedules/:route/:departureTime/availability', async (req, res) => {
        const { route, departureTime } = req.params;
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }
        try {
            const schedule = await prisma.schedule.findUnique({
                where: {
                    route_departureTime: {
                        route,
                        departureTime,
                    },
                },
            });
            if (!schedule) {
                return res.status(404).json({ error: 'Schedule not found' });
            }
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
                        lte: endOfDay,
                    },
                },
            });
            const bookedSeats = bookings.reduce((sum, booking) => sum + booking.seats, 0);
            const availableSeats = schedule.maxSeats - bookedSeats;
            res.json({
                scheduleId: schedule.id,
                maxSeats: schedule.maxSeats,
                bookedSeats,
                availableSeats,
                isAvailable: availableSeats > 0,
            });
        }
        catch (_error) {
            res.status(500).json({ error: 'Failed to check availability' });
        }
    });
    r.post('/schedules', require_admin_1.requireAdmin, async (req, res) => {
        const { route, departureTime, maxSeats, supportPhone } = req.body;
        if (!route || !departureTime) {
            return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
        }
        if (!(0, schedule_departure_time_1.isValidScheduleDepartureTime)(departureTime)) {
            return res.status(400).json({ error: schedule_departure_time_1.SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
        }
        try {
            const schedule = await prisma.schedule.create({
                data: {
                    route,
                    departureTime,
                    maxSeats: maxSeats ? Number(maxSeats) : 20,
                    supportPhone: supportPhone != null && String(supportPhone).trim() !== '' ? String(supportPhone).trim() : null,
                },
            });
            res.status(201).json(schedule);
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2002') {
                return res.status(409).json({ error: 'Schedule with this route and time already exists' });
            }
            res.status(500).json({ error: 'Failed to create schedule' });
        }
    });
    r.put('/schedules/:id', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        const { route, departureTime, maxSeats, supportPhone } = req.body;
        if (!route || !departureTime) {
            return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
        }
        if (!(0, schedule_departure_time_1.isValidScheduleDepartureTime)(departureTime)) {
            return res.status(400).json({ error: schedule_departure_time_1.SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
        }
        try {
            const schedule = await prisma.schedule.update({
                where: { id: Number(id) },
                data: {
                    route,
                    departureTime,
                    maxSeats: maxSeats ? Number(maxSeats) : undefined,
                    supportPhone: supportPhone !== undefined
                        ? supportPhone != null && String(supportPhone).trim() !== ''
                            ? String(supportPhone).trim()
                            : null
                        : undefined,
                },
            });
            res.json(schedule);
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025') {
                return res.status(404).json({ error: 'Schedule not found' });
            }
            if (err.code === 'P2002') {
                return res.status(409).json({ error: 'Schedule with this route and time already exists' });
            }
            res.status(500).json({ error: 'Failed to update schedule' });
        }
    });
    r.delete('/schedules/:id', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            await prisma.schedule.delete({
                where: { id: Number(id) },
            });
            res.status(204).send();
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025') {
                return res.status(404).json({ error: 'Schedule not found' });
            }
            res.status(500).json({ error: 'Failed to delete schedule' });
        }
    });
    r.post('/bookings', async (req, res) => {
        const { route, date, departureTime, seats, name, phone, scheduleId, telegramUserId } = req.body;
        if (!route || !date || !departureTime || !seats || !name || !phone) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const phoneValid = (0, booking_phone_1.validateBookingPhoneInput)(phone);
        if (!phoneValid.ok) {
            return res.status(400).json({ error: phoneValid.error });
        }
        if (!(0, schedule_departure_time_1.isValidScheduleDepartureTime)(departureTime)) {
            return res.status(400).json({ error: schedule_departure_time_1.SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
        }
        try {
            const schedule = await prisma.schedule.findUnique({
                where: {
                    route_departureTime: {
                        route,
                        departureTime,
                    },
                },
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
                            lte: endOfDay,
                        },
                    },
                });
                const bookedSeats = existingBookings.reduce((sum, booking) => sum + booking.seats, 0);
                const requestedSeats = Number(seats);
                const availableSeats = schedule.maxSeats - bookedSeats;
                if (requestedSeats > availableSeats) {
                    return res.status(400).json({
                        error: `Недостатньо місць. Доступно: ${availableSeats}, запитується: ${requestedSeats}`,
                    });
                }
            }
        }
        catch {
            // Якщо графік не знайдено, все одно дозволяємо бронювання
        }
        let telegramChatId = null;
        let bookingTelegramUserId = telegramUserId || null;
        const fullNameForPerson = typeof name === 'string' && name.trim() ? name.trim() : name;
        const person = await (0, telegram_1.findOrCreatePersonByPhone)(phone, { fullName: fullNameForPerson });
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
        if (telegramChatId && telegramChatId !== '0' && telegramChatId.trim() !== '' && !bookingTelegramUserId) {
            bookingTelegramUserId = telegramChatId;
            console.log(`⚠️ Використовуємо telegramChatId як telegramUserId для приватного чату: ${bookingTelegramUserId}`);
        }
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
            phone: phone,
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
        if ((0, telegram_1.isTelegramEnabled)()) {
            try {
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
                const customerChatId = await (0, telegram_1.getChatIdByPhone)(booking.phone);
                if (customerChatId) {
                    const supportPhone = await (0, support_phone_route_1.getSupportPhoneForRoute)(prisma, booking.route);
                    await (0, telegram_1.sendBookingConfirmationToCustomer)(customerChatId, {
                        id: booking.id,
                        route: booking.route,
                        date: booking.date,
                        departureTime: booking.departureTime,
                        seats: booking.seats,
                        name: booking.name,
                        source: booking.source,
                        supportPhone: supportPhone ?? undefined,
                        personId: person.id,
                        phone: booking.phone,
                    });
                }
            }
            catch (error) {
                console.error('Помилка відправки Telegram повідомлення:', error);
            }
        }
        res.status(201).json(booking);
    });
    r.get('/bookings', require_admin_1.requireAdmin, async (_req, res) => {
        res.json(await prisma.booking.findMany({ orderBy: { createdAt: 'desc' } }));
    });
    r.get('/bookings/by-phone/:phone', async (req, res) => {
        const { phone } = req.params;
        try {
            const normalized = (0, telegram_1.normalizePhone)(phone);
            const person = await (0, telegram_1.getPersonByPhone)(phone);
            if (person) {
                const byPerson = await prisma.booking.findFirst({
                    where: { personId: person.id },
                    orderBy: { createdAt: 'desc' },
                });
                if (byPerson) {
                    return res.json(byPerson);
                }
                if (person.fullName && person.fullName.trim()) {
                    return res.json({ name: person.fullName.trim(), phone: person.phoneNormalized });
                }
            }
            const allRecent = await prisma.booking.findMany({
                orderBy: { createdAt: 'desc' },
                take: 500,
            });
            const lastBooking = allRecent.find((b) => (0, telegram_1.normalizePhone)(b.phone) === normalized) ?? null;
            res.json(lastBooking);
        }
        catch (_error) {
            res.status(500).json({ error: 'Failed to find booking' });
        }
    });
    r.delete('/bookings/:id/by-user', async (req, res) => {
        const { id } = req.params;
        const { telegramUserId } = req.body;
        if (!telegramUserId) {
            return res.status(400).json({ error: 'telegramUserId is required' });
        }
        try {
            const booking = await prisma.booking.findUnique({
                where: { id: Number(id) },
            });
            if (!booking) {
                return res.status(404).json({ error: 'Бронювання не знайдено' });
            }
            if (booking.telegramUserId !== telegramUserId) {
                return res.status(403).json({ error: 'Це не ваше бронювання' });
            }
            await prisma.booking.delete({
                where: { id: Number(id) },
            });
            console.log(`✅ Користувач ${telegramUserId} скасував бронювання #${id}`);
            res.json({
                success: true,
                message: 'Бронювання скасовано',
                booking: {
                    id: booking.id,
                    route: booking.route,
                    date: booking.date,
                    departureTime: booking.departureTime,
                },
            });
        }
        catch (error) {
            console.error('❌ Помилка скасування бронювання:', error);
            const err = error;
            if (err.code === 'P2025') {
                return res.status(404).json({ error: 'Booking not found' });
            }
            res.status(500).json({ error: 'Failed to cancel booking' });
        }
    });
    r.delete('/bookings/:id', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            await prisma.booking.delete({
                where: { id: Number(id) },
            });
            res.status(204).send();
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025') {
                return res.status(404).json({ error: 'Booking not found' });
            }
            res.status(500).json({ error: 'Failed to delete booking' });
        }
    });
    return r;
}
