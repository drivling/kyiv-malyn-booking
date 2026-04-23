"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminMessagingRouter = createAdminMessagingRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const index_helpers_1 = require("../index-helpers");
const require_admin_1 = require("../middleware/require-admin");
const telegram_bot_blocked_1 = require("../telegram-bot-blocked");
const revoke_telegram_bot_1 = require("../revoke-telegram-bot");
function buildChannelPromoMessage() {
    const links = (0, telegram_1.getTelegramScenarioLinks)();
    return `
📢 <b>Поїздки Київ ↔ Малин ↔ Житомир ↔ Коростень</b>

Підпишіться на наш бот — бронювання маршруток та попуток у один клік:
• як водій: ${links.driver}
• як пасажир: ${links.passenger}

Сайт: <a href="https://malin.kiev.ua">malin.kiev.ua</a>
  `.trim();
}
function createAdminMessagingRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    /** Список Person для Telegram-нагадувань (база = з ботом). Query: ?filter=all|no_active_viber|no_reminder_7_days */
    r.get('/admin/telegram-reminder-persons', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const filter = req.query.filter?.trim() || 'all';
            const where = (0, index_helpers_1.getTelegramReminderWhere)(filter);
            const persons = await prisma.person.findMany({
                where,
                select: {
                    id: true,
                    phoneNormalized: true,
                    fullName: true,
                    telegramChatId: true,
                    telegramReminderSentAt: true,
                },
                orderBy: { id: 'asc' },
            });
            res.json(persons.map((p) => ({
                id: p.id,
                phoneNormalized: p.phoneNormalized,
                fullName: p.fullName,
                telegramReminderSentAt: p.telegramReminderSentAt ? p.telegramReminderSentAt.toISOString() : null,
            })));
        }
        catch (e) {
            console.error('❌ telegram-reminder-persons:', e);
            res.status(500).json({ error: 'Failed to load telegram reminder persons' });
        }
    });
    /** Помилки відправки через персональний акаунт (PRIVACY_PREMIUM_REQUIRED тощо) */
    r.get('/admin/telegram-user-send-errors', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const rows = await prisma.telegramUserSendError.findMany({
                orderBy: { createdAt: 'desc' },
                take: 200,
            });
            res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
        }
        catch (e) {
            console.error('❌ telegram-user-send-errors:', e);
            res.status(500).json({ error: 'Не вдалося завантажити помилки' });
        }
    });
    /** Обнулити таблицю помилок user-sender */
    r.delete('/admin/telegram-user-send-errors', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const result = await prisma.telegramUserSendError.deleteMany({});
            res.json({ deleted: result.count });
        }
        catch (e) {
            console.error('❌ DELETE telegram-user-send-errors:', e);
            res.status(500).json({ error: 'Не вдалося обнулити' });
        }
    });
    /** Відправити Telegram-нагадування неактивним користувачам. Body: { filter?, limit?, delaysMs? } */
    r.post('/admin/send-telegram-reminders', require_admin_1.requireAdmin, async (req, res) => {
        if (!(0, telegram_1.isTelegramEnabled)()) {
            return res.status(400).json({ error: 'Telegram bot не налаштовано' });
        }
        try {
            const filter = req.body?.filter?.trim() || 'all';
            if (!['all', 'no_active_viber', 'no_reminder_7_days'].includes(filter)) {
                res.status(400).json({ error: 'Invalid filter' });
                return;
            }
            const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
            const delaysMs = Array.isArray(req.body?.delaysMs)
                ? req.body.delaysMs.filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
                : undefined;
            const where = (0, index_helpers_1.getTelegramReminderWhere)(filter);
            let persons = await prisma.person.findMany({
                where,
                select: { id: true, phoneNormalized: true, fullName: true, telegramChatId: true },
                orderBy: { id: 'asc' },
            });
            if (limit !== undefined) {
                persons = persons.slice(0, limit);
            }
            let sent = 0;
            let failed = 0;
            const blocked = [];
            for (let i = 0; i < persons.length; i++) {
                const p = persons[i];
                const chatId = p.telegramChatId;
                if (!chatId || chatId === '0' || !chatId.trim()) {
                    failed++;
                }
                else {
                    try {
                        await (0, telegram_1.sendInactivityReminder)(chatId);
                        sent++;
                        await prisma.person.update({
                            where: { id: p.id },
                            data: { telegramReminderSentAt: new Date() },
                        });
                    }
                    catch (err) {
                        const isBlocked = (0, telegram_bot_blocked_1.isTelegramBotBlockedByUserError)(err);
                        if (isBlocked) {
                            blocked.push({ id: p.id, phoneNormalized: p.phoneNormalized, fullName: p.fullName });
                            try {
                                await (0, revoke_telegram_bot_1.revokeTelegramBotForPerson)(prisma, p.id);
                            }
                            catch (clearErr) {
                                console.error(`❌ revokeTelegramBotForPerson person #${p.id}:`, clearErr);
                            }
                        }
                        console.error(`❌ send-telegram-reminders person #${p.id}:`, err);
                        failed++;
                    }
                }
                if (delaysMs?.length && i < persons.length - 1) {
                    const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
                    if (delayMs > 0) {
                        await new Promise((r) => setTimeout(r, delayMs));
                    }
                }
            }
            const total = persons.length;
            const message = `Нагадування відправлено: ${sent}, помилок: ${failed}, всього в вибірці: ${total}${blocked.length > 0 ? `; заблокували бота: ${blocked.length}` : ''}`;
            console.log(`📢 Telegram reminders (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent}, failed=${failed}, blocked=${blocked.length}, total=${total}`);
            res.json({ success: true, total, sent, failed, message, blocked });
        }
        catch (e) {
            console.error('❌ send-telegram-reminders:', e);
            res.status(500).json({ error: 'Failed to send telegram reminders' });
        }
    });
    /** Нагадати від особистого акаунта тим, хто заблокував бота. Body: { phones: string[], delaysSec?: number[] }. */
    r.post('/admin/send-reminder-via-user-account', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const phones = Array.isArray(req.body?.phones) ? req.body.phones.map((p) => String(p).trim()).filter(Boolean) : [];
            if (phones.length === 0) {
                return res.status(400).json({ error: 'Потрібен масив phones' });
            }
            const delaysSec = Array.isArray(req.body?.delaysSec)
                ? req.body.delaysSec.filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120))
                : [2, 15, 25, 30];
            const delaysMs = delaysSec.length > 0 ? delaysSec.map((s) => s * 1000) : [];
            const message = (0, telegram_1.buildInactivityReminderMessage)();
            let sent = 0;
            let failed = 0;
            for (let i = 0; i < phones.length; i++) {
                const rawPhone = phones[i];
                const phone = (0, telegram_1.normalizePhone)(rawPhone);
                if (!phone) {
                    failed++;
                }
                else {
                    const person = await (0, telegram_1.getPersonByPhone)(phone);
                    const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, message, {
                        telegramUsername: person?.telegramUsername ?? undefined,
                    });
                    if (ok)
                        sent++;
                    else
                        failed++;
                }
                if (delaysMs.length > 0 && i < phones.length - 1) {
                    const delayMs = delaysMs[i % delaysMs.length] ?? 30000;
                    await new Promise((r) => setTimeout(r, delayMs));
                }
            }
            const resultMessage = `Відправлено від вашого імені: ${sent}, помилок: ${failed}`;
            console.log(`📢 Reminder via user account: ${sent} sent, ${failed} failed`);
            res.json({ success: true, sent, failed, message: resultMessage });
        }
        catch (e) {
            console.error('❌ send-reminder-via-user-account:', e);
            res.status(500).json({ error: 'Failed to send reminder via user account' });
        }
    });
    /** Список Person для реклами каналу (база = без бота). Query: ?filter=no_telegram|no_communication|promo_not_found */
    r.get('/admin/channel-promo-persons', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const filter = req.query.filter?.trim() || 'no_telegram';
            const where = (0, index_helpers_1.getChannelPromoWhere)(filter);
            const persons = await prisma.person.findMany({
                where,
                select: { id: true, phoneNormalized: true, fullName: true },
                orderBy: { id: 'asc' },
            });
            res.json(persons);
        }
        catch (e) {
            console.error('❌ channel-promo-persons:', e);
            res.status(500).json({ error: 'Failed to load persons' });
        }
    });
    /** Відправити рекламу каналу. Body: { filter?, limit?, delaysMs? }. limit — лише перші N; delaysMs — паузи в мс між відправками [після 1-го, після 2-го, ...]. */
    r.post('/admin/send-channel-promo', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const filter = req.body?.filter?.trim() || 'no_telegram';
            if (!['no_telegram', 'no_communication', 'promo_not_found'].includes(filter)) {
                res.status(400).json({ error: 'Invalid filter' });
                return;
            }
            const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
            const delaysMs = Array.isArray(req.body?.delaysMs)
                ? req.body.delaysMs.filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
                : undefined;
            const where = (0, index_helpers_1.getChannelPromoWhere)(filter);
            let persons = await prisma.person.findMany({
                where,
                select: { id: true, phoneNormalized: true, fullName: true, telegramUsername: true },
                orderBy: { id: 'asc' },
            });
            if (limit !== undefined) {
                persons = persons.slice(0, limit);
            }
            const message = buildChannelPromoMessage();
            const sent = [];
            const notFound = [];
            for (let i = 0; i < persons.length; i++) {
                const p = persons[i];
                const phone = (0, telegram_1.normalizePhone)(p.phoneNormalized);
                if (!phone)
                    continue;
                const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, message, {
                    telegramUsername: p.telegramUsername ?? undefined,
                });
                if (ok) {
                    sent.push({ phone: p.phoneNormalized, fullName: p.fullName });
                    await prisma.person.update({
                        where: { id: p.id },
                        data: { telegramPromoSentAt: new Date() },
                    });
                }
                else {
                    notFound.push({ phone: p.phoneNormalized, fullName: p.fullName });
                    await prisma.person.update({
                        where: { id: p.id },
                        data: { telegramPromoSentAt: index_helpers_1.PROMO_NOT_FOUND_SENTINEL },
                    });
                }
                if (delaysMs?.length && i < persons.length - 1) {
                    const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
                    if (delayMs > 0)
                        await new Promise((r) => setTimeout(r, delayMs));
                }
            }
            console.log(`📢 Channel promo (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent.length}, notFound=${notFound.length}`);
            res.json({ sent, notFound });
        }
        catch (e) {
            console.error('❌ send-channel-promo:', e);
            res.status(500).json({ error: 'Failed to send channel promo' });
        }
    });
    return r;
}
