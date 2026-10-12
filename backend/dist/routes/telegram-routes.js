"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTelegramRoutesRouter = createTelegramRoutesRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const booking_reminders_1 = require("../booking-reminders");
const require_admin_1 = require("../middleware/require-admin");
function createTelegramRoutesRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    /**
     * Ручний запуск вечірнього нагадування (завтрашні поїздки). Щодня о 20:00 це робить таймер у процесі
     * (booking-reminders.ts); журнал BookingReminder не дає надіслати те саме двічі.
     */
    r.post('/telegram/send-reminders', require_admin_1.requireAdmin, async (_req, res) => {
        if (!(0, telegram_1.isTelegramEnabled)()) {
            return res.status(400).json({ error: 'Telegram bot не налаштовано' });
        }
        try {
            const c = await (0, booking_reminders_1.sendManualReminders)(prisma, booking_reminders_1.defaultReminderDeps, 'evening');
            res.json({
                success: true,
                message: `Нагадування: бот ${c.sent}, SMS ${c.smsSent}, помилок ${c.failed}, без каналу ${c.skipped}, уже надсилали ${c.duplicate}`,
                ...c,
            });
        }
        catch (error) {
            console.error('❌ Помилка відправки нагадувань:', error);
            res.status(500).json({ error: 'Failed to send reminders' });
        }
    });
    r.post('/telegram/fetch-group-messages', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const result = await (0, telegram_1.fetchAndImportTelegramGroupMessages)();
            if (!result.success) {
                return res.status(500).json({
                    success: false,
                    error: result.error,
                    created: 0,
                    total: 0,
                });
            }
            res.json({
                success: true,
                message: result.created > 0 ? `Імпортовано ${result.created} нових з ${result.total} повідомлень` : 'Немає нових повідомлень',
                created: result.created,
                total: result.total,
                missingGroups: result.missingGroups ?? [],
                enabledGroups: result.enabledGroups ?? [],
            });
        }
        catch (error) {
            console.error('❌ /telegram/fetch-group-messages:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch and import', created: 0, total: 0 });
        }
    });
    /** Ручний запуск ранкового нагадування (поїздки сьогодні); щодня о 08:00 це робить таймер у процесі. */
    r.post('/telegram/send-reminders-today', require_admin_1.requireAdmin, async (_req, res) => {
        if (!(0, telegram_1.isTelegramEnabled)()) {
            return res.status(400).json({ error: 'Telegram bot не налаштовано' });
        }
        try {
            const c = await (0, booking_reminders_1.sendManualReminders)(prisma, booking_reminders_1.defaultReminderDeps, 'morning');
            res.json({
                success: true,
                message: `Нагадування (сьогодні): бот ${c.sent}, SMS ${c.smsSent}, помилок ${c.failed}, без каналу ${c.skipped}, уже надсилали ${c.duplicate}`,
                ...c,
            });
        }
        catch (error) {
            console.error('❌ Помилка відправки нагадувань (сьогодні):', error);
            res.status(500).json({ error: 'Failed to send reminders (today)' });
        }
    });
    r.get('/telegram/status', require_admin_1.requireAdmin, (_req, res) => {
        res.json({
            enabled: (0, telegram_1.isTelegramEnabled)(),
            adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ? 'configured' : 'not configured',
            botToken: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured',
        });
    });
    r.get('/telegram/scenarios', (_req, res) => {
        const links = (0, telegram_1.getTelegramScenarioLinks)();
        res.json({
            enabled: (0, telegram_1.isTelegramEnabled)(),
            scenarios: {
                driver: {
                    title: 'Запит на поїздку як водій',
                    command: '/adddriverride',
                    deepLink: links.driver,
                },
                passenger: {
                    title: 'Запит на поїздку як пасажир',
                    command: '/addpassengerride',
                    deepLink: links.passenger,
                },
                view: {
                    title: 'Вільний перегляд поїздок',
                    command: '/poputky',
                    deepLink: links.view,
                    webLink: links.poputkyWeb,
                },
            },
        });
    });
    return r;
}
