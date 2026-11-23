/**
 * Чисті частини вкладки «Архів» (PersonArchiveTab): підписи лічильників знімка, підсумки для плиток і розбір
 * JSON-знімка на розділи. Без React — щоб перевіряти тестами окремо.
 */
import type { PersonArchiveCounts, PersonDataArchiveSummary } from '@/types';

/** Що видалено з робочих таблиць — у тому порядку, в якому це цікаво читати */
export const COUNT_LABELS: ReadonlyArray<[keyof PersonArchiveCounts, string]> = [
  ['bookings', 'бронювань'],
  ['viberListings', 'оголошень'],
  ['viberRideEvents', 'подій ViberRide'],
  ['rideShareRequests', 'запитів на попутку'],
  ['matchNotifications', 'сповіщень про збіг'],
  ['rideCompletionProofs', 'фото поїздок'],
  ['referralInvites', 'запрошень'],
  ['referralRewardsDeleted', 'нарахувань видалено'],
  ['referralRewardsKeptPaid', 'виплачених збережено'],
  ['referralRewardsFlagged', 'нарахувань позначено'],
  ['smsSendLogs', 'SMS'],
  ['telegramUserSendErrors', 'помилок акаунта'],
  ['pendingReferralCodes', 'кодів запрошень'],
];

/** Ненульові лічильники знімка підписами: «бронювань 3» */
export function countTags(c: Partial<PersonArchiveCounts> | null | undefined): string[] {
  if (!c) return [];
  return COUNT_LABELS.filter(([k]) => (c[k] ?? 0) > 0).map(([k, label]) => `${label} ${c[k]}`);
}

/** Скільки записів прибрано з робочих таблиць (без збережених виплачених нарахувань) */
export function removedTotal(c: Partial<PersonArchiveCounts> | null | undefined): number {
  if (!c) return 0;
  return COUNT_LABELS.filter(([k]) => k !== 'referralRewardsKeptPaid').reduce((s, [k]) => s + (c[k] ?? 0), 0);
}

export function archiveTiles(list: readonly PersonDataArchiveSummary[], now: Date = new Date()) {
  const monthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return {
    total: list.length,
    month: list.filter((a) => new Date(a.createdAt).getTime() >= monthAgo).length,
    removed: list.reduce((s, a) => s + removedTotal(a.deletedCounts), 0),
    keptPaid: list.reduce((s, a) => s + (a.deletedCounts?.referralRewardsKeptPaid ?? 0), 0),
    people: new Set(list.map((a) => a.phoneNormalized)).size,
  };
}

const SECTION_LABELS: Record<string, string> = {
  person: 'Людина',
  bookings: 'Бронювання',
  viberListings: 'Оголошення',
  viberRideEvents: 'Події ViberRide',
  rideCompletionProofs: 'Фото поїздок',
  referralInvites: 'Запрошення',
  referralRewards: 'Реферальні нарахування',
  rideShareRequests: 'Запити на попутку',
  matchNotifications: 'Сповіщення про збіг',
  smsSendLogs: 'SMS',
  telegramUserSendErrors: 'Помилки особистого акаунта',
  pendingReferralCodes: 'Коди запрошень',
};

export interface PayloadSection {
  key: string;
  label: string;
  /** кількість записів для масиву, null — для обʼєкта */
  count: number | null;
  value: unknown;
}

/** Знімок по розділах: службові поля (schemaVersion, reason) не показуємо, порожні масиви — в кінці */
export function payloadSections(payload: unknown): PayloadSection[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const out = Object.entries(payload as Record<string, unknown>)
    .filter(([k]) => k !== 'schemaVersion' && k !== 'reason')
    .map(([key, value]) => ({ key, label: SECTION_LABELS[key] ?? key, count: Array.isArray(value) ? value.length : null, value }));
  return out.sort((a, b) => Number(a.count === 0) - Number(b.count === 0));
}

export const kyivDateTime = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
