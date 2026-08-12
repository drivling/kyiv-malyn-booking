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
const schedule_price_1 = require("../schedule-price");
const schedule_trip_1 = require("../schedule-trip");
const scheduleInclude = {
    startPoint: true,
    endPoint: true,
    tripRoute: { include: { startPoint: true, endPoint: true, corridorRoute: true } },
};
async function loadPointsMap(prisma) {
    const points = await prisma.tripPoint.findMany();
    return new Map(points.map((p) => [p.id, p]));
}
function optionalTrimmedString(raw) {
    if (raw === undefined)
        return undefined;
    if (raw === null)
        return null;
    const s = String(raw).trim();
    return s === '' ? null : s;
}
function parseOptionalDuration(raw) {
    if (raw === undefined)
        return undefined;
    if (raw === null || raw === '')
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)
        return null;
    return Math.round(n);
}
async function resolveScheduleTripFields(prisma, body, existing) {
    const pointsById = await loadPointsMap(prisma);
    let startPointId = body.startPointId !== undefined ? Number(body.startPointId) : existing?.startPointId ?? null;
    let endPointId = body.endPointId !== undefined ? Number(body.endPointId) : existing?.endPointId ?? null;
    let viaPointIds = body.viaPointIds !== undefined
        ? (0, schedule_trip_1.normalizeViaPointIds)(body.viaPointIds)
        : (0, schedule_trip_1.normalizeViaPointIds)(existing?.viaPointIds);
    // Legacy: allow route-only create/update and derive points
    if ((startPointId == null || endPointId == null) && (body.route || existing?.route)) {
        const { startCode, endCode, viaCodes } = (0, schedule_trip_1.parseLegacyRoute)(String(body.route || existing?.route));
        const byCode = new Map([...pointsById.values()].map((p) => [p.code, p]));
        const start = byCode.get(startCode);
        const end = byCode.get(endCode);
        if (start && end) {
            startPointId = start.id;
            endPointId = end.id;
            if (body.viaPointIds === undefined) {
                viaPointIds = viaCodes.map((c) => byCode.get(c)?.id).filter((id) => id != null);
            }
        }
    }
    if (startPointId == null || endPointId == null || !Number.isInteger(startPointId) || !Number.isInteger(endPointId)) {
        return { ok: false, status: 400, error: 'startPointId and endPointId are required (or provide legacy route)' };
    }
    const validated = (0, schedule_trip_1.validateTripPointSelection)({
        startPointId,
        endPointId,
        viaPointIds,
        pointsById,
    });
    if (!validated.ok) {
        return { ok: false, status: 400, error: validated.error };
    }
    const start = pointsById.get(startPointId);
    const end = pointsById.get(endPointId);
    const viaCodes = validated.viaPointIds.map((id) => pointsById.get(id).code);
    const route = (0, schedule_trip_1.buildLegacyRouteKey)(start.code, end.code, viaCodes);
    let tripRouteId = body.tripRouteId !== undefined ? Number(body.tripRouteId) : existing?.tripRouteId;
    if (tripRouteId == null || !Number.isInteger(tripRouteId)) {
        try {
            const tr = await (0, schedule_trip_1.findOrCreateTripRoute)(prisma, {
                startPointId,
                endPointId,
                viaPointIds: validated.viaPointIds,
            });
            tripRouteId = tr.id;
        }
        catch (e) {
            return { ok: false, status: 400, error: e instanceof Error ? e.message : 'Failed to resolve trip route' };
        }
    }
    const vehicleTypeRaw = body.vehicleType !== undefined ? body.vehicleType : existing?.vehicleType ?? 'marshrutka';
    if (!(0, schedule_trip_1.isVehicleType)(vehicleTypeRaw)) {
        return { ok: false, status: 400, error: 'vehicleType must be marshrutka or elektrichka' };
    }
    const vehicleType = vehicleTypeRaw;
    const ticketPurchaseUrl = optionalTrimmedString(body.ticketPurchaseUrl);
    const arrivalTime = optionalTrimmedString(body.arrivalTime);
    if (arrivalTime && !(0, schedule_trip_1.parseHhMm)(arrivalTime)) {
        return { ok: false, status: 400, error: 'arrivalTime must be HH:MM' };
    }
    const data = {
        route,
        tripRouteId,
        startPointId,
        endPointId,
        viaPointIds: validated.viaPointIds,
        vehicleType,
    };
    if (body.boardingPlace !== undefined)
        data.boardingPlace = optionalTrimmedString(body.boardingPlace);
    if (body.alightingPlace !== undefined)
        data.alightingPlace = optionalTrimmedString(body.alightingPlace);
    if (body.tripNumber !== undefined)
        data.tripNumber = optionalTrimmedString(body.tripNumber);
    if (body.arrivalTime !== undefined)
        data.arrivalTime = arrivalTime ?? null;
    if (body.durationMinutes !== undefined)
        data.durationMinutes = parseOptionalDuration(body.durationMinutes);
    if (body.ticketPurchaseUrl !== undefined)
        data.ticketPurchaseUrl = ticketPurchaseUrl ?? null;
    if (body.activeWeekdays !== undefined)
        data.activeWeekdays = (0, schedule_trip_1.normalizeActiveWeekdays)(body.activeWeekdays);
    return { ok: true, data, route };
}
function createSchedulesBookingsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.get('/schedules', async (req, res) => {
        const { route, vehicleType, date } = req.query;
        const where = {};
        if (route)
            where.route = route;
        if (vehicleType && (0, schedule_trip_1.isVehicleType)(vehicleType))
            where.vehicleType = vehicleType;
        let schedules = await prisma.schedule.findMany({
            where,
            include: scheduleInclude,
            orderBy: [{ route: 'asc' }, { departureTime: 'asc' }],
        });
        if (date && typeof date === 'string') {
            schedules = schedules.filter((s) => (0, schedule_trip_1.isScheduleActiveOnDate)(s.activeWeekdays, date));
        }
        res.json(schedules);
    });
    r.get('/schedules/:route', async (req, res) => {
        const { route } = req.params;
        const { date, vehicleType } = req.query;
        const where = { route };
        if (vehicleType && (0, schedule_trip_1.isVehicleType)(vehicleType))
            where.vehicleType = vehicleType;
        let schedules = await prisma.schedule.findMany({
            where,
            include: scheduleInclude,
            orderBy: { departureTime: 'asc' },
        });
        if (date && typeof date === 'string') {
            schedules = schedules.filter((s) => (0, schedule_trip_1.isScheduleActiveOnDate)(s.activeWeekdays, date));
        }
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
            if (schedule.vehicleType === 'elektrichka') {
                return res.json({
                    scheduleId: schedule.id,
                    maxSeats: schedule.maxSeats,
                    bookedSeats: 0,
                    availableSeats: 0,
                    isAvailable: false,
                    vehicleType: schedule.vehicleType,
                    ticketPurchaseUrl: schedule.ticketPurchaseUrl,
                });
            }
            if (!(0, schedule_trip_1.isScheduleActiveOnDate)(schedule.activeWeekdays, date)) {
                return res.json({
                    scheduleId: schedule.id,
                    maxSeats: schedule.maxSeats,
                    bookedSeats: 0,
                    availableSeats: 0,
                    isAvailable: false,
                    inactiveOnDate: true,
                });
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
        const body = req.body ?? {};
        const { departureTime, maxSeats, supportPhone, priceUah } = body;
        if (!departureTime) {
            return res.status(400).json({ error: 'Missing fields: departureTime is required' });
        }
        if (!(0, schedule_departure_time_1.isValidScheduleDepartureTime)(departureTime)) {
            return res.status(400).json({ error: schedule_departure_time_1.SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
        }
        const trip = await resolveScheduleTripFields(prisma, body);
        if (!trip.ok) {
            return res.status(trip.status).json({ error: trip.error });
        }
        if (trip.data.vehicleType === 'elektrichka' && !trip.data.ticketPurchaseUrl) {
            return res.status(400).json({ error: 'ticketPurchaseUrl is required for elektrichka' });
        }
        const parsedPrice = (0, schedule_price_1.parseOptionalPriceUah)(priceUah);
        const resolvedPrice = parsedPrice !== undefined ? parsedPrice : (0, schedule_price_1.defaultSchedulePriceUah)(trip.route);
        try {
            const schedule = await prisma.schedule.create({
                data: {
                    ...trip.data,
                    departureTime,
                    maxSeats: maxSeats ? Number(maxSeats) : 20,
                    supportPhone: supportPhone != null && String(supportPhone).trim() !== '' ? String(supportPhone).trim() : null,
                    priceUah: resolvedPrice,
                    activeWeekdays: trip.data.activeWeekdays ?? (0, schedule_trip_1.normalizeActiveWeekdays)(undefined),
                },
                include: scheduleInclude,
            });
            res.status(201).json(schedule);
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2002') {
                return res.status(409).json({ error: 'Schedule with this route and time already exists' });
            }
            console.error('Failed to create schedule', error);
            res.status(500).json({ error: 'Failed to create schedule' });
        }
    });
    r.put('/schedules/:id', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        const body = req.body ?? {};
        const { departureTime, maxSeats, supportPhone, priceUah } = body;
        if (!departureTime) {
            return res.status(400).json({ error: 'Missing fields: departureTime is required' });
        }
        if (!(0, schedule_departure_time_1.isValidScheduleDepartureTime)(departureTime)) {
            return res.status(400).json({ error: schedule_departure_time_1.SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE });
        }
        const existing = await prisma.schedule.findUnique({ where: { id: Number(id) } });
        if (!existing) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        const trip = await resolveScheduleTripFields(prisma, body, existing);
        if (!trip.ok) {
            return res.status(trip.status).json({ error: trip.error });
        }
        const vehicleType = trip.data.vehicleType || existing.vehicleType;
        const nextUrl = trip.data.ticketPurchaseUrl !== undefined
            ? trip.data.ticketPurchaseUrl
            : existing.ticketPurchaseUrl;
        if (vehicleType === 'elektrichka' && !nextUrl) {
            return res.status(400).json({ error: 'ticketPurchaseUrl is required for elektrichka' });
        }
        const parsedPrice = (0, schedule_price_1.parseOptionalPriceUah)(priceUah);
        try {
            const schedule = await prisma.schedule.update({
                where: { id: Number(id) },
                data: {
                    ...trip.data,
                    departureTime,
                    maxSeats: maxSeats ? Number(maxSeats) : undefined,
                    supportPhone: supportPhone !== undefined
                        ? supportPhone != null && String(supportPhone).trim() !== ''
                            ? String(supportPhone).trim()
                            : null
                        : undefined,
                    ...(parsedPrice !== undefined ? { priceUah: parsedPrice } : {}),
                },
                include: scheduleInclude,
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
            console.error('Failed to update schedule', error);
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
        let resolvedSchedule = scheduleId != null
            ? await prisma.schedule.findUnique({ where: { id: Number(scheduleId) } })
            : await prisma.schedule.findUnique({
                where: { route_departureTime: { route, departureTime } },
            });
        if (!resolvedSchedule) {
            return res.status(400).json({ error: 'Schedule not found for this route and time' });
        }
        if (resolvedSchedule.vehicleType === 'elektrichka') {
            return res.status(400).json({
                error: 'Електрички не бронюються на сайті. Купіть квиток за посиланням перевізника.',
                ticketPurchaseUrl: resolvedSchedule.ticketPurchaseUrl,
            });
        }
        if (!(0, schedule_trip_1.isScheduleActiveOnDate)(resolvedSchedule.activeWeekdays, date)) {
            return res.status(400).json({ error: 'Рейс не курсує в обрану дату' });
        }
        {
            const bookingDate = new Date(date);
            const startOfDay = new Date(bookingDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(bookingDate);
            endOfDay.setHours(23, 59, 59, 999);
            const existingBookings = await prisma.booking.findMany({
                where: {
                    scheduleId: resolvedSchedule.id,
                    date: { gte: startOfDay, lte: endOfDay },
                },
            });
            const bookedSeats = existingBookings.reduce((sum, booking) => sum + booking.seats, 0);
            const requestedSeats = Number(seats);
            const availableSeats = resolvedSchedule.maxSeats - bookedSeats;
            if (requestedSeats > availableSeats) {
                return res.status(400).json({
                    error: `Недостатньо місць. Доступно: ${availableSeats}, запитується: ${requestedSeats}`,
                });
            }
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
                route: resolvedSchedule.route,
                date: new Date(date),
                departureTime: resolvedSchedule.departureTime,
                seats: Number(seats),
                name,
                phone,
                scheduleId: resolvedSchedule.id,
                telegramChatId,
                telegramUserId: bookingTelegramUserId,
                personId: person.id,
                source: 'schedule',
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
