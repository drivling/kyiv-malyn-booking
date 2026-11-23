import { describe, expect, it } from 'vitest';
import type { PersonWithCounts } from '@/types';
import { filterPersons, isPersonsFilter, personsFilterCounts, sortPersons } from './personsFilter';

type Row = { phoneBlockedAt: string | null; blockedAttemptCount: number; dataArchivedAt: string | null };

const plain: Row = { phoneBlockedAt: null, blockedAttemptCount: 0, dataArchivedAt: null };
const blocked: Row = { phoneBlockedAt: '2026-09-11T10:00:00.000Z', blockedAttemptCount: 0, dataArchivedAt: null };
const returned: Row = { phoneBlockedAt: '2026-09-11T10:00:00.000Z', blockedAttemptCount: 3, dataArchivedAt: null };
const archived: Row = {
  phoneBlockedAt: '2026-09-11T10:00:00.000Z',
  blockedAttemptCount: 0,
  dataArchivedAt: '2026-09-11T11:00:00.000Z',
};
const rows = [plain, blocked, returned, archived];

describe('filterPersons', () => {
  it('«Усі» нічого не фільтрує', () => {
    expect(filterPersons(rows, 'all')).toEqual(rows);
  });

  it('«Заблоковані» — усі з phoneBlockedAt', () => {
    expect(filterPersons(rows, 'blocked')).toEqual([blocked, returned, archived]);
  });

  it('«Повернулися» — заблоковані, які знову намагалися зайти', () => {
    expect(filterPersons(rows, 'returned')).toEqual([returned]);
  });

  it('«Заархівовані» — лише з dataArchivedAt', () => {
    expect(filterPersons(rows, 'archived')).toEqual([archived]);
  });

  it('не мутує вхідний масив', () => {
    const input = [...rows];
    filterPersons(input, 'blocked');
    expect(input).toEqual(rows);
  });
});

describe('нові фільтри, лічильники й сортування', () => {
  const base = { phoneBlockedAt: null, blockedAttemptCount: 0, dataArchivedAt: null };
  it('у боті / без бота / без імені', () => {
    const list = [
      { ...base, telegramChatId: '1', fullName: 'Олена' },
      { ...base, telegramChatId: null, fullName: '  ' },
      { ...base, telegramChatId: null, fullName: 'Іван' },
    ];
    expect(filterPersons(list, 'bot')).toHaveLength(1);
    expect(filterPersons(list, 'nobot')).toHaveLength(2);
    expect(filterPersons(list, 'noname')).toHaveLength(1);
    expect(personsFilterCounts(list)).toMatchObject({ all: 3, bot: 1, nobot: 2, noname: 1, blocked: 0 });
    expect(isPersonsFilter('noname')).toBe(true);
    expect(isPersonsFilter('x')).toBe(false);
  });

  it('сортування не мутує й ламає нічиї за id', () => {
    const p = (id: number, over: object = {}) =>
      ({ id, fullName: null, telegramReminderSentAt: null, _count: { bookings: 0, viberListings: 0 }, ...over }) as unknown as PersonWithCounts;
    const list = [p(1, { fullName: 'Ярина', _count: { bookings: 2, viberListings: 0 } }), p(2, { fullName: 'Андрій' }), p(3)];
    expect(sortPersons(list, 'new').map((x) => x.id)).toEqual([3, 2, 1]);
    expect(sortPersons(list, 'name').map((x) => x.id)).toEqual([2, 1, 3]);
    expect(sortPersons(list, 'bookings').map((x) => x.id)).toEqual([1, 3, 2]);
    expect(list.map((x) => x.id)).toEqual([1, 2, 3]);
  });
});
