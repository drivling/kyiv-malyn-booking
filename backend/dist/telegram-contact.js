"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TECHNICAL_PHONE_PREFIX = void 0;
exports.normalizeTelegramUsername = normalizeTelegramUsername;
exports.formatTelegramUsernameForDisplay = formatTelegramUsernameForDisplay;
exports.isTelegramUsernameContact = isTelegramUsernameContact;
exports.isTechnicalPlaceholderPhone = isTechnicalPlaceholderPhone;
exports.telegramUsernameToProfileUrl = telegramUsernameToProfileUrl;
exports.formatTelegramContactHtmlLink = formatTelegramContactHtmlLink;
/** First technical placeholder phone for persons known only by Telegram @username. */
exports.TECHNICAL_PHONE_PREFIX = '380010000000';
/** Telegram @username: 5–32 chars, letter first, then letters/digits/underscore. */
const TELEGRAM_USERNAME_RE = /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
function normalizeTelegramUsername(raw) {
    return raw.trim().replace(/^@/, '');
}
function formatTelegramUsernameForDisplay(raw) {
    const username = normalizeTelegramUsername(raw);
    return username ? `@${username}` : '';
}
function isTelegramUsernameContact(value) {
    if (!value?.trim())
        return false;
    return TELEGRAM_USERNAME_RE.test(value.trim());
}
/** Placeholder phones allocated for username-only contacts (380010000000, 380010000001, …). */
function isTechnicalPlaceholderPhone(phone) {
    if (!phone?.trim())
        return false;
    const digits = phone.replace(/\D/g, '');
    return digits.startsWith('3800100') && digits.length === 12;
}
/** Public t.me profile link (https://t.me/username, without @). */
function telegramUsernameToProfileUrl(username) {
    const normalized = normalizeTelegramUsername(username);
    return normalized ? `https://t.me/${normalized}` : '';
}
function formatTelegramContactHtmlLink(value) {
    const username = normalizeTelegramUsername(value);
    const display = `@${username}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<a href="${telegramUsernameToProfileUrl(username)}">${display}</a>`;
}
