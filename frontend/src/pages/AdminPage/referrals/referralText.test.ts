import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReferralPayoutPersonRow, RideCompletionProofRow } from '@/types';
import {
  budgetShare,
  filterBalances,
  filterProofs,
  isReferralSection,
  payoutFilterCounts,
  proofFilterCounts,
  referralSections,
  SELF_REFERRAL_FLAG_REASON,
} from './referralText';

const row = (over: Partial<ReferralPayoutPersonRow>): ReferralPayoutPersonRow => ({
  personId: 1,
  fullName: 'Олена',
  phoneNormalized: '380671112233',
  telegramUsername: 'olena_m',
  payableUah: 0,
  payableCount: 0,
  holdUah: 0,
  holdCount: 0,
  paidUah: 0,
  flaggedUah: 0,
  rewardIds: [],
  ...over,
});

const ROWS = [
  row({ personId: 1, payableUah: 60, payableCount: 3 }),
  row({ personId: 2, fullName: 'Петро', phoneNormalized: '380509998877', telegramUsername: null, paidUah: 40 }),
  row({ personId: 3, fullName: null, phoneNormalized: '380931234567', telegramUsername: 'ghost', flaggedUah: 10 }),
];

const proof = (id: number, status: string) => ({ id, status }) as RideCompletionProofRow;

describe('referralText', () => {
  it('розділи: відомі сегменти й лічильники в назві', () => {
    expect(isReferralSection('')).toBe(true);
    expect(isReferralSection('photos')).toBe(true);
    expect(isReferralSection('nope')).toBe(false);
    expect(referralSections({ photos: 3, suspicious: 0 }).map((s) => s.label)).toEqual(['Виплати', 'Фото 3', 'Підозри', 'Запрошення']);
  });

  it('черга: лічильники фільтрів і пошук за цифрами телефону, імʼям, @ніком', () => {
    expect(payoutFilterCounts(ROWS)).toEqual({ payable: 1, flagged: 1, all: 3, paid_only: 1 });
    expect(filterBalances(ROWS).map((r) => r.personId)).toEqual([1]);
    expect(filterBalances(ROWS, { filter: 'all', query: '099 98' }).map((r) => r.personId)).toEqual([2]);
    expect(filterBalances(ROWS, { filter: 'all', query: 'пет' }).map((r) => r.personId)).toEqual([2]);
    expect(filterBalances(ROWS, { filter: 'all', query: '@GHO' }).map((r) => r.personId)).toEqual([3]);
  });

  it('заявки: лише ті, що чекають рішення', () => {
    const list = [proof(1, 'pending_review'), proof(2, 'approved'), proof(3, 'flagged'), proof(4, 'rejected'), proof(5, 'awaiting_photos')];
    expect(proofFilterCounts(list)).toEqual({ all: 3, pending_review: 1, flagged: 1, rejected: 1 });
    expect(filterProofs(list, 'flagged').map((p) => p.id)).toEqual([3]);
  });

  it('частка бюджету обмежена одиницею', () => {
    expect(budgetShare({ budgetUah: 4000, committedUah: 1000 })).toBe(0.25);
    expect(budgetShare({ budgetUah: 4000, committedUah: 5000 })).toBe(1);
    expect(budgetShare({ budgetUah: 0, committedUah: 0 })).toBe(0);
  });

  it('причина само-реферала збігається з бекендом', () => {
    const backend = fs.readFileSync(path.resolve(__dirname, '../../../../../backend/src/referral.ts'), 'utf8');
    expect(backend).toContain(`'${SELF_REFERRAL_FLAG_REASON}'`);
  });
});
