"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeTelegramBotForPerson = revokeTelegramBotForPerson;
exports.clearBookingsTelegramByChatIdAndPhone = clearBookingsTelegramByChatIdAndPhone;
exports.handleTelegramBotBlockedFromOutboundSend = handleTelegramBotBlockedFromOutboundSend;
const telegram_bot_blocked_1 = require("./telegram-bot-blocked");
const telegram_contact_1 = require("./telegram-contact");
const referral_1 = require("./referral");
/** Same normalization rules as `normalizePhone` in telegram.ts (digits only, 0XXXXXXXXX → 38…). */
function normalizeUaPhone(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '38' + cleaned;
    }
    return cleaned;
}
/**
 * Після першого блоку бота — особисто (Telethon) пояснити про заморожені виплати.
 * Dynamic import, щоб уникнути circular dependency з telegram.ts.
 */
async function notifyBotBlockedPayoutsFrozenViaUserAccount(person) {
    if ((0, telegram_contact_1.isTechnicalPlaceholderPhone)(person.phoneNormalized))
        return;
    try {
        const { sendMessageViaUserAccount } = await Promise.resolve().then(() => __importStar(require('./telegram')));
        const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || 'malin_kiev_ua_bot';
        const text = (0, referral_1.buildBotBlockedPayoutsFrozenMessage)(botUsername);
        const ok = await sendMessageViaUserAccount(person.phoneNormalized, text, {
            telegramUsername: person.telegramUsername,
        });
        if (ok) {
            console.log(`📩 Person #${person.id}: bot-block payout freeze notice sent via user account`);
        }
        else {
            console.warn(`⚠️ Person #${person.id}: bot-block payout freeze notice NOT delivered via user account`);
        }
    }
    catch (e) {
        console.error(`❌ notifyBotBlockedPayoutsFrozenViaUserAccount person #${person.id}:`, e);
    }
}
async function revokeTelegramBotForPerson(prisma, personId) {
    const before = await prisma.person.findUnique({
        where: { id: personId },
        select: {
            id: true,
            phoneNormalized: true,
            telegramUsername: true,
            telegramBotBlockedAt: true,
        },
    });
    if (!before)
        return;
    const isFirstBlockDetection = !before.telegramBotBlockedAt;
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
    // Невиплачені реферальні бонуси — з черги виплат, з причиною для адміна
    let flaggedCount = 0;
    try {
        flaggedCount = await (0, referral_1.flagUnpaidReferralRewardsForBotBlocked)(prisma, personId);
        if (flaggedCount > 0) {
            console.warn(`🎁 Person #${personId}: bot blocked → flagged ${flaggedCount} unpaid referral reward(s)`);
        }
    }
    catch (e) {
        console.error(`❌ flagUnpaidReferralRewardsForBotBlocked person #${personId}:`, e);
    }
    // Перший раз побачили блок + є що «заморозити» → пишемо особисто (обхід блоку бота)
    if (isFirstBlockDetection && flaggedCount > 0) {
        await notifyBotBlockedPayoutsFrozenViaUserAccount(before);
    }
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
