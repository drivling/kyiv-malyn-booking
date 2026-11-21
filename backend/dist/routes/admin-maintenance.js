"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminMaintenanceRouter = createAdminMaintenanceRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const viber_listing_merge_1 = require("../viber-listing-merge");
function createAdminMaintenanceRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.post('/admin/fix-telegram-ids', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            console.log('🔧 Початок виправлення telegramUserId...');
            const problematicBookings = await prisma.booking.findMany({
                where: {
                    telegramChatId: { not: null },
                    OR: [{ telegramUserId: null }, { telegramUserId: '0' }, { telegramUserId: '' }],
                },
            });
            console.log(`📋 Знайдено ${problematicBookings.length} бронювань з невалідним telegramUserId`);
            if (problematicBookings.length === 0) {
                return res.json({
                    success: true,
                    message: 'Всі записи вже правильні!',
                    fixed: 0,
                    skipped: 0,
                    total: 0,
                });
            }
            let fixed = 0;
            let skipped = 0;
            const details = [];
            for (const booking of problematicBookings) {
                if (booking.telegramChatId && booking.telegramChatId !== '0' && booking.telegramChatId.trim() !== '') {
                    await prisma.booking.update({
                        where: { id: booking.id },
                        data: {
                            telegramUserId: booking.telegramChatId,
                        },
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
                details,
            });
        }
        catch (error) {
            console.error('❌ Помилка виправлення:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    /**
     * Привʼязка пасажирських оголошень без маршруту («Ірпінь → Малин») до варіанта коридору, на якому
     * лежить їхня пара (Київ–Малин через Ірпінь / Бучу). Без `apply: true` лише показує, що зміниться.
     */
    r.post('/admin/viber-listings/link-along-routes', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const apply = req.body?.apply === true;
            const rows = await prisma.viberListing.findMany({
                where: {
                    tripRouteId: null,
                    listingType: 'passenger',
                    fromPointId: { not: null },
                    toPointId: { not: null },
                },
                select: { id: true, route: true, fromPointId: true, toPointId: true },
                orderBy: { id: 'asc' },
            });
            const changes = [];
            for (const row of rows) {
                const tripRouteId = await (0, viber_listing_merge_1.resolveAlongTripRouteId)(prisma, row.fromPointId, row.toPointId);
                if (tripRouteId == null)
                    continue;
                changes.push({ id: row.id, route: row.route, tripRouteId });
                if (apply) {
                    await prisma.viberListing.update({ where: { id: row.id }, data: { tripRouteId } });
                }
            }
            res.json({ applied: apply, checked: rows.length, linked: changes.length, changes });
        }
        catch (error) {
            console.error('❌ link-along-routes:', error);
            res.status(500).json({ error: 'Failed to link listings' });
        }
    });
    /**
     * Стан переходу на OD-identity (Docs/poputky-search-performance-plan.md, Фаза 3.4):
     * скільки оголошень без fromPointId/toPointId, tripRouteId, endsAt. Коли нулі — можна
     * робити колонки NOT NULL і прибирати `OR route = …` з гарячих запитів.
     */
    r.get('/admin/od-identity-stats', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const [total, active, missingOd, missingTripRoute, missingEndsAt, routesWithoutOd] = await Promise.all([
                prisma.viberListing.count(),
                prisma.viberListing.count({ where: { isActive: true } }),
                prisma.viberListing.count({ where: { OR: [{ fromPointId: null }, { toPointId: null }] } }),
                prisma.viberListing.count({ where: { tripRouteId: null } }),
                prisma.viberListing.count({ where: { endsAt: null } }),
                prisma.viberListing.groupBy({
                    by: ['route'],
                    where: { OR: [{ fromPointId: null }, { toPointId: null }] },
                    _count: { _all: true },
                    orderBy: { _count: { route: 'desc' } },
                    take: 20,
                }),
            ]);
            res.json({
                total,
                active,
                missingOd,
                missingTripRoute,
                missingEndsAt,
                routesWithoutOd: routesWithoutOd.map((r) => ({ route: r.route, count: r._count._all })),
                readyForNotNull: missingOd === 0,
            });
        }
        catch (error) {
            console.error('❌ od-identity-stats:', error);
            res.status(500).json({ error: 'Failed to compute stats' });
        }
    });
    return r;
}
