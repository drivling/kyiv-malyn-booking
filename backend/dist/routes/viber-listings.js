"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createViberListingsRouter = createViberListingsRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const viber_parser_1 = require("../viber-parser");
const index_helpers_1 = require("../index-helpers");
const require_admin_1 = require("../middleware/require-admin");
const VIBER_LISTING_UPDATE_FIELDS = [
    'rawMessage',
    'senderName',
    'listingType',
    'route',
    'date',
    'departureTime',
    'seats',
    'phone',
    'notes',
    'priceUah',
    'isActive',
];
const CLEANUP_CUTOFF_HOURS = 1;
function createViberListingsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    async function createOrMergeViberListing(data) {
        const personId = data.personId ?? null;
        const date = data.date;
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
        const normalizedPhone = data.phone?.trim() ? (0, telegram_1.normalizePhone)(data.phone) : '';
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
            },
        });
        console.log(`♻️ Listing merged with existing #${existing.id} (route+date+time+phone match, source=${existing.source})`);
        return { listing: updated, isNew: false };
    }
    r.get('/viber-listings', async (req, res) => {
        try {
            const { active } = req.query;
            const where = active === 'true' ? { isActive: true } : {};
            const listings = await prisma.viberListing.findMany({
                where,
                orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
            });
            res.json(listings.map(index_helpers_1.serializeViberListing));
        }
        catch (error) {
            console.error('❌ Помилка отримання Viber оголошень:', error);
            res.status(500).json({ error: 'Не вдалося завантажити Viber оголошення. Перевірте логи сервера.' });
        }
    });
    r.get('/viber-listings/search', async (req, res) => {
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
                        lte: endOfDay,
                    },
                    isActive: true,
                },
                orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
            });
            res.json(listings.map(index_helpers_1.serializeViberListing));
        }
        catch (error) {
            console.error('❌ Помилка пошуку Viber оголошень:', error);
            res.status(500).json({ error: 'Не вдалося пошукати Viber оголошення.' });
        }
    });
    r.post('/viber-listings', require_admin_1.requireAdmin, async (req, res) => {
        const { rawMessage } = req.body;
        if (!rawMessage) {
            return res.status(400).json({ error: 'rawMessage is required' });
        }
        try {
            const parsed = (0, viber_parser_1.parseViberMessage)(rawMessage);
            if (!parsed) {
                return res.status(400).json({
                    error: 'Не вдалося розпарсити повідомлення. Перевірте формат.',
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
                phone: listing.phone,
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
            res.status(201).json({ ...(0, index_helpers_1.serializeViberListing)(listing), matchingRecheckTriggered });
        }
        catch (error) {
            console.error('❌ Помилка створення Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to create Viber listing' });
        }
    });
    r.post('/viber-listings/bulk', require_admin_1.requireAdmin, async (req, res) => {
        const { rawMessages } = req.body;
        if (!rawMessages) {
            return res.status(400).json({ error: 'rawMessages is required' });
        }
        try {
            const parsedMessages = (0, viber_parser_1.parseViberMessages)(rawMessages);
            if (parsedMessages.length === 0) {
                return res.status(400).json({
                    error: 'Не вдалося розпарсити жодне повідомлення',
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
    r.put('/viber-listings/:id', require_admin_1.requireAdmin, async (req, res) => {
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
                    updates[key] = v === null || v === '' ? null : typeof v === 'number' ? v : parseInt(String(v), 10);
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
                data: updates,
            });
            let matchingRecheckTriggered = false;
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
            const err = error;
            if (err.code === 'P2025') {
                return res.status(404).json({ error: 'Viber listing not found' });
            }
            console.error('❌ Помилка оновлення Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to update Viber listing' });
        }
    });
    r.patch('/viber-listings/:id/deactivate', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const listing = await prisma.viberListing.update({
                where: { id: Number(id) },
                data: { isActive: false },
            });
            res.json(listing);
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025') {
                return res.status(404).json({ error: 'Viber listing not found' });
            }
            console.error('❌ Помилка деактивації Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to deactivate Viber listing' });
        }
    });
    r.delete('/viber-listings/:id', require_admin_1.requireAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            await prisma.viberListing.delete({
                where: { id: Number(id) },
            });
            res.status(204).send();
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025') {
                return res.status(404).json({ error: 'Viber listing not found' });
            }
            console.error('❌ Помилка видалення Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to delete Viber listing' });
        }
    });
    r.post('/viber-listings/cleanup-old', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const cutoff = new Date();
            cutoff.setHours(cutoff.getHours() - CLEANUP_CUTOFF_HOURS);
            const activeListings = await prisma.viberListing.findMany({
                where: { isActive: true },
                select: { id: true, date: true, departureTime: true },
            });
            const idsToDeactivate = activeListings
                .filter((l) => (0, index_helpers_1.getViberListingEndDateTime)(l.date, l.departureTime) < cutoff)
                .map((l) => l.id);
            const count = idsToDeactivate.length;
            if (count > 0) {
                await prisma.viberListing.updateMany({
                    where: { id: { in: idsToDeactivate } },
                    data: { isActive: false },
                });
            }
            console.log(`🧹 Деактивовано ${count} старих Viber оголошень (дата по < ${cutoff.toISOString()})`);
            res.json({
                success: true,
                deactivated: count,
                message: `Деактивовано ${count} оголошень`,
            });
        }
        catch (error) {
            console.error('❌ Помилка очищення старих Viber оголошень:', error);
            res.status(500).json({ error: 'Failed to cleanup old listings' });
        }
    });
    return r;
}
