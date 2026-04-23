import type { PrismaClient } from '@prisma/client';
import { isTelegramBotBlockedByUserError } from './telegram-bot-blocked';

/** Same normalization rules as `normalizePhone` in telegram.ts (digits only, 0XXXXXXXXX → 38…). */
function normalizeUaPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '38' + cleaned;
  }
  return cleaned;
}

export async function revokeTelegramBotForPerson(prisma: PrismaClient, personId: number): Promise<void> {
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
