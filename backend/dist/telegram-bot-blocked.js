"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramOutboundErrorText = telegramOutboundErrorText;
exports.isTelegramBotBlockedByUserError = isTelegramBotBlockedByUserError;
/**
 * Detect Telegram Bot API failures where the user blocked the bot (or equivalent: no DM possible).
 * Used after outbound bot.sendMessage to clear stale chat bindings.
 */
function telegramOutboundErrorText(err) {
    if (err instanceof Error)
        return `${err.name}: ${err.message}`;
    return String(err ?? '');
}
function isTelegramBotBlockedByUserError(err) {
    const msg = telegramOutboundErrorText(err).toLowerCase();
    if (!msg)
        return false;
    if (msg.includes('blocked by the user'))
        return true;
    if (msg.includes('bot was blocked'))
        return true;
    if (msg.includes('user is deactivated'))
        return true;
    if (msg.includes('403') && msg.includes('forbidden') && (msg.includes('blocked') || msg.includes('deactivated'))) {
        return true;
    }
    return false;
}
