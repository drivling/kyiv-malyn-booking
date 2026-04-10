"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRideshareRouter = createRideshareRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
function createRideshareRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.post('/rideshare/request', async (req, res) => {
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
            const passengerListing = existingPassenger ??
                (await prisma.viberListing.create({
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
                }));
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
    return r;
}
