"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminNotificationSettingsRouter = createAdminNotificationSettingsRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const notification_settings_1 = require("../notification-settings");
const telegram_user_dm_guard_1 = require("../telegram-user-dm-guard");
/** Рядки groupBy → { ключ: { sent, failed } } */
function tally(rows, key) {
    var _a;
    const out = {};
    for (const r of rows) {
        const t = (out[_a = r[key]] ?? (out[_a] = { sent: 0, failed: 0 }));
        const ok = r.ok ?? (r.status === 'sent' || r.status === 'pending');
        if (ok)
            t.sent += r._count._all;
        else if (r.ok === false || r.status === 'failed')
            t.failed += r._count._all;
    }
    return out;
}
const sum = (m) => Object.values(m).reduce((a, t) => ({ sent: a.sent + t.sent, failed: a.failed + t.failed }), { sent: 0, failed: 0 });
/** Сесія особистого акаунта налаштована (те саме правило, що в telegram.ts) */
const telegramUserConfigured = () => Boolean(process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim());
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
                'tgUserMatchEnabled',
                'tgUserAuthorConfirmationEnabled',
                'tgUserByIdEnabled',
                'tgUserByIdDailyCap',
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
            const dayStart = (0, notification_settings_1.kyivDayStart)();
            const monthStart = (0, notification_settings_1.kyivMonthStart)();
            const [sentToday, sentThisMonth, recent, smsMonth, tgToday, tgMonth, tgErrors] = await Promise.all([
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
                prisma.smsSendLog.groupBy({ by: ['useCase', 'status'], where: { createdAt: { gte: monthStart } }, _count: { _all: true } }),
                prisma.telegramUserSendLog.groupBy({ by: ['purpose', 'ok'], where: { createdAt: { gte: dayStart } }, _count: { _all: true } }),
                prisma.telegramUserSendLog.groupBy({ by: ['purpose', 'ok'], where: { createdAt: { gte: monthStart } }, _count: { _all: true } }),
                // без контакту: лише коли, як шукали і що відповів Telegram
                prisma.telegramUserSendError.findMany({
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: { id: true, contactType: true, errorCode: true, errorText: true, createdAt: true },
                }),
            ]);
            const byPurposeMonth = tally(tgMonth, 'purpose');
            const limits = (0, telegram_user_dm_guard_1.idDmLimits)(s);
            res.json({
                sentToday,
                capToday: s.smsDailyCap,
                sentThisMonth,
                capThisMonth: s.smsMonthlyCap,
                recent,
                smsByUseCase: tally(smsMonth, 'useCase'),
                telegramUser: {
                    configured: telegramUserConfigured(),
                    today: sum(tally(tgToday, 'purpose')),
                    month: sum(byPurposeMonth),
                    byPurpose: byPurposeMonth,
                    byId: {
                        enabled: limits.enabled,
                        lockedBy: limits.lockedBy,
                        cap: limits.cap,
                        defaultCap: limits.defaultCap,
                        usedToday: telegram_user_dm_guard_1.idDmGuard.used(),
                        flooded: telegram_user_dm_guard_1.idDmGuard.tripped(),
                    },
                    recentErrors: tgErrors.map((e) => ({ ...e, errorText: (e.errorText ?? '').split('\n').filter(Boolean).pop()?.slice(0, 200) ?? null })),
                },
            });
        }
        catch (e) {
            console.error('❌ GET /admin/notification-settings/usage:', e);
            res.status(500).json({ error: 'Не вдалося прочитати статистику відправок' });
        }
    });
    return r;
}
