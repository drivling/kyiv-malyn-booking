import type { PrismaClient } from '@prisma/client';
import { isTelegramBotBlockedByUserError } from './telegram-bot-blocked';
import { isTechnicalPlaceholderPhone } from './telegram-contact';
import {
  buildBotBlockedPayoutsFrozenMessage,
  flagUnpaidReferralRewardsForBotBlocked,
} from './referral';

/** Same normalization rules as `normalizePhone` in telegram.ts (digits only, 0XXXXXXXXX → 38…). */
function normalizeUaPhone(phone: string): string {
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
async function notifyBotBlockedPayoutsFrozenViaUserAccount(person: {
  id: number;
  phoneNormalized: string;
  telegramUsername: string | null;
}): Promise<void> {
  if (isTechnicalPlaceholderPhone(person.phoneNormalized)) return;
  try {
    const { sendMessageViaUserAccount } = await import('./telegram');
    const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || 'malin_kiev_ua_bot';
    const text = buildBotBlockedPayoutsFrozenMessage(botUsername);
    const ok = await sendMessageViaUserAccount(person.phoneNormalized, text, {
      telegramUsername: person.telegramUsername,
    });
    if (ok) {
      console.log(`📩 Person #${person.id}: bot-block payout freeze notice sent via user account`);
    } else {
      console.warn(
        `⚠️ Person #${person.id}: bot-block payout freeze notice NOT delivered via user account`
      );
    }
  } catch (e) {
    console.error(`❌ notifyBotBlockedPayoutsFrozenViaUserAccount person #${person.id}:`, e);
  }
}

export async function revokeTelegramBotForPerson(prisma: PrismaClient, personId: number): Promise<void> {
  const before = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      phoneNormalized: true,
      telegramUsername: true,
      telegramBotBlockedAt: true,
    },
  });
  if (!before) return;

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
    flaggedCount = await flagUnpaidReferralRewardsForBotBlocked(prisma, personId);
    if (flaggedCount > 0) {
      console.warn(
        `🎁 Person #${personId}: bot blocked → flagged ${flaggedCount} unpaid referral reward(s)`
      );
    }
  } catch (e) {
    console.error(`❌ flagUnpaidReferralRewardsForBotBlocked person #${personId}:`, e);
  }

  // Перший раз побачили блок + є що «заморозити» → пишемо особисто (обхід блоку бота)
  if (isFirstBlockDetection && flaggedCount > 0) {
    await notifyBotBlockedPayoutsFrozenViaUserAccount(before);
  }
}

/** When chat_id came only from Booking rows (no / stale Person link). */
export async function clearBookingsTelegramByChatIdAndPhone(
  prisma: PrismaClient,
  chatId: string,
  normalizedPhone: string
): Promise<void> {
  const norm = normalizeUaPhone(normalizedPhone);
  const rows = await prisma.booking.findMany({
    where: { telegramChatId: chatId },
    select: { id: true, phone: true },
  });
  for (const row of rows) {
    if (normalizeUaPhone(row.phone) !== norm) continue;
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
export async function handleTelegramBotBlockedFromOutboundSend(
  prisma: PrismaClient,
  err: unknown,
  ctx: { chatId: string; normalizedPhone?: string | null; personId?: number | null }
): Promise<void> {
  if (!isTelegramBotBlockedByUserError(err)) return;
  const chatId = ctx.chatId.trim();
  if (!chatId || chatId === '0') return;

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
