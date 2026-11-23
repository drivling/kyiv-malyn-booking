/**
 * Фільтр і сортування списку персон у вкладці «Дані» (persons/PersonsTab). Чисті функції — список уже повністю
 * завантажений і сортується на клієнті, тож окремий запит до бекенда не потрібен.
 */
import type { PersonWithCounts } from '@/types';

export type PersonsFilterMode = 'all' | 'bot' | 'nobot' | 'noname' | 'blocked' | 'returned' | 'archived';

export const PERSONS_FILTER_OPTIONS: Array<{ value: PersonsFilterMode; label: string }> = [
  { value: 'all', label: 'Усі' },
  { value: 'bot', label: 'У боті' },
  { value: 'nobot', label: 'Без бота' },
  { value: 'noname', label: 'Без імені' },
  { value: 'blocked', label: 'Заблоковані' },
  { value: 'returned', label: 'Повернулися після заборони' },
  { value: 'archived', label: 'Заархівовані' },
];

type FilterRow = Pick<PersonWithCounts, 'phoneBlockedAt' | 'blockedAttemptCount' | 'dataArchivedAt'> &
  Partial<Pick<PersonWithCounts, 'telegramChatId' | 'fullName'>>;

const TESTS: Record<PersonsFilterMode, (p: FilterRow) => boolean> = {
  all: () => true,
  bot: (p) => Boolean(p.telegramChatId),
  nobot: (p) => !p.telegramChatId,
  noname: (p) => !p.fullName?.trim(),
  blocked: (p) => p.phoneBlockedAt != null,
  returned: (p) => p.phoneBlockedAt != null && (p.blockedAttemptCount ?? 0) > 0,
  archived: (p) => p.dataArchivedAt != null,
};

export const isPersonsFilter = (s: string | null): s is PersonsFilterMode => s != null && s in TESTS;

export function filterPersons<T extends FilterRow>(persons: T[], mode: PersonsFilterMode): T[] {
  if (mode === 'all') return persons;
  return persons.filter(TESTS[mode] ?? TESTS.all);
}

export function personsFilterCounts(persons: readonly FilterRow[]): Record<PersonsFilterMode, number> {
  const out = { all: 0, bot: 0, nobot: 0, noname: 0, blocked: 0, returned: 0, archived: 0 };
  for (const p of persons) for (const k of Object.keys(out) as PersonsFilterMode[]) if (TESTS[k](p)) out[k] += 1;
  return out;
}

export type PersonsSort = 'new' | 'old' | 'name' | 'bookings' | 'listings' | 'reminded';

export const PERSONS_SORT_OPTIONS: Array<{ value: PersonsSort; label: string }> = [
  { value: 'new', label: 'Нові спочатку' },
  { value: 'old', label: 'Старі спочатку' },
  { value: 'name', label: 'За імʼям' },
  { value: 'bookings', label: 'Більше бронювань' },
  { value: 'listings', label: 'Більше оголошень' },
  { value: 'reminded', label: 'Нещодавно нагадували' },
];

export function sortPersons<T extends PersonWithCounts>(persons: readonly T[], sort: PersonsSort): T[] {
  const list = [...persons];
  const byId = (a: T, b: T) => b.id - a.id;
  switch (sort) {
    case 'old':
      return list.sort((a, b) => a.id - b.id);
    case 'name':
      return list.sort((a, b) => (a.fullName ?? '￿').localeCompare(b.fullName ?? '￿', 'uk') || byId(a, b));
    case 'bookings':
      return list.sort((a, b) => b._count.bookings - a._count.bookings || byId(a, b));
    case 'listings':
      return list.sort((a, b) => b._count.viberListings - a._count.viberListings || byId(a, b));
    case 'reminded':
      return list.sort((a, b) => (b.telegramReminderSentAt ?? '').localeCompare(a.telegramReminderSentAt ?? '') || byId(a, b));
    case 'new':
    default:
      return list.sort(byId);
  }
}
