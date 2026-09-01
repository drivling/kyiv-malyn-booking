/**
 * Єдина точка платної відправки (SMS через TurboSMS) — викликається лише коли
 * безкоштовні канали (Telegram-бот + Telethon-помічник) не спрацювали.
 *
 * Тут зосереджені всі запобіжники: головний вимикач, прапорці по сценаріях,
 * поріг типу збігу, opt-out людини, дедуп та денний/місячний ліміт. Виклики з
 * telegram.ts / routes йдуть лише сюди, а не в sms-turbosms.ts напряму.
 */
import type { PrismaClient } from '@prisma/client';
import {
  countSmsSendsThisMonth,
  countSmsSendsToday,
  getNotificationSettings,
  type SmsMatchTypeThreshold,
} from './notification-settings';
import { estimateSmsSegments, sendSms } from './sms-turbosms';

/** Локальна копія normalizePhone (уникаємо circular import із telegram.ts). */
function normalizePhone(phone: string): string {
  let cleaned = (phone || '').replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '38' + cleaned;
  return cleaned;
}

export type PaidSmsUseCase =
  | 'match'
  | 'authorConfirmation'
  | 'bookingReminder'
  | 'inactivityReminder'
  | 'channelPromo';
export type PaidSmsMatchType = 'exact' | 'approximate' | 'same_day';

export type PaidSmsContext = {
  type: 'viberMatchPair' | 'viberListing' | 'booking';
  id: number;
};

export type PaidSmsArgs = {
  phone: string;
  text: string;
  useCase: PaidSmsUseCase;
  matchType?: PaidSmsMatchType;
  context?: PaidSmsContext;
};

export type PaidSmsResult = {
  sent: boolean;
  via: 'sms' | 'none';
  providerMessageId?: string;
  /** Причина, коли не надіслано (master_off, usecase_off, daily_cap, opted_out, ...) */
  reason?: string;
};

const USE_CASE_FLAG: Record<PaidSmsUseCase, keyof Awaited<ReturnType<typeof getNotificationSettings>>> =
  {
    match: 'smsMatchEnabled',
    authorConfirmation: 'smsAuthorConfirmationEnabled',
    bookingReminder: 'smsBookingReminderEnabled',
    inactivityReminder: 'smsInactivityReminderEnabled',
    channelPromo: 'smsChannelPromoEnabled',
  };

/** Чи проходить тип збігу поточний поріг. */
export function matchTypePassesThreshold(
  matchType: PaidSmsMatchType,
  threshold: SmsMatchTypeThreshold
): boolean {
  if (threshold === 'all') return true;
  if (threshold === 'exact_approximate') return matchType === 'exact' || matchType === 'approximate';
  return matchType === 'exact';
}

export async function sendPaidFallbackSms(
  prisma: PrismaClient,
  args: PaidSmsArgs
): Promise<PaidSmsResult> {
  const { phone, text, useCase, matchType, context } = args;
  const phoneNormalized = normalizePhone(phone);

  // Збій читання налаштувань не має ламати безкоштовний цикл сповіщень.
  let settings: Awaited<ReturnType<typeof getNotificationSettings>>;
  try {
    settings = await getNotificationSettings(prisma);
  } catch (e) {
    console.error('[sms-fallback] getNotificationSettings failed:', e);
    return { sent: false, via: 'none', reason: 'settings_unavailable' };
  }

  if (!settings.smsFallbackEnabled) return { sent: false, via: 'none', reason: 'master_off' };
  if (!settings[USE_CASE_FLAG[useCase]]) return { sent: false, via: 'none', reason: 'usecase_off' };

  if (useCase === 'match') {
    const mt = matchType ?? 'same_day';
    if (
      !matchTypePassesThreshold(mt, settings.smsMatchTypeThreshold as SmsMatchTypeThreshold)
    ) {
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
  if (person?.smsOptOut) return { sent: false, via: 'none', reason: 'opted_out' };

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
    if (existing) return { sent: false, via: 'none', reason: 'already_sent' };
  }

  if ((await countSmsSendsToday(prisma)) >= settings.smsDailyCap) {
    return { sent: false, via: 'none', reason: 'daily_cap' };
  }
  if ((await countSmsSendsThisMonth(prisma)) >= settings.smsMonthlyCap) {
    return { sent: false, via: 'none', reason: 'monthly_cap' };
  }

  const segments = estimateSmsSegments(text);
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

  const r = await sendSms(phone, text, {
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
    .catch(() => {});

  return r.sent
    ? { sent: true, via: 'sms', providerMessageId: r.providerMessageId }
    : { sent: false, via: 'none', reason: r.error ?? 'provider_failed' };
}
