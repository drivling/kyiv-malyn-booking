/**
 * Налаштування логіки сповіщень + платного SMS-фолбеку (TurboSMS).
 * Singleton-рядок id=1 (як LunchSettings). Редагується з адмінки — без редеплою.
 */
import type { NotificationSettings, PrismaClient } from '@prisma/client';

export type SmsMatchTypeThreshold = 'exact' | 'exact_approximate' | 'all';

export const SMS_MATCH_TYPE_THRESHOLDS: readonly SmsMatchTypeThreshold[] = [
  'exact',
  'exact_approximate',
  'all',
] as const;

export const NOTIFICATION_SETTINGS_DEFAULTS = {
  smsFallbackEnabled: false,
  smsMatchEnabled: false,
  smsAuthorConfirmationEnabled: false,
  smsBookingReminderEnabled: false,
  smsInactivityReminderEnabled: false,
  smsChannelPromoEnabled: false,
  smsMatchTypeThreshold: 'exact' as SmsMatchTypeThreshold,
  smsDailyCap: 50,
  smsMonthlyCap: 1000,
  turboSmsToken: null as string | null,
  turboSmsSender: null as string | null,
};

const CAP_MAX = 100_000;
const CACHE_TTL_MS = 30_000;

let cache: { value: NotificationSettings; expiresAt: number } | null = null;

/** Тільки для тестів: підмінити/скинути кеш налаштувань. */
export function setNotificationSettingsCacheForTests(value: NotificationSettings | null): void {
  cache = value ? { value, expiresAt: Number.MAX_SAFE_INTEGER } : null;
}

/**
 * Поточні налаштування (лінива ініціалізація рядка). Кешуються на 30 с, щоб гарячий
 * шлях (цикл по парах/бронюваннях) не бив у БД щоразу; правки з адмінки застосуються
 * протягом 30 с.
 */
export async function getNotificationSettings(prisma: PrismaClient): Promise<NotificationSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const value = await prisma.notificationSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export type NotificationSettingsPatch = Partial<{
  smsFallbackEnabled: boolean;
  smsMatchEnabled: boolean;
  smsAuthorConfirmationEnabled: boolean;
  smsBookingReminderEnabled: boolean;
  smsInactivityReminderEnabled: boolean;
  smsChannelPromoEnabled: boolean;
  smsMatchTypeThreshold: string;
  smsDailyCap: number;
  smsMonthlyCap: number;
  turboSmsToken: string | null;
  turboSmsSender: string | null;
}>;

function coerceBool(v: unknown, field: string): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  throw new Error(`${field}: очікується boolean`);
}

function coerceCap(v: unknown, field: string): number {
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
export async function updateNotificationSettings(
  prisma: PrismaClient,
  patch: NotificationSettingsPatch
): Promise<NotificationSettings> {
  const data: Record<string, unknown> = {};

  if ('smsFallbackEnabled' in patch)
    data.smsFallbackEnabled = coerceBool(patch.smsFallbackEnabled, 'smsFallbackEnabled');
  if ('smsMatchEnabled' in patch)
    data.smsMatchEnabled = coerceBool(patch.smsMatchEnabled, 'smsMatchEnabled');
  if ('smsAuthorConfirmationEnabled' in patch)
    data.smsAuthorConfirmationEnabled = coerceBool(
      patch.smsAuthorConfirmationEnabled,
      'smsAuthorConfirmationEnabled'
    );
  if ('smsBookingReminderEnabled' in patch)
    data.smsBookingReminderEnabled = coerceBool(
      patch.smsBookingReminderEnabled,
      'smsBookingReminderEnabled'
    );
  if ('smsInactivityReminderEnabled' in patch)
    data.smsInactivityReminderEnabled = coerceBool(
      patch.smsInactivityReminderEnabled,
      'smsInactivityReminderEnabled'
    );
  if ('smsChannelPromoEnabled' in patch)
    data.smsChannelPromoEnabled = coerceBool(
      patch.smsChannelPromoEnabled,
      'smsChannelPromoEnabled'
    );

  if ('smsMatchTypeThreshold' in patch) {
    const t = String(patch.smsMatchTypeThreshold);
    if (!SMS_MATCH_TYPE_THRESHOLDS.includes(t as SmsMatchTypeThreshold)) {
      throw new Error(
        `smsMatchTypeThreshold: одне з ${SMS_MATCH_TYPE_THRESHOLDS.join(' | ')}`
      );
    }
    data.smsMatchTypeThreshold = t;
  }

  if ('smsDailyCap' in patch) data.smsDailyCap = coerceCap(patch.smsDailyCap, 'smsDailyCap');
  if ('smsMonthlyCap' in patch) data.smsMonthlyCap = coerceCap(patch.smsMonthlyCap, 'smsMonthlyCap');

  if ('turboSmsSender' in patch) {
    const raw = patch.turboSmsSender;
    if (raw == null || String(raw).trim() === '') {
      data.turboSmsSender = null;
    } else {
      const s = String(raw).trim();
      if (s.length > 11) throw new Error('turboSmsSender: не більше 11 символів (альфа-ім’я)');
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

function kyivMonthStart(): Date {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function kyivDayStart(): Date {
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
export async function countSmsSendsToday(prisma: PrismaClient): Promise<number> {
  return prisma.smsSendLog.count({
    where: { createdAt: { gte: kyivDayStart() }, status: { in: ['pending', 'sent'] } },
  });
}

/** Скільки платних відправок уже зроблено цього місяця (Київ). */
export async function countSmsSendsThisMonth(prisma: PrismaClient): Promise<number> {
  return prisma.smsSendLog.count({
    where: { createdAt: { gte: kyivMonthStart() }, status: { in: ['pending', 'sent'] } },
  });
}
