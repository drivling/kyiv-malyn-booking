"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserProfileRouter = createUserProfileRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const index_helpers_1 = require("../index-helpers");
function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}
function createUserProfileRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.get('/user/profile', async (req, res) => {
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
    r.put('/user/profile/name', async (req, res) => {
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
            const err = error;
            if (err.code === 'P2025')
                return res.status(404).json({ error: 'Profile not found' });
            console.error('❌ PUT /user/profile/name:', error);
            res.status(500).json({ error: 'Failed to update name' });
        }
    });
    return r;
}
