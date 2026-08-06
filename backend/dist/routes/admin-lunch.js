"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminLunchRouter = createAdminLunchRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const lunch_1 = require("../lunch");
const lunch_telegram_1 = require("../lunch-telegram");
const lunch_reparse_1 = require("../lunch-reparse");
function createAdminLunchRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.get('/admin/lunch/today', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const summary = await (0, lunch_1.getLunchDaySummary)(prisma);
            res.json(summary);
        }
        catch (e) {
            console.error('[admin/lunch/today]', e);
            res.status(500).json({ error: 'Не вдалося завантажити день обідів' });
        }
    });
    /** Імпорт меню з JSON ChatGPT: { items:[{name,price}] } або raw string */
    r.post('/admin/lunch/menu', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const postToGroup = Boolean(req.body?.postToGroup);
            const rawPayload = req.body?.rawJson !== undefined
                ? req.body.rawJson
                : req.body?.items !== undefined
                    ? { items: req.body.items }
                    : req.body;
            const items = (0, lunch_1.parseLunchMenuPayload)(rawPayload);
            const parsedForStore = typeof rawPayload === 'string'
                ? (() => {
                    try {
                        return JSON.parse(rawPayload);
                    }
                    catch {
                        return { items };
                    }
                })()
                : rawPayload;
            const { day, menuItems } = await (0, lunch_1.upsertLunchMenuForToday)(prisma, items, parsedForStore);
            const text = (0, lunch_1.formatLunchMenuText)(menuItems);
            let posted = false;
            let queued = false;
            let postError = null;
            if (postToGroup) {
                try {
                    const result = await (0, lunch_telegram_1.postTextToLunchGroup)(prisma, text);
                    posted = result.ok && !result.queued;
                    queued = result.queued;
                    if (!result.ok) {
                        postError = result.error || 'Не вдалося надіслати в групу';
                    }
                }
                catch (e) {
                    postError = e instanceof Error ? e.message : String(e);
                }
            }
            res.json({
                ok: true,
                day: {
                    id: day.id,
                    date: day.date.toISOString().slice(0, 10),
                    status: day.status,
                },
                menuItems,
                preview: text,
                posted,
                queued,
                postError,
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Помилка імпорту меню';
            console.error('[admin/lunch/menu]', e);
            res.status(400).json({ error: msg });
        }
    });
    r.post('/admin/lunch/status', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const status = String(req.body?.status || '').trim();
            if (!['open', 'ordering', 'closed'].includes(status)) {
                res.status(400).json({ error: 'status: open | ordering | closed' });
                return;
            }
            const date = (0, lunch_1.todayKyivDate)();
            const day = await prisma.lunchDay.upsert({
                where: { date },
                create: { date, status },
                update: { status, updatedAt: new Date() },
            });
            res.json({
                ok: true,
                day: { id: day.id, date: day.date.toISOString().slice(0, 10), status: day.status },
            });
        }
        catch (e) {
            console.error('[admin/lunch/status]', e);
            res.status(500).json({ error: 'Не вдалося оновити статус' });
        }
    });
    /** Повторно надіслати поточне меню в групу */
    r.post('/admin/lunch/post-menu', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const summary = await (0, lunch_1.getLunchDaySummary)(prisma);
            if (!summary.menuItems.length) {
                res.status(400).json({ error: 'Меню на сьогодні порожнє' });
                return;
            }
            const text = (0, lunch_1.formatLunchMenuText)(summary.menuItems);
            const result = await (0, lunch_telegram_1.postTextToLunchGroup)(prisma, text);
            res.json({
                ok: result.ok,
                queued: result.queued,
                preview: text,
                postError: result.ok ? null : result.error || 'Не вдалося надіслати',
            });
        }
        catch (e) {
            console.error('[admin/lunch/post-menu]', e);
            res.status(500).json({ error: e instanceof Error ? e.message : 'Помилка посту' });
        }
    });
    /** Знову розібрати повідомлення групи за сьогодні (замовлення / оплати / підсумок) */
    r.post('/admin/lunch/reparse', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const result = await (0, lunch_reparse_1.reparseLunchToday)(prisma);
            if (!result.ok) {
                res.status(500).json({ error: result.error || 'Reparse failed', ...result });
                return;
            }
            const summary = await (0, lunch_1.getLunchDaySummary)(prisma);
            res.json({ ok: true, reparse: result, summary });
        }
        catch (e) {
            console.error('[admin/lunch/reparse]', e);
            res.status(500).json({ error: e instanceof Error ? e.message : 'Помилка reparse' });
        }
    });
    /** Позначити оплату (за замовч. — весь борг учасника) */
    r.post('/admin/lunch/pay', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const participantId = Number(req.body?.participantId);
            const amountRaw = req.body?.amountUah;
            const amountUah = amountRaw === undefined || amountRaw === null || amountRaw === ''
                ? undefined
                : Number(amountRaw);
            if (!Number.isFinite(participantId) || participantId <= 0) {
                res.status(400).json({ error: 'participantId обовʼязковий' });
                return;
            }
            const pay = await (0, lunch_1.recordLunchPayment)(prisma, {
                participantId,
                amountUah,
                rawText: 'admin',
            });
            const summary = await (0, lunch_1.getLunchDaySummary)(prisma);
            res.json({ ok: true, payment: pay, summary });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Помилка оплати';
            console.error('[admin/lunch/pay]', e);
            res.status(400).json({ error: msg });
        }
    });
    /**
     * Ручне редагування замовлення: замінити рядки на позиції меню,
     * оновити unmatchedText. rawText (оригінал) не змінюється.
     */
    r.patch('/admin/lunch/orders/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            if (!Number.isFinite(orderId) || orderId <= 0) {
                res.status(400).json({ error: 'Некоректний id замовлення' });
                return;
            }
            const menuItemIds = Array.isArray(req.body?.menuItemIds)
                ? req.body.menuItemIds.map((x) => Number(x))
                : [];
            const unmatchedText = req.body?.unmatchedText === undefined ? undefined : req.body.unmatchedText;
            await (0, lunch_1.updateLunchOrder)(prisma, orderId, { menuItemIds, unmatchedText });
            const summary = await (0, lunch_1.getLunchDaySummary)(prisma);
            res.json({ ok: true, summary });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Помилка оновлення замовлення';
            console.error('[admin/lunch/orders]', e);
            res.status(400).json({ error: msg });
        }
    });
    /** Пост «підсумку» в групу: імʼя, страви, сума (без судочків) */
    r.post('/admin/lunch/post-totals', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const summary = await (0, lunch_1.getLunchDaySummary)(prisma);
            if (!summary.orders.length) {
                res.status(400).json({ error: 'Немає замовлень на сьогодні' });
                return;
            }
            const text = (0, lunch_1.formatLunchTotalsComment)(summary.orders);
            const result = await (0, lunch_telegram_1.postTextToLunchGroup)(prisma, text);
            res.json({
                ok: result.ok,
                queued: result.queued,
                preview: text,
                postError: result.ok ? null : result.error || 'Не вдалося надіслати',
            });
        }
        catch (e) {
            console.error('[admin/lunch/post-totals]', e);
            res.status(500).json({ error: e instanceof Error ? e.message : 'Помилка посту' });
        }
    });
    return r;
}
