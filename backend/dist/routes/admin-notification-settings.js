"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminNotificationSettingsRouter = createAdminNotificationSettingsRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const notification_settings_1 = require("../notification-settings");
const TOKEN_HINT_PREFIX = '••••';
/** Маска замість токена — щоб не віддавати платний секрет у фронт. */
function maskSettings(s) {
    const { turboSmsToken, ...rest } = s;
    return {
        ...rest,
        hasToken: !!turboSmsToken,
        tokenHint: turboSmsToken ? TOKEN_HINT_PREFIX + turboSmsToken.slice(-4) : null,
    };
}
/** Значення токена, яке НЕ треба записувати (порожнє / маска з GET). */
function isNoopTokenValue(v) {
    if (v == null)
        return false; // null = явне очищення, це не no-op
    const s = String(v).trim();
    return s === '' || s.startsWith(TOKEN_HINT_PREFIX);
}
function createAdminNotificationSettingsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.get('/admin/notification-settings', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const s = await (0, notification_settings_1.getNotificationSettings)(prisma);
            res.json(maskSettings(s));
        }
        catch (e) {
            console.error('❌ GET /admin/notification-settings:', e);
            res.status(500).json({ error: 'Не вдалося прочитати налаштування сповіщень' });
        }
    });
    r.patch('/admin/notification-settings', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const body = (req.body ?? {});
            const patch = {};
            for (const key of [
                'smsFallbackEnabled',
                'smsMatchEnabled',
                'smsAuthorConfirmationEnabled',
                'smsBookingReminderEnabled',
                'smsInactivityReminderEnabled',
                'smsChannelPromoEnabled',
                'smsMatchTypeThreshold',
                'smsDailyCap',
                'smsMonthlyCap',
                'turboSmsSender',
            ]) {
                if (key in body)
                    patch[key] = body[key];
            }
            // Токен пишемо лише коли надіслано реальне значення (не маска, не порожньо).
            if ('turboSmsToken' in body && !isNoopTokenValue(body.turboSmsToken)) {
                patch.turboSmsToken = body.turboSmsToken == null ? null : String(body.turboSmsToken).trim();
            }
            const updated = await (0, notification_settings_1.updateNotificationSettings)(prisma, patch);
            res.json(maskSettings(updated));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Помилка налаштувань';
            console.error('[admin/notification-settings PATCH]', e);
            res.status(400).json({ error: msg });
        }
    });
    r.get('/admin/notification-settings/usage', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            const s = await (0, notification_settings_1.getNotificationSettings)(prisma);
            const [sentToday, sentThisMonth, recent] = await Promise.all([
                (0, notification_settings_1.countSmsSendsToday)(prisma),
                (0, notification_settings_1.countSmsSendsThisMonth)(prisma),
                prisma.smsSendLog.findMany({
                    orderBy: { createdAt: 'desc' },
                    take: 20,
                    select: {
                        id: true,
                        phoneNormalized: true,
                        useCase: true,
                        channel: true,
                        status: true,
                        segments: true,
                        errorText: true,
                        createdAt: true,
                        sentAt: true,
                    },
                }),
            ]);
            res.json({
                sentToday,
                capToday: s.smsDailyCap,
                sentThisMonth,
                capThisMonth: s.smsMonthlyCap,
                recent,
            });
        }
        catch (e) {
            console.error('❌ GET /admin/notification-settings/usage:', e);
            res.status(500).json({ error: 'Не вдалося прочитати статистику відправок' });
        }
    });
    return r;
}
