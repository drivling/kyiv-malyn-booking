"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createViberListingsUserRouter = createViberListingsUserRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const index_helpers_1 = require("../index-helpers");
async function getViberListingForUser(prisma, listingId, telegramUserId) {
    const person = await (0, telegram_1.getPersonByTelegram)(telegramUserId, '');
    if (!person)
        return null;
    const listing = await prisma.viberListing.findFirst({
        where: { id: listingId, personId: person.id },
    });
    return listing;
}
function createViberListingsUserRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.patch('/viber-listings/:id/by-user', async (req, res) => {
        const id = Number(req.params.id);
        const { telegramUserId, ...body } = req.body;
        if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
            return res.status(400).json({ error: 'telegramUserId is required' });
        }
        try {
            const listing = await getViberListingForUser(prisma, id, telegramUserId.trim());
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
                        updates[key] = v === null || v === '' ? null : typeof v === 'number' ? v : parseInt(String(v), 10);
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
            const err = error;
            if (err.code === 'P2025')
                return res.status(404).json({ error: 'Listing not found' });
            console.error('❌ PATCH /viber-listings/:id/by-user:', error);
            res.status(500).json({ error: 'Failed to update listing' });
        }
    });
    r.patch('/viber-listings/:id/deactivate/by-user', async (req, res) => {
        const id = Number(req.params.id);
        const { telegramUserId } = req.body;
        if (!telegramUserId || typeof telegramUserId !== 'string' || !telegramUserId.trim()) {
            return res.status(400).json({ error: 'telegramUserId is required' });
        }
        try {
            const listing = await getViberListingForUser(prisma, id, telegramUserId.trim());
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
            const err = error;
            if (err.code === 'P2025')
                return res.status(404).json({ error: 'Listing not found' });
            console.error('❌ PATCH /viber-listings/:id/deactivate/by-user:', error);
            res.status(500).json({ error: 'Failed to deactivate listing' });
        }
    });
    return r;
}
