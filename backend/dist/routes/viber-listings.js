"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createViberListingsRouter = createViberListingsRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const notification_queue_1 = require("../notification-queue");
const viber_analytics_import_1 = require("../viber-analytics-import");
const viber_parser_1 = require("../viber-parser");
const viber_ingest_1 = require("../viber-ingest");
const index_helpers_1 = require("../index-helpers");
const require_admin_1 = require("../middleware/require-admin");
const catalog_cache_1 = require("../catalog-cache");
const poputky_od_1 = require("../poputky-od");
const viber_listing_public_1 = require("../viber-listing-public");
const trip_day_1 = require("../trip-day");
const viber_listing_dedupe_after_update_1 = require("../viber-listing-dedupe-after-update");
const phone_block_1 = require("../phone-block");
const VIBER_LISTING_UPDATE_FIELDS = [
    'rawMessage',
    'senderName',
    'listingType',
    'route',
    'tripRouteId',
    'fromPointId',
    'toPointId',
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
    /**
     * Повний рядок (телефон, сирий текст) — лише адмінці; сайту віддаємо публічний DTO.
     * Публічний список обмежений активними оголошеннями від сьогодні (історія — в адмінці).
     */
    r.get('/viber-listings', async (req, res) => {
        try {
            const { active } = req.query;
            const isAdmin = req.headers.authorization === require_admin_1.ADMIN_AUTH_TOKEN;
            if (isAdmin) {
                const where = active === 'true' ? { isActive: true } : {};
                const listings = await prisma.viberListing.findMany({
                    where,
                    orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
                });
                res.json(listings.map(index_helpers_1.serializeViberListing));
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const listings = await prisma.viberListing.findMany({
                where: { isActive: true, date: { gte: today } },
                orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
                select: viber_listing_public_1.PUBLIC_LISTING_SELECT,
            });
            res.json(listings.map(viber_listing_public_1.toPublicListing));
        }
        catch (error) {
            console.error('❌ Помилка отримання Viber оголошень:', error);
            res.status(500).json({ error: 'Не вдалося завантажити Viber оголошення. Перевірте логи сервера.' });
        }
    });
    /**
     * Контакт автора оголошення (телефон або @username) — окремим запитом, по кліку.
     * На сторінках сайту контакт не рендериться: у DOM його немає, пошуковики й
     * прості скрейпери сторінки нічого не збирають.
     * Публічний і лише для активних оголошень — заборонені/зняті не віддаємо.
     */
    r.get('/viber-listings/:id/contact', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                return res.status(400).json({ error: 'Невірний id' });
            }
            const listing = await prisma.viberListing.findUnique({
                where: { id },
                select: { phone: true, isActive: true },
            });
            if (!listing || !listing.isActive || !listing.phone?.trim()) {
                return res.status(404).json({ error: 'Контакт недоступний' });
            }
            return res.json({ contact: listing.phone.trim() });
        }
        catch (error) {
            console.error('❌ Помилка отримання контакту оголошення:', error);
            return res.status(500).json({ error: 'Не вдалося отримати контакт' });
        }
    });
    r.get('/viber-listings/search', async (req, res) => {
        const { route, date, fromCode, toCode } = req.query;
        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }
        const hasOd = typeof fromCode === 'string' &&
            typeof toCode === 'string' &&
            fromCode.trim() &&
            toCode.trim();
        if (!route && !hasOd) {
            return res.status(400).json({ error: 'fromCode+toCode or route is required' });
        }
        try {
            const dateFilter = {
                date: (0, trip_day_1.tripDayWhere)(String(date)),
                isActive: true,
            };
            let listings;
            if (hasOd) {
                // Точки й маршрути — з кешу процесу, не з БД на кожен пошук
                const catalog = await (0, catalog_cache_1.getCatalog)(prisma);
                const from = catalog.pointByCode(String(fromCode));
                const to = catalog.pointByCode(String(toCode));
                if (!from || !to) {
                    return res.json([]);
                }
                const alongTripRouteIds = catalog.routeIdsAlong(from.id, to.id);
                listings = await prisma.viberListing.findMany({
                    where: {
                        ...dateFilter,
                        OR: [
                            { fromPointId: from.id, toPointId: to.id },
                            ...(alongTripRouteIds.length
                                ? [{ tripRouteId: { in: alongTripRouteIds } }]
                                : []),
                            ...(route ? [{ route: route, fromPointId: null, toPointId: null }] : []),
                            {
                                route: `${from.code}-${to.code}`,
                                fromPointId: null,
                                toPointId: null,
                            },
                        ],
                    },
                    orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                    select: viber_listing_public_1.PUBLIC_LISTING_SELECT,
                });
                // SQL звузив по маршруту; тут перевіряємо OD самого оголошення (пасажир з іншою парою — ні)
                const search = { fromId: from.id, toId: to.id, fromCode: from.code, toCode: to.code };
                listings = listings.filter((l) => (0, poputky_od_1.listingMatchesSearchOd)(l, search, catalog.itineraryByRouteId));
            }
            else {
                listings = await prisma.viberListing.findMany({
                    where: {
                        ...dateFilter,
                        route: route,
                    },
                    orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                    select: viber_listing_public_1.PUBLIC_LISTING_SELECT,
                });
            }
            res.json(listings.map(viber_listing_public_1.toPublicListing));
        }
        catch (error) {
            console.error('❌ Помилка пошуку Viber оголошень:', error);
            res.status(500).json({ error: 'Не вдалося пошукати Viber оголошення.' });
        }
    });
    /**
     * Прийом одного сирого повідомлення (парсер Viber, адмінка). Ідемпотентно: повтор того самого
     * тексту → 200 з тим самим оголошенням і `duplicate: true` (viber-ingest.ts, Фаза 5.1).
     */
    r.post('/viber-listings', require_admin_1.requireAdmin, async (req, res) => {
        const { rawMessage, source } = req.body;
        if (!rawMessage) {
            return res.status(400).json({ error: 'rawMessage is required' });
        }
        try {
            const result = await (0, viber_ingest_1.ingestRawListing)(prisma, {
                rawMessage,
                source: source === 'telegram1' ? 'telegram1' : 'Viber1',
            });
            if (!result.ok) {
                return res.status(400).json({
                    error: 'Не вдалося розпарсити повідомлення. Перевірте формат.',
                });
            }
            const { listing, isPastDate, duplicate, matchingRecheckTriggered } = result;
            if (!duplicate) {
                console.log(`✅ Створено Viber оголошення #${listing.id}:`, {
                    type: listing.listingType,
                    route: listing.route,
                    date: listing.date,
                    phone: listing.phone,
                    archived: isPastDate,
                });
            }
            res
                .status(duplicate ? 200 : 201)
                .json({ ...(0, index_helpers_1.serializeViberListing)(listing), matchingRecheckTriggered, duplicate });
        }
        catch (error) {
            if ((0, phone_block_1.isPhoneBlockedError)(error)) {
                // Інакше і адмінка, і Python-парсер побачили б незрозумілу 500.
                res.status(403).json({ error: phone_block_1.PHONE_BLOCKED_ADMIN_MESSAGE });
                return;
            }
            console.error('❌ Помилка створення Viber оголошення:', error);
            res.status(500).json({ error: 'Failed to create Viber listing' });
        }
    });
    /**
     * Пачка сирих повідомлень: `rawMessages` — масив рядків (парсер, один POST на тик) або один
     * текстовий блок (адмінка, розділяється по заголовках). Кожне повідомлення проходить той самий
     * ідемпотентний шлях; помилки — поелементно, відповідь завжди 201, щоб парсер зсунув курсор.
     */
    r.post('/viber-listings/bulk', require_admin_1.requireAdmin, async (req, res) => {
        const { rawMessages, source } = req.body;
        if (!rawMessages) {
            return res.status(400).json({ error: 'rawMessages is required' });
        }
        try {
            const rawList = Array.isArray(rawMessages)
                ? rawMessages.map((m) => String(m ?? '').trim()).filter((m) => m.length >= 10)
                : (0, viber_parser_1.parseViberMessages)(String(rawMessages)).map((m) => m.rawMessage);
            if (rawList.length === 0) {
                return res.status(400).json({
                    error: 'Не вдалося розпарсити жодне повідомлення',
                });
            }
            const created = [];
            const errors = [];
            let duplicates = 0;
            let unparsable = 0;
            const matchingRecheckTriggered = (0, telegram_1.isTelegramEnabled)();
            for (let i = 0; i < rawList.length; i++) {
                try {
                    const result = await (0, viber_ingest_1.ingestRawListing)(prisma, {
                        rawMessage: rawList[i],
                        source: source === 'telegram1' ? 'telegram1' : 'Viber1',
                    });
                    if (!result.ok) {
                        unparsable++;
                        errors.push({ index: i, error: 'unparsable' });
                        continue;
                    }
                    if (result.duplicate)
                        duplicates++;
                    else if (result.isNew)
                        created.push(result.listing);
                }
                catch (error) {
                    errors.push({ index: i, error: error instanceof Error ? error.message : 'Unknown error' });
                }
            }
            console.log(`✅ Створено ${created.length} Viber оголошень з ${rawList.length} (дублів: ${duplicates}, нерозібраних: ${unparsable})`);
            res.status(201).json({
                success: true,
                created: created.length,
                duplicates,
                unparsable,
                total: rawList.length,
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
                else if (key === 'tripRouteId' || key === 'fromPointId' || key === 'toPointId') {
                    const v = body[key];
                    if (v === null || v === '' || v === 'null') {
                        updates[key] = null;
                    }
                    else {
                        const n = typeof v === 'number' ? v : parseInt(String(v), 10);
                        if (!Number.isInteger(n) || n <= 0) {
                            return res.status(400).json({ error: `${key} must be a positive integer or null` });
                        }
                        updates[key] = n;
                    }
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
            const explicitTripRouteId = Object.prototype.hasOwnProperty.call(body, 'tripRouteId');
            if (explicitTripRouteId && updates.tripRouteId != null) {
                const tr = await prisma.tripRoute.findUnique({ where: { id: updates.tripRouteId } });
                if (!tr) {
                    return res.status(400).json({ error: 'TripRoute not found' });
                }
                // Admin can pin corridor OR variant (e.g. Kyiv-Malyn-Irpin). Keep route snapshot in sync if not overridden.
                if (updates.route === undefined) {
                    updates.route = tr.slug;
                }
            }
            else if (!explicitTripRouteId && typeof updates.route === 'string' && updates.route) {
                // Legacy: changing route alone still auto-binds corridor (not variant).
                const { resolveCorridorTripRouteId } = await Promise.resolve().then(() => __importStar(require('../schedule-trip')));
                updates.tripRouteId = await resolveCorridorTripRouteId(prisma, String(updates.route));
            }
            if (typeof updates.route === 'string' && updates.route) {
                const { resolveOdPointIdsFromRoute } = await Promise.resolve().then(() => __importStar(require('../poputky-od')));
                const od = await resolveOdPointIdsFromRoute(prisma, String(updates.route));
                if (od && updates.fromPointId === undefined && updates.toPointId === undefined) {
                    updates.fromPointId = od.fromPointId;
                    updates.toPointId = od.toPointId;
                }
            }
            if (updates.date !== undefined || updates.departureTime !== undefined) {
                const current = await prisma.viberListing.findUnique({
                    where: { id: Number(id) },
                    select: { date: true, departureTime: true },
                });
                if (current) {
                    updates.endsAt = (0, index_helpers_1.getViberListingEndDateTime)(updates.date ?? current.date, updates.departureTime ?? current.departureTime);
                }
            }
            let listing = await prisma.viberListing.update({
                where: { id: Number(id) },
                data: updates,
            });
            const { listing: afterDedupe, mergedAwayIds } = await (0, viber_listing_dedupe_after_update_1.dedupeViberListingsAfterUpdate)(prisma, listing.id);
            listing = afterDedupe;
            let matchingRecheckTriggered = false;
            if ((0, telegram_1.isTelegramEnabled)()) {
                matchingRecheckTriggered = true;
                // Перетини й розсилка — у фоновій черзі (notification-queue.ts), відповідь не чекає
                void (0, notification_queue_1.enqueueListingMatch)(prisma, listing.id).catch((err) => console.error('enqueue listing match:', err));
            }
            res.json({ ...(0, index_helpers_1.serializeViberListing)(listing), matchingRecheckTriggered, mergedAwayIds });
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
            const now = new Date();
            const cutoff = new Date(now);
            cutoff.setHours(cutoff.getHours() - CLEANUP_CUTOFF_HOURS);
            // Основний шлях: один updateMany по індексу (isActive, endsAt)
            const byEndsAt = await prisma.viberListing.updateMany({
                where: { isActive: true, endsAt: { lt: cutoff } },
                data: { isActive: false },
            });
            // Рядки без endsAt (до backfill або з обхідного шляху запису) — як раніше, в JS; їх одиниці
            const withoutEndsAt = await prisma.viberListing.findMany({
                where: { isActive: true, endsAt: null },
                select: { id: true, date: true, departureTime: true },
            });
            const legacyIds = withoutEndsAt
                .filter((l) => (0, index_helpers_1.getViberListingEndDateTime)(l.date, l.departureTime) < cutoff)
                .map((l) => l.id);
            if (legacyIds.length > 0) {
                await prisma.viberListing.updateMany({
                    where: { id: { in: legacyIds } },
                    data: { isActive: false },
                });
            }
            // Протерміновані запити «пасажир → водій» (1 год на підтвердження) — раніше їх ніхто не закривав
            const expiredRequests = await prisma.rideShareRequest.updateMany({
                where: { status: 'pending', expiresAt: { lt: now } },
                data: { status: 'expired' },
            });
            const count = byEndsAt.count + legacyIds.length;
            console.log(`🧹 Деактивовано ${count} старих Viber оголошень (дата по < ${cutoff.toISOString()}), протерміновано запитів: ${expiredRequests.count}`);
            res.json({
                success: true,
                deactivated: count,
                expiredRequests: expiredRequests.count,
                message: `Деактивовано ${count} оголошень`,
            });
        }
        catch (error) {
            console.error('❌ Помилка очищення старих Viber оголошень:', error);
            res.status(500).json({ error: 'Failed to cleanup old listings' });
        }
    });
    /**
     * Архів для cron (раз на місяць): нові рядки → ViberRideEvent (аналітика), потім видаляємо
     * неактивні оголошення старші за `days` (за замовчуванням 90, мінімум 30). Гаряча таблиця
     * лишається невеликою; Booking/RideShareRequest на видалені рядки — SetNull/Cascade у схемі.
     */
    r.post('/viber-listings/archive-old', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const raw = Number((req.query.days ?? req.body?.days) ?? 90);
            const days = Number.isFinite(raw) ? Math.max(30, Math.round(raw)) : 90;
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            const imported = await (0, viber_analytics_import_1.importListingsToRideEvents)(prisma);
            const deleted = await prisma.viberListing.deleteMany({
                where: { isActive: false, date: { lt: cutoff } },
            });
            console.log(`🗄️ Архів: імпортовано в аналітику ${imported.importedNow}, видалено неактивних старших за ${days} дн.: ${deleted.count}`);
            res.json({ success: true, days, cutoff: cutoff.toISOString(), ...imported, deleted: deleted.count });
        }
        catch (error) {
            console.error('❌ Помилка архівування Viber оголошень:', error);
            res.status(500).json({ error: 'Failed to archive old listings' });
        }
    });
    return r;
}
