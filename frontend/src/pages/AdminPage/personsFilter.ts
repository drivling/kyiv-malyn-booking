/**
 * Фільтр списку персон у вкладці «Дані». Чиста функція — список уже повністю
 * завантажений і сортується на клієнті, тож окремий запит до бекенда не потрібен.
 */
import type { PersonWithCounts } from '@/types';

export type PersonsFilterMode = 'all' | 'blocked' | 'returned' | 'archived';

export const PERSONS_FILTER_OPTIONS: Array<{ value: PersonsFilterMode; label: string }> = [
  { value: 'all', label: 'Усі' },
  { value: 'blocked', label: 'Заблоковані' },
  { value: 'returned', label: 'Повернулися після заборони' },
  { value: 'archived', label: 'Заархівовані' },
];

export function filterPersons<T extends Pick<PersonWithCounts, 'phoneBlockedAt' | 'blockedAttemptCount' | 'dataArchivedAt'>>(
  persons: T[],
  mode: PersonsFilterMode,
): T[] {
  switch (mode) {
    case 'blocked':
      return persons.filter((p) => p.phoneBlockedAt != null);
    case 'returned':
      return persons.filter((p) => p.phoneBlockedAt != null && (p.blockedAttemptCount ?? 0) > 0);
    case 'archived':
      return persons.filter((p) => p.dataArchivedAt != null);
    case 'all':
    default:
      return persons;
  }
}
