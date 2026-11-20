/**
 * Чисті частини вкладки «Реферали» (ReferralTab): розділи з власними адресами, підписи статусів, фільтри черги
 * виплат і заявок з фото. Без React — щоб перевіряти тестами окремо.
 */
import type { ReferralPayoutPersonRow, RideCompletionProofRow } from '@/types';
import { formatPhoneDisplay } from '@/utils/constants';
import type { StatusTone } from '../kit';

export const REFERRAL_ADMIN_BASE = '/admin/referrals';

export type ReferralSection = '' | 'photos' | 'suspicious' | 'invites';

const SECTION_SLUGS: readonly ReferralSection[] = ['', 'photos', 'suspicious', 'invites'];

export function isReferralSection(s: string): s is ReferralSection {
  return (SECTION_SLUGS as readonly string[]).includes(s);
}

/** Розділи з лічильниками в назві: «Фото 3» — скільки заявок чекає рішення, «Підозри 2» — скільки нагород заморожено */
export function referralSections(counts: { photos: number; suspicious: number }) {
  const n = (label: string, count: number) => (count > 0 ? `${label} ${count}` : label);
  return [
    { slug: '', label: 'Виплати' },
    { slug: 'photos', label: n('Фото', counts.photos) },
    { slug: 'suspicious', label: n('Підозри', counts.suspicious) },
    { slug: 'invites', label: 'Запрошення' },
  ];
}

export const REWARD_TYPE_LABEL: Record<string, string> = {
  registration: 'Новий друг (10)',
  driver_qualified: 'Водій (40)',
  driver_first_listing: 'Водій (legacy)',
  passenger_completed_ride: 'Друг-пасажир (20)',
  passenger_self_confirm: 'Своє підтвердження (20)',
};

export const rewardTypeLabel = (t: string) => REWARD_TYPE_LABEL[t] ?? t;

const REWARD_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  hold: { label: 'на перевірці', tone: 'warn' },
  pending: { label: 'на перевірці (legacy)', tone: 'warn' },
  approved: { label: 'до виплати', tone: 'ok' },
  paid: { label: 'виплачено', tone: 'off' },
  flagged: { label: 'підозра', tone: 'error' },
};

export const rewardStatus = (s: string) => REWARD_STATUS[s] ?? { label: s, tone: 'off' as StatusTone };

const PROOF_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  awaiting_photos: { label: 'чекаємо фото', tone: 'off' },
  pending_review: { label: 'на перевірці', tone: 'warn' },
  approved: { label: 'схвалено', tone: 'ok' },
  rejected: { label: 'відхилено', tone: 'error' },
  flagged: { label: 'підозра', tone: 'error' },
};

export const proofStatus = (s: string) => PROOF_STATUS[s] ?? { label: s, tone: 'off' as StatusTone };

/** Стани ReferralInvite, які пише backend/src/referral.ts (`expired` є лише в коментарі схеми) */
export const INVITE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: 'чекає', tone: 'warn' },
  registered: { label: 'зареєструвався', tone: 'ok' },
  blocked_self_referral: { label: 'само-реферал', tone: 'error' },
  expired: { label: 'прострочене', tone: 'off' },
};

export const inviteStatus = (s: string) => INVITE_STATUS[s] ?? { label: s, tone: 'off' as StatusTone };

/** Має збігатися з SELF_REFERRAL_FLAG_REASON у backend/src/referral.ts */
export const SELF_REFERRAL_FLAG_REASON =
  'Само-реферал: запрошення з того самого Telegram-акаунта — потрібна перевірка адміна';

export const isSelfReferralFlag = (reason?: string | null): boolean => reason === SELF_REFERRAL_FLAG_REASON;

/** Імʼя людини, а без нього — телефон */
export const personLabel = (p: { fullName: string | null; phoneNormalized: string }) =>
  p.fullName?.trim() || formatPhoneDisplay(p.phoneNormalized);

export const uah = (n: number) => `${n} грн`;

/** Скільки людина заробила загалом (виплачено + до виплати + на перевірці) — для позначки «перевірте» */
export const earnedUah = (r: ReferralPayoutPersonRow) => r.paidUah + r.payableUah + r.holdUah;

export type PayoutFilter = 'payable' | 'flagged' | 'all' | 'paid_only';

const PAYOUT_TESTS: Record<PayoutFilter, (r: ReferralPayoutPersonRow) => boolean> = {
  payable: (r) => r.payableUah > 0,
  flagged: (r) => r.flaggedUah > 0,
  all: () => true,
  paid_only: (r) => r.paidUah > 0,
};

export function payoutFilterCounts(rows: readonly ReferralPayoutPersonRow[]): Record<PayoutFilter, number> {
  const out = { payable: 0, flagged: 0, all: 0, paid_only: 0 };
  for (const r of rows) for (const k of Object.keys(out) as PayoutFilter[]) if (PAYOUT_TESTS[k](r)) out[k] += 1;
  return out;
}

/** Черга виплат за фільтром і пошуком (телефон цифрами, імʼя, @нік) */
export function filterBalances(
  rows: readonly ReferralPayoutPersonRow[],
  { query = '', filter = 'payable' }: { query?: string; filter?: PayoutFilter } = {}
): ReferralPayoutPersonRow[] {
  const text = query.trim().toLowerCase().replace(/^@/, '');
  const digits = text.replace(/\D/g, '');
  return rows.filter((r) => {
    if (!PAYOUT_TESTS[filter](r)) return false;
    if (!text) return true;
    if (digits && r.phoneNormalized.includes(digits)) return true;
    return (r.fullName ?? '').toLowerCase().includes(text) || (r.telegramUsername ?? '').toLowerCase().includes(text);
  });
}

/** Заявки, що чекають рішення адміна: на перевірці, підозрілі й відхилені (їх можна перепогодити) */
export type ProofFilter = 'all' | 'pending_review' | 'flagged' | 'rejected';

const MODERATION: ReadonlySet<string> = new Set(['pending_review', 'flagged', 'rejected']);

export const moderationProofs = (proofs: readonly RideCompletionProofRow[]) => proofs.filter((p) => MODERATION.has(p.status));

export function proofFilterCounts(proofs: readonly RideCompletionProofRow[]): Record<ProofFilter, number> {
  const list = moderationProofs(proofs);
  const count = (s: string) => list.filter((p) => p.status === s).length;
  return { all: list.length, pending_review: count('pending_review'), flagged: count('flagged'), rejected: count('rejected') };
}

export const filterProofs = (proofs: readonly RideCompletionProofRow[], f: ProofFilter) =>
  moderationProofs(proofs).filter((p) => f === 'all' || p.status === f);

/** Частка витраченого бюджету, 0…1 (для смужки) */
export const budgetShare = (b: { budgetUah: number; committedUah: number }) =>
  b.budgetUah > 0 ? Math.min(1, b.committedUah / b.budgetUah) : b.committedUah > 0 ? 1 : 0;
