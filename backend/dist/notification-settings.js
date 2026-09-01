"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATION_SETTINGS_DEFAULTS = exports.SMS_MATCH_TYPE_THRESHOLDS = void 0;
exports.setNotificationSettingsCacheForTests = setNotificationSettingsCacheForTests;
exports.getNotificationSettings = getNotificationSettings;
exports.updateNotificationSettings = updateNotificationSettings;
exports.countSmsSendsToday = countSmsSendsToday;
exports.countSmsSendsThisMonth = countSmsSendsThisMonth;
exports.SMS_MATCH_TYPE_THRESHOLDS = [
    'exact',
    'exact_approximate',
    'all',
];
exports.NOTIFICATION_SETTINGS_DEFAULTS = {
    smsFallbackEnabled: false,
    smsMatchEnabled: false,
    smsAuthorConfirmationEnabled: false,
    smsBookingReminderEnabled: false,
    smsInactivityReminderEnabled: false,
    smsChannelPromoEnabled: false,
    smsMatchTypeThreshold: 'exact',
    smsDailyCap: 50,
    smsMonthlyCap: 1000,
    turboSmsToken: null,
    turboSmsSender: null,
};
const CAP_MAX = 100000;
const CACHE_TTL_MS = 30000;
let cache = null;
/** Тільки для тестів: підмінити/скинути кеш налаштувань. */
function setNotificationSettingsCacheForTests(value) {
    cache = value ? { value, expiresAt: Number.MAX_SAFE_INTEGER } : null;
}
/**
 * Поточні налаштування (лінива ініціалізація рядка). Кешуються на 30 с, щоб гарячий
 * шлях (цикл по парах/бронюваннях) не бив у БД щоразу; правки з адмінки застосуються
 * протягом 30 с.
 */
async function getNotificationSettings(prisma) {
    if (cache && cache.expiresAt > Date.now())
        return cache.value;
    const value = await prisma.notificationSettings.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
    });
    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
}
function coerceBool(v, field) {
    if (typeof v === 'boolean')
        return v;
    if (v === 'true' || v === 1 || v === '1')
        return true;
    if (v === 'false' || v === 0 || v === '0')
        return false;
    throw new Error(`${field}: очікується boolean`);
}
function coerceCap(v, field) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > CAP_MAX) {
        throw new Error(`${field}: ціле число від 0 до ${CAP_MAX}`);
    }
    return n;
}
/**
 * Оновлення налаштувань. `turboSmsToken` записується лише коли переданий непорожній
 * рядок без маски (див. admin-роут). Після запису кеш скидається.
 */
async function updateNotificationSettings(prisma, patch) {
    const data = {};
    if ('smsFallbackEnabled' in patch)
        data.smsFallbackEnabled = coerceBool(patch.smsFallbackEnabled, 'smsFallbackEnabled');
    if ('smsMatchEnabled' in patch)
        data.smsMatchEnabled = coerceBool(patch.smsMatchEnabled, 'smsMatchEnabled');
    if ('smsAuthorConfirmationEnabled' in patch)
        data.smsAuthorConfirmationEnabled = coerceBool(patch.smsAuthorConfirmationEnabled, 'smsAuthorConfirmationEnabled');
    if ('smsBookingReminderEnabled' in patch)
        data.smsBookingReminderEnabled = coerceBool(patch.smsBookingReminderEnabled, 'smsBookingReminderEnabled');
    if ('smsInactivityReminderEnabled' in patch)
        data.smsInactivityReminderEnabled = coerceBool(patch.smsInactivityReminderEnabled, 'smsInactivityReminderEnabled');
    if ('smsChannelPromoEnabled' in patch)
        data.smsChannelPromoEnabled = coerceBool(patch.smsChannelPromoEnabled, 'smsChannelPromoEnabled');
    if ('smsMatchTypeThreshold' in patch) {
        const t = String(patch.smsMatchTypeThreshold);
        if (!exports.SMS_MATCH_TYPE_THRESHOLDS.includes(t)) {
            throw new Error(`smsMatchTypeThreshold: одне з ${exports.SMS_MATCH_TYPE_THRESHOLDS.join(' | ')}`);
        }
        data.smsMatchTypeThreshold = t;
    }
    if ('smsDailyCap' in patch)
        data.smsDailyCap = coerceCap(patch.smsDailyCap, 'smsDailyCap');
    if ('smsMonthlyCap' in patch)
        data.smsMonthlyCap = coerceCap(patch.smsMonthlyCap, 'smsMonthlyCap');
    if ('turboSmsSender' in patch) {
        const raw = patch.turboSmsSender;
        if (raw == null || String(raw).trim() === '') {
            data.turboSmsSender = null;
        }
        else {
            const s = String(raw).trim();
            if (s.length > 11)
                throw new Error('turboSmsSender: не більше 11 символів (альфа-ім’я)');
            data.turboSmsSender = s;
        }
    }
    if ('turboSmsToken' in patch) {
        const raw = patch.turboSmsToken;
        // null → явне очищення; порожній рядок сюди не потрапляє (роут його відкидає)
        data.turboSmsToken = raw == null ? null : String(raw).trim() || null;
    }
    const value = await prisma.notificationSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
    });
    cache = null;
    return value;
}
function kyivMonthStart() {
    const s = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    const [y, m] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
}
function kyivDayStart() {
    const s = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}
/** Скільки платних відправок уже зроблено сьогодні (Київ). Рахуємо pending+sent. */
async function countSmsSendsToday(prisma) {
    return prisma.smsSendLog.count({
        where: { createdAt: { gte: kyivDayStart() }, status: { in: ['pending', 'sent'] } },
    });
}
/** Скільки платних відправок уже зроблено цього місяця (Київ). */
async function countSmsSendsThisMonth(prisma) {
    return prisma.smsSendLog.count({
        where: { createdAt: { gte: kyivMonthStart() }, status: { in: ['pending', 'sent'] } },
    });
}
