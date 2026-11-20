/** «Реферали»: плитки, розділи з адресами, черга виплат рядками, виплата з нотаткою, фото, підозри, запрошення. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import type { AdminReferralReport, PersonReferralDetails } from '@/types';
import { SELF_REFERRAL_FLAG_REASON } from './referralText';

const api = vi.hoisted(() => ({
  getReferralReport: vi.fn(),
  getReferralInvites: vi.fn(),
  getPersonReferralDetails: vi.fn(),
  searchReferralPersons: vi.fn(),
  markReferralPayout: vi.fn(),
  patchRideProof: vi.fn(),
  patchReferralReward: vi.fn(),
  setReferralBudget: vi.fn(),
  undoReferralPayout: vi.fn(),
  syncReferralApproved: vi.fn(),
  downloadReferralPayoutsCsv: vi.fn(),
  fetchRideProofPhotoObjectUrl: vi.fn(),
  getRideProof: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { ReferralTab } from './ReferralTab';

const brief = (id: number, fullName: string | null, phoneNormalized: string) => ({ id, fullName, phoneNormalized });

const REPORT: AdminReferralReport = {
  summary: {
    totalRewards: 9,
    onHoldCount: 1,
    onHoldUah: 20,
    paidCount: 2,
    paidUah: 50,
    flaggedCount: 1,
    flaggedUah: 10,
    referredPersonsCount: 7,
    payablePeopleCount: 1,
    payableUah: 60,
    personWarnLimitUah: 200,
    sharedTelegramGroupCount: 1,
  },
  budget: { budgetUah: 4000, committedUah: 3700, remainingUah: 300, budgetHeldUah: 0, budgetHeldCount: 0, exceeded: false },
  payoutBalances: [
    { personId: 1, fullName: 'Олена', phoneNormalized: '380671112233', telegramUsername: 'olena_m', payableUah: 60, payableCount: 3, holdUah: 20, holdCount: 1, paidUah: 150, flaggedUah: 0, rewardIds: [11, 12, 13] },
    { personId: 2, fullName: 'Петро', phoneNormalized: '380509998877', telegramUsername: null, payableUah: 0, payableCount: 0, holdUah: 0, holdCount: 0, paidUah: 40, flaggedUah: 0, rewardIds: [] },
  ],
  flagged: [
    {
      id: 21,
      referrerId: 3,
      referredPersonId: 4,
      rewardType: 'registration',
      amountUah: 10,
      status: 'flagged',
      flagReason: SELF_REFERRAL_FLAG_REASON,
      paidAt: null,
      createdAt: '2026-11-18T10:00:00Z',
      referrer: brief(3, 'Іван', '380931234567'),
      referredPerson: brief(4, null, '380931234568'),
      rideProof: null,
    },
  ],
  invites: {
    items: [
      { id: 1, inviteContact: '+380931234568', inviteType: 'phone', status: 'blocked_self_referral', registrationBonusEligible: true, createdAt: '2026-11-18T10:00:00Z', referrer: { fullName: 'Іван', phoneNormalized: '380931234567' }, referredPerson: null },
    ],
    total: 12,
    skip: 0,
    take: 30,
  },
  sharedTelegramGroups: [
    {
      key: 'chat:42',
      persons: [
        { id: 3, fullName: 'Іван', phoneNormalized: '380931234567', telegramUsername: 'ivan', referredByPersonId: null, unpaidUah: 10 },
        { id: 4, fullName: null, phoneNormalized: '380931234568', telegramUsername: null, referredByPersonId: 3, unpaidUah: 0 },
      ],
      selfReferralPairs: [{ referredPersonId: 4, referrerPersonId: 3 }],
      unpaidUah: 10,
    },
  ],
  promoPhotoProofs: [
    { id: 5, personId: 2, route: 'Kyiv-Malyn', rideDate: '2026-11-19', departureTime: '08:00', photoStartFileId: 'a', photoEndFileId: 'b', status: 'pending_review', rejectionReason: null, flagReason: null, person: { fullName: 'Петро', phoneNormalized: '380509998877' }, referralRewards: [] },
    { id: 6, personId: 2, route: 'Malyn-Kyiv', rideDate: '2026-11-17', departureTime: null, photoStartFileId: 'a', photoEndFileId: 'b', status: 'approved', rejectionReason: null, flagReason: null, person: { fullName: 'Петро', phoneNormalized: '380509998877' } },
  ],
};

const DETAILS: PersonReferralDetails = {
  person: { id: 1, fullName: 'Олена', phoneNormalized: '380671112233', telegramUsername: 'olena_m', telegramChatId: null, telegramUserId: null, referralCode: 'OLENA', referredByPerson: null },
  rewards: [
    { id: 11, rewardType: 'passenger_completed_ride', amountUah: 20, status: 'approved', flagReason: null, payoutNote: null, paidAt: null, referredPerson: brief(2, 'Петро', '380509998877'), rideProof: { id: 5, route: 'Kyiv-Malyn', rideDate: '2026-11-19', status: 'pending_review' } },
    { id: 14, rewardType: 'registration', amountUah: 10, status: 'paid', flagReason: null, payoutNote: 'Київстар', paidAt: '2026-11-10T10:00:00Z', referredPerson: brief(2, 'Петро', '380509998877'), rideProof: null },
  ],
  invitedPersons: [{ id: 2, fullName: 'Петро', phoneNormalized: '380509998877', telegramUsername: null }],
  sharedAccountPersons: [],
};

function Shell() {
  const { section } = useParams<{ section?: string }>();
  return <ReferralTab section={section} />;
}

function renderAt(path = '/admin/referrals') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/:tab?/:section?" element={<Shell />} />
      </Routes>
    </MemoryRouter>
  );
}

const tileText = (label: string) => screen.getByText(label).closest('.admin-kit-tile')!.querySelector('.admin-kit-tile-value')!.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  api.getReferralReport.mockResolvedValue(REPORT);
  api.getPersonReferralDetails.mockResolvedValue(DETAILS);
  api.markReferralPayout.mockResolvedValue({ updatedCount: 3, amountUah: 60 });
  api.patchRideProof.mockResolvedValue({});
  api.patchReferralReward.mockResolvedValue({});
  api.fetchRideProofPhotoObjectUrl.mockResolvedValue('blob:x');
  api.getReferralInvites.mockResolvedValue({ items: [], total: 0, skip: 0, take: 30 });
  api.searchReferralPersons.mockResolvedValue({ items: [] });
});

describe('ReferralTab', () => {
  it('плитки угорі й розділи з лічильниками', async () => {
    renderAt();
    await screen.findByRole('heading', { name: 'Реферали' });
    const tiles = screen.getByRole('group', { name: 'Підсумки реферальної програми' });
    expect(tiles).toBeInTheDocument();
    expect(tileText('До виплати')).toBe('60 грн людей 1');
    expect(tileText('Фото чекають')).toBe('1 утримано 20 грн');
    expect(tileText('Підозри')).toBe('10 грн нагород 1 · само-реферал 1');
    expect(tileText('Бюджет: лишилось')).toBe('300 грн з 4000 грн');
    expect(screen.getByText('Фото чекають').closest('a')).toHaveAttribute('href', '/admin/referrals/photos');
    const nav = screen.getByRole('navigation', { name: 'Розділи «Реферали»' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Виплати', 'Фото 1', 'Підозри 1', 'Запрошення']);
  });

  it('черга: рядок людини з мітками, фільтри, картка розкривається', async () => {
    renderAt();
    const list = await screen.findByRole('list', { name: 'Отримувачі' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    const row = within(list).getByRole('listitem');
    expect(row).toHaveTextContent('60 грн · нагород 3');
    expect(row).toHaveTextContent('на перевірці 20 грн');
    expect(row).toHaveTextContent('усього 230 грн — перевірте');

    await userEvent.click(screen.getByRole('button', { name: 'Усі 2' }));
    expect(within(screen.getByRole('list', { name: 'Отримувачі' })).getAllByRole('listitem')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: /Олена/ }));
    const rewards = await screen.findByRole('list', { name: 'Нагороди' });
    expect(within(rewards).getAllByRole('listitem')[0]).toHaveTextContent('до виплати');
    expect(within(rewards).getByRole('button', { name: 'Скасувати виплату' })).toBeInTheDocument();
    expect(screen.getByLabelText('Нагороди людини')).toHaveTextContent('виплачено 10 грн');
  });

  it('«Виплатив» вимагає нотатку й надсилає нагороди людини', async () => {
    renderAt();
    await screen.findByRole('list', { name: 'Отримувачі' });
    await userEvent.click(screen.getByRole('button', { name: 'Виплатив' }));
    const dialog = screen.getByRole('dialog', { name: 'Нотатка виплати' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Підтвердити виплату' }));
    expect(api.markReferralPayout).not.toHaveBeenCalled();
    expect(await screen.findByText(/Нотатка до виплати обовʼязкова/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Київстар ****1952');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Підтвердити виплату' }));
    expect(api.markReferralPayout).toHaveBeenCalledWith({ personId: 1, rewardIds: [11, 12, 13], note: 'Київстар ****1952' });
    expect(await screen.findByText('Виплату позначено: 60 грн (3 нагород)')).toBeInTheDocument();
  });

  it('пошук серед усіх людей іде на сервер', async () => {
    api.searchReferralPersons.mockResolvedValue({
      items: [{ id: 9, fullName: 'Марія', phoneNormalized: '380661112233', telegramUsername: null, referredByPerson: brief(1, 'Олена', '380671112233'), _count: { referredPersons: 0, referralRewards: 0 } }],
    });
    renderAt();
    await screen.findByRole('list', { name: 'Отримувачі' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Пошук людини' }), 'Марія');
    await userEvent.click(screen.getByRole('button', { name: /серед усіх людей/ }));
    expect(api.searchReferralPersons).toHaveBeenCalledWith('Марія');
    const hits = await screen.findByRole('list', { name: 'Знайдені люди' });
    expect(hits).toHaveTextContent('привів: Олена · запросила 0 · нагород 0');
  });

  it('фото: лише заявки, що чекають рішення, схвалення', async () => {
    renderAt('/admin/referrals/photos');
    const card = await screen.findByRole('article', { name: 'Заявка #5' });
    expect(screen.queryByRole('article', { name: 'Заявка #6' })).toBeNull();
    expect(card).toHaveTextContent('на перевірці');
    await userEvent.click(within(card).getByRole('button', { name: 'Схвалити → у виплату' }));
    expect(api.patchRideProof).toHaveBeenCalledWith(5, { status: 'approved' });
  });

  it('підозри: само-реферал питає підтвердження, спільні акаунти рядками', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAt('/admin/referrals/suspicious');
    const list = await screen.findByRole('list', { name: 'Підозрілі нагороди' });
    expect(list).toHaveTextContent('Само-реферал: той самий Telegram-акаунт');
    await userEvent.click(within(list).getByRole('button', { name: 'Схвалити' }));
    expect(confirm).toHaveBeenCalled();
    expect(api.patchReferralReward).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Спільні Telegram-акаунти' })).toHaveTextContent('само-реферал: пар 1');
    confirm.mockRestore();
  });

  it('запрошення: стан словами, фільтр іде на сервер', async () => {
    renderAt('/admin/referrals/invites');
    const list = await screen.findByRole('list', { name: 'Запрошення' });
    expect(list).toHaveTextContent('Іван → +380931234568');
    expect(list).toHaveTextContent('само-реферал');
    await userEvent.click(screen.getByRole('button', { name: 'Чекають' }));
    expect(api.getReferralInvites).toHaveBeenCalledWith({ skip: 0, take: 30, status: 'pending' });
  });

  it('невідомий розділ веде на «Виплати»', async () => {
    renderAt('/admin/referrals/whatever');
    expect(await screen.findByRole('list', { name: 'Отримувачі' })).toBeInTheDocument();
  });
});
