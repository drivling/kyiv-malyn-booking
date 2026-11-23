import { describe, expect, it } from 'vitest';
import type { PersonDataArchiveSummary } from '@/types';
import { archiveTiles, countTags, payloadSections, removedTotal } from './archiveText';

const a = (over: Partial<PersonDataArchiveSummary>): PersonDataArchiveSummary =>
  ({ id: 1, personId: 1, phoneNormalized: '380671112233', fullName: null, reason: 'скарга', createdAt: '2026-11-20T10:00:00Z', deletedCounts: { bookings: 2, viberListings: 1, referralRewardsKeptPaid: 3 }, ...over }) as PersonDataArchiveSummary;

describe('archiveText', () => {
  it('лічильники підписами, без нулів', () => {
    expect(countTags({ bookings: 2, viberListings: 0, smsSendLogs: 4 })).toEqual(['бронювань 2', 'SMS 4']);
    expect(countTags(null)).toEqual([]);
    expect(removedTotal({ bookings: 2, viberListings: 1, referralRewardsKeptPaid: 3 })).toBe(3);
  });

  it('плитки рахують знімки, свіжі, прибране й збережене', () => {
    const list = [a({ id: 1 }), a({ id: 2, createdAt: '2026-09-01T10:00:00Z' }), a({ id: 3, phoneNormalized: '380500000000' })];
    expect(archiveTiles(list, new Date('2026-11-21T10:00:00Z'))).toEqual({ total: 3, month: 2, removed: 9, keptPaid: 9, people: 2 });
  });

  it('знімок по розділах: службові поля сховано, порожні масиви в кінці', () => {
    const s = payloadSections({ schemaVersion: 1, reason: 'x', person: { id: 1 }, smsSendLogs: [], bookings: [{}, {}] });
    expect(s.map((x) => [x.label, x.count])).toEqual([['Людина', null], ['Бронювання', 2], ['SMS', 0]]);
    expect(payloadSections(null)).toEqual([]);
  });
});
