/**
 * Чиста логіка, винесена з index.ts для юніт-тестів без підняття HTTP-сервера.
 */
import {
  BEHAVIOR_PROMO_SCENARIO_PROFILES,
  type BehaviorPromoScenarioKey,
} from './telegram';

/** Маппінг "звідки–куди" (сайт) → route (бот). Значення: malyn, kyiv, zhytomyr, korosten */
export function mapFromToToRoute(from: string, to: string): string | null {
  const f = (from || '').toLowerCase().trim();
  const t = (to || '').toLowerCase().trim();
  if (f === 'kyiv' && t === 'malyn') return 'Kyiv-Malyn';
  if (f === 'malyn' && t === 'kyiv') return 'Malyn-Kyiv';
  if (f === 'zhytomyr' && t === 'malyn') return 'Zhytomyr-Malyn';
  if (f === 'malyn' && t === 'zhytomyr') return 'Malyn-Zhytomyr';
  if (f === 'korosten' && t === 'malyn') return 'Korosten-Malyn';
  if (f === 'malyn' && t === 'korosten') return 'Malyn-Korosten';
  return null;
}

export function hasNonEmptyText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

export function mergeTextField(oldVal: string | null, newVal: string | null): string | null {
  if (!hasNonEmptyText(newVal)) return oldVal;
  if (!hasNonEmptyText(oldVal)) return newVal;
  const oldTrim = oldVal!.trim();
  const newTrim = newVal!.trim();
  if (oldTrim === newTrim) return oldVal;
  if (newTrim.length > oldTrim.length && !oldTrim.includes(newTrim)) {
    return `${oldTrim} | ${newTrim}`;
  }
  return oldVal;
}

export function mergeSenderName(oldVal: string | null, newVal: string | null): string | null {
  if (!hasNonEmptyText(oldVal) && hasNonEmptyText(newVal)) return newVal;
  return oldVal;
}

export function mergeRawMessage(oldRaw: string, newRaw: string): string {
  const oldTrim = (oldRaw || '').trim();
  const newTrim = (newRaw || '').trim();
  if (!newTrim) return oldRaw;
  if (!oldTrim) return newRaw;
  if (oldTrim.includes(newTrim)) return oldRaw;
  if (newTrim.includes(oldTrim)) return newRaw;
  return `${oldRaw}\n---\n${newRaw}`;
}

/** Серіалізація Viber listing для JSON (дати в ISO рядок) */
export function serializeViberListing(row: {
  date: Date;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}): Record<string, unknown> {
  return {
    ...row,
    date: row.date instanceof Date ? row.date.toISOString() : row.date,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

/** «Дата по» для оголошення: дата поїздки + кінець часу (діапазон → кінець інтервалу). */
export function getViberListingEndDateTime(date: Date, departureTime: string | null): Date {
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

export const hasTelegramReminderBaseCondition = {
  telegramChatId: {
    not: null,
  },
  NOT: [{ telegramChatId: '' }, { telegramChatId: '0' }],
} as const;

const TELEGRAM_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function getTelegramReminderWhere(filter: string): object {
  if (filter === 'no_active_viber') {
    return {
      ...hasTelegramReminderBaseCondition,
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
      ...hasTelegramReminderBaseCondition,
      OR: [{ telegramReminderSentAt: null }, { telegramReminderSentAt: { lt: sevenDaysAgo } }],
    };
  }
  return hasTelegramReminderBaseCondition;
}

export const noTelegramCondition = {
  OR: [{ telegramChatId: null }, { telegramChatId: '' }, { telegramChatId: '0' }],
} as const;

/** Маркер: пробували промо, номер не знайдено в Telegram */
export const PROMO_NOT_FOUND_SENTINEL = new Date(0);

export function getChannelPromoWhere(filter: string): object {
  if (filter === 'no_communication') {
    return { ...noTelegramCondition, telegramPromoSentAt: null };
  }
  if (filter === 'promo_not_found') {
    return { ...noTelegramCondition, telegramPromoSentAt: PROMO_NOT_FOUND_SENTINEL };
  }
  return noTelegramCondition;
}

export function getScenarioKeysForProfile(
  profileRole: 'driver' | 'passenger' | 'mixed'
): BehaviorPromoScenarioKey[] {
  const keys: BehaviorPromoScenarioKey[] = [
    'driver_passengers',
    'driver_autocreate',
    'passenger_notify',
    'passenger_quick',
    'mixed_unified',
    'mixed_both',
  ];
  return keys.filter((k) => BEHAVIOR_PROMO_SCENARIO_PROFILES[k].includes(profileRole));
}
