"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeTelegramBotForPerson = revokeTelegramBotForPerson;
exports.clearBookingsTelegramByChatIdAndPhone = clearBookingsTelegramByChatIdAndPhone;
exports.handleTelegramBotBlockedFromOutboundSend = handleTelegramBotBlockedFromOutboundSend;
const telegram_bot_blocked_1 = require("./telegram-bot-blocked");
/** Same normalization rules as `normalizePhone` in telegram.ts (digits only, 0XXXXXXXXX → 38…). */
function normalizeUaPhone(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '38' + cleaned;
    }
    return cleaned;
}
async function revokeTelegramBotForPerson(prisma, personId) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
        await tx.person.update({
            where: { id: personId },
            data: {
                telegramChatId: null,
                telegramUserId: null,
                telegramBotBlockedAt: now,
            },
        });
        await tx.booking.updateMany({
            where: { personId },
            data: { telegramChatId: null, telegramUserId: null },
        });
    });
}
/** When chat_id came only from Booking rows (no / stale Person link). */
async function clearBookingsTelegramByChatIdAndPhone(prisma, chatId, normalizedPhone) {
    const norm = normalizeUaPhone(normalizedPhone);
    const rows = await prisma.booking.findMany({
        where: { telegramChatId: chatId },
        select: { id: true, phone: true },
    });
    for (const row of rows) {
        if (normalizeUaPhone(row.phone) !== norm)
            continue;
        await prisma.booking.update({
            where: { id: row.id },
            data: { telegramChatId: null, telegramUserId: null },
        });
    }
}
/**
 * After a failed outbound bot message: if Telegram says the user blocked the bot (or equivalent),
 * clear Person/Booking Telegram ids and set `Person.telegramBotBlockedAt` for later reporting.
 */
async function handleTelegramBotBlockedFromOutboundSend(prisma, err, ctx) {
    if (!(0, telegram_bot_blocked_1.isTelegramBotBlockedByUserError)(err))
        return;
    const chatId = ctx.chatId.trim();
    if (!chatId || chatId === '0')
        return;
    if (ctx.personId != null && ctx.personId > 0) {
        await revokeTelegramBotForPerson(prisma, ctx.personId);
        return;
    }
    const norm = ctx.normalizedPhone?.trim();
    if (norm) {
        const person = await prisma.person.findUnique({
            where: { phoneNormalized: norm },
            select: { id: true, telegramChatId: true },
        });
        if (person?.telegramChatId && person.telegramChatId === chatId) {
            await revokeTelegramBotForPerson(prisma, person.id);
            return;
        }
        await clearBookingsTelegramByChatIdAndPhone(prisma, chatId, norm);
        return;
    }
    const byChat = await prisma.person.findFirst({
        where: { telegramChatId: chatId },
        select: { id: true },
    });
    if (byChat) {
        await revokeTelegramBotForPerson(prisma, byChat.id);
    }
}
