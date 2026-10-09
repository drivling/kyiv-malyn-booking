import { describe, expect, it } from 'vitest';
import { filterPersons } from './personsFilter';

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
