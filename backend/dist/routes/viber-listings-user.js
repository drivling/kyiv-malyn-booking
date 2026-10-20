"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createViberListingsUserRouter = createViberListingsUserRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const index_helpers_1 = require("../index-helpers");
const notification_queue_1 = require("../notification-queue");
const viber_listing_dedupe_after_update_1 = require("../viber-listing-dedupe-after-update");
const telegram_login_auth_1 = require("../telegram-login-auth");
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
    const { prisma, telegramBotToken = null } = deps;
    const r = express_1.default.Router();
    const requireLogin = (0, telegram_login_auth_1.requireTelegramLogin)({ botToken: telegramBotToken });
    r.patch('/viber-listings/:id/by-user', requireLogin, async (req, res) => {
        const id = Number(req.params.id);
        const { id: telegramUserId } = (0, telegram_login_auth_1.telegramLoginFromRes)(res);
        // telegramUserId у тілі більше не читаємо — хто редагує, каже підпис
        const { telegramUserId: _ignored, ...body } = req.body;
        try {
            const listing = await getViberListingForUser(prisma, id, telegramUserId);
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
            if (updates.date !== undefined || updates.departureTime !== undefined) {
                updates.endsAt = (0, index_helpers_1.getViberListingEndDateTime)(updates.date ?? listing.date, updates.departureTime ?? listing.departureTime);
            }
            let updated = await prisma.viberListing.update({
                where: { id },
                data: updates,
            });
            const { listing: afterDedupe, mergedAwayIds } = await (0, viber_listing_dedupe_after_update_1.dedupeViberListingsAfterUpdate)(prisma, updated.id);
            updated = afterDedupe;
            const matchingRecheckTriggered = (0, telegram_1.isTelegramEnabled)();
            if (matchingRecheckTriggered) {
                void (0, notification_queue_1.enqueueListingMatch)(prisma, updated.id).catch((err) => console.error('enqueue listing match:', err));
            }
            res.json({ ...(0, index_helpers_1.serializeViberListing)(updated), matchingRecheckTriggered, mergedAwayIds });
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025')
                return res.status(404).json({ error: 'Listing not found' });
            console.error('❌ PATCH /viber-listings/:id/by-user:', error);
            res.status(500).json({ error: 'Failed to update listing' });
        }
    });
    r.patch('/viber-listings/:id/deactivate/by-user', requireLogin, async (req, res) => {
        const id = Number(req.params.id);
        const { id: telegramUserId } = (0, telegram_login_auth_1.telegramLoginFromRes)(res);
        try {
            const listing = await getViberListingForUser(prisma, id, telegramUserId);
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
