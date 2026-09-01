"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchTypePassesThreshold = matchTypePassesThreshold;
exports.sendPaidFallbackSms = sendPaidFallbackSms;
const notification_settings_1 = require("./notification-settings");
const sms_turbosms_1 = require("./sms-turbosms");
/** Локальна копія normalizePhone (уникаємо circular import із telegram.ts). */
function normalizePhone(phone) {
    let cleaned = (phone || '').replace(/\D/g, '');
    if (cleaned.startsWith('0'))
        cleaned = '38' + cleaned;
    return cleaned;
}
const USE_CASE_FLAG = {
    match: 'smsMatchEnabled',
    authorConfirmation: 'smsAuthorConfirmationEnabled',
    bookingReminder: 'smsBookingReminderEnabled',
    inactivityReminder: 'smsInactivityReminderEnabled',
    channelPromo: 'smsChannelPromoEnabled',
};
/** Чи проходить тип збігу поточний поріг. */
function matchTypePassesThreshold(matchType, threshold) {
    if (threshold === 'all')
        return true;
    if (threshold === 'exact_approximate')
        return matchType === 'exact' || matchType === 'approximate';
    return matchType === 'exact';
}
async function sendPaidFallbackSms(prisma, args) {
    const { phone, text, useCase, matchType, context } = args;
    const phoneNormalized = normalizePhone(phone);
    // Збій читання налаштувань не має ламати безкоштовний цикл сповіщень.
    let settings;
    try {
        settings = await (0, notification_settings_1.getNotificationSettings)(prisma);
    }
    catch (e) {
        console.error('[sms-fallback] getNotificationSettings failed:', e);
        return { sent: false, via: 'none', reason: 'settings_unavailable' };
    }
    if (!settings.smsFallbackEnabled)
        return { sent: false, via: 'none', reason: 'master_off' };
    if (!settings[USE_CASE_FLAG[useCase]])
        return { sent: false, via: 'none', reason: 'usecase_off' };
    if (useCase === 'match') {
        const mt = matchType ?? 'same_day';
        if (!matchTypePassesThreshold(mt, settings.smsMatchTypeThreshold)) {
            return { sent: false, via: 'none', reason: 'matchtype_below_threshold' };
        }
    }
    if (!settings.turboSmsToken || !settings.turboSmsSender) {
        return { sent: false, via: 'none', reason: 'no_credentials' };
    }
    if (!phoneNormalized || phoneNormalized.length < 11) {
        return { sent: false, via: 'none', reason: 'bad_phone' };
    }
    const person = await prisma.person
        .findUnique({ where: { phoneNormalized }, select: { smsOptOut: true } })
        .catch(() => null);
    if (person?.smsOptOut)
        return { sent: false, via: 'none', reason: 'opted_out' };
    // Дедуп по контексту — крім match (у нього власний дедуп через ViberMatchPairNotification).
    if (context && useCase !== 'match') {
        const existing = await prisma.smsSendLog.findFirst({
            where: {
                contextType: context.type,
                contextId: context.id,
                useCase,
                status: { in: ['pending', 'sent'] },
            },
            select: { id: true },
        });
        if (existing)
            return { sent: false, via: 'none', reason: 'already_sent' };
    }
    if ((await (0, notification_settings_1.countSmsSendsToday)(prisma)) >= settings.smsDailyCap) {
        return { sent: false, via: 'none', reason: 'daily_cap' };
    }
    if ((await (0, notification_settings_1.countSmsSendsThisMonth)(prisma)) >= settings.smsMonthlyCap) {
        return { sent: false, via: 'none', reason: 'monthly_cap' };
    }
    const segments = (0, sms_turbosms_1.estimateSmsSegments)(text);
    const log = await prisma.smsSendLog.create({
        data: {
            phoneNormalized,
            useCase,
            provider: 'turbosms',
            channel: 'sms',
            status: 'pending',
            segments,
            contextType: context?.type ?? null,
            contextId: context?.id ?? null,
        },
        select: { id: true },
    });
    const r = await (0, sms_turbosms_1.sendSms)(phone, text, {
        token: settings.turboSmsToken,
        sender: settings.turboSmsSender,
    });
    await prisma.smsSendLog
        .update({
        where: { id: log.id },
        data: {
            status: r.sent ? 'sent' : 'failed',
            providerMessageId: r.providerMessageId ?? null,
            errorText: r.error ?? null,
            sentAt: r.sent ? new Date() : null,
        },
    })
        .catch(() => { });
    return r.sent
        ? { sent: true, via: 'sms', providerMessageId: r.providerMessageId }
        : { sent: false, via: 'none', reason: r.error ?? 'provider_failed' };
}
