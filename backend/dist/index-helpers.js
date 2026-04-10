"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMO_NOT_FOUND_SENTINEL = exports.noTelegramCondition = exports.hasTelegramReminderBaseCondition = void 0;
exports.mapFromToToRoute = mapFromToToRoute;
exports.hasNonEmptyText = hasNonEmptyText;
exports.mergeTextField = mergeTextField;
exports.mergeSenderName = mergeSenderName;
exports.mergeRawMessage = mergeRawMessage;
exports.serializeViberListing = serializeViberListing;
exports.getViberListingEndDateTime = getViberListingEndDateTime;
exports.getTelegramReminderWhere = getTelegramReminderWhere;
exports.getChannelPromoWhere = getChannelPromoWhere;
exports.getScenarioKeysForProfile = getScenarioKeysForProfile;
/**
 * Чиста логіка, винесена з index.ts для юніт-тестів без підняття HTTP-сервера.
 */
const telegram_1 = require("./telegram");
/** Маппінг "звідки–куди" (сайт) → route (бот). Значення: malyn, kyiv, zhytomyr, korosten */
function mapFromToToRoute(from, to) {
    const f = (from || '').toLowerCase().trim();
    const t = (to || '').toLowerCase().trim();
    if (f === 'kyiv' && t === 'malyn')
        return 'Kyiv-Malyn';
    if (f === 'malyn' && t === 'kyiv')
        return 'Malyn-Kyiv';
    if (f === 'zhytomyr' && t === 'malyn')
        return 'Zhytomyr-Malyn';
    if (f === 'malyn' && t === 'zhytomyr')
        return 'Malyn-Zhytomyr';
    if (f === 'korosten' && t === 'malyn')
        return 'Korosten-Malyn';
    if (f === 'malyn' && t === 'korosten')
        return 'Malyn-Korosten';
    return null;
}
function hasNonEmptyText(value) {
    return !!value && value.trim().length > 0;
}
function mergeTextField(oldVal, newVal) {
    if (!hasNonEmptyText(newVal))
        return oldVal;
    if (!hasNonEmptyText(oldVal))
        return newVal;
    const oldTrim = oldVal.trim();
    const newTrim = newVal.trim();
    if (oldTrim === newTrim)
        return oldVal;
    if (newTrim.length > oldTrim.length && !oldTrim.includes(newTrim)) {
        return `${oldTrim} | ${newTrim}`;
    }
    return oldVal;
}
function mergeSenderName(oldVal, newVal) {
    if (!hasNonEmptyText(oldVal) && hasNonEmptyText(newVal))
        return newVal;
    return oldVal;
}
function mergeRawMessage(oldRaw, newRaw) {
    const oldTrim = (oldRaw || '').trim();
    const newTrim = (newRaw || '').trim();
    if (!newTrim)
        return oldRaw;
    if (!oldTrim)
        return newRaw;
    if (oldTrim.includes(newTrim))
        return oldRaw;
    if (newTrim.includes(oldTrim))
        return newRaw;
    return `${oldRaw}\n---\n${newRaw}`;
}
/** Серіалізація Viber listing для JSON (дати в ISO рядок) */
function serializeViberListing(row) {
    return {
        ...row,
        date: row.date instanceof Date ? row.date.toISOString() : row.date,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
}
/** «Дата по» для оголошення: дата поїздки + кінець часу (діапазон → кінець інтервалу). */
function getViberListingEndDateTime(date, departureTime) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const t = (departureTime ?? '').trim();
    if (!t) {
        d.setHours(23, 59, 0, 0);
        return d;
    }
    const rangeMatch = t.match(/^\d{1,2}:\d{2}-(\d{1,2}):(\d{2})$/);
    const singleMatch = t.match(/^(\d{1,2}):(\d{2})$/);
    const timeStr = rangeMatch
        ? `${rangeMatch[1]}:${rangeMatch[2]}`
        : singleMatch
            ? `${singleMatch[1]}:${singleMatch[2]}`
            : null;
    if (timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        d.setHours(h, m, 0, 0);
        return d;
    }
    d.setHours(23, 59, 0, 0);
    return d;
}
exports.hasTelegramReminderBaseCondition = {
    telegramChatId: {
        not: null,
    },
    NOT: [{ telegramChatId: '' }, { telegramChatId: '0' }],
};
const TELEGRAM_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
function getTelegramReminderWhere(filter) {
    if (filter === 'no_active_viber') {
        return {
            ...exports.hasTelegramReminderBaseCondition,
            viberListings: {
                none: {
                    isActive: true,
                },
            },
        };
    }
    if (filter === 'no_reminder_7_days') {
        const sevenDaysAgo = new Date(Date.now() - TELEGRAM_REMINDER_COOLDOWN_MS);
        return {
            ...exports.hasTelegramReminderBaseCondition,
            OR: [{ telegramReminderSentAt: null }, { telegramReminderSentAt: { lt: sevenDaysAgo } }],
        };
    }
    return exports.hasTelegramReminderBaseCondition;
}
exports.noTelegramCondition = {
    OR: [{ telegramChatId: null }, { telegramChatId: '' }, { telegramChatId: '0' }],
};
/** Маркер: пробували промо, номер не знайдено в Telegram */
exports.PROMO_NOT_FOUND_SENTINEL = new Date(0);
function getChannelPromoWhere(filter) {
    if (filter === 'no_communication') {
        return { ...exports.noTelegramCondition, telegramPromoSentAt: null };
    }
    if (filter === 'promo_not_found') {
        return { ...exports.noTelegramCondition, telegramPromoSentAt: exports.PROMO_NOT_FOUND_SENTINEL };
    }
    return exports.noTelegramCondition;
}
function getScenarioKeysForProfile(profileRole) {
    const keys = [
        'driver_passengers',
        'driver_autocreate',
        'passenger_notify',
        'passenger_quick',
        'mixed_unified',
        'mixed_both',
    ];
    return keys.filter((k) => telegram_1.BEHAVIOR_PROMO_SCENARIO_PROFILES[k].includes(profileRole));
}
