/** «Архів»: плитки, рядок знімка з лічильниками, пошук, знімок по розділах. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({ getPersonDataArchives: vi.fn(), getPersonDataArchive: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { PersonArchiveTab } from '../PersonArchiveTab';

const SUMMARY = {
  id: 7, personId: 42, phoneNormalized: '380671112233', fullName: 'Олена', reason: 'Скарга водія 20.11', createdAt: new Date().toISOString(),
  deletedCounts: { bookings: 2, viberListings: 1, viberRideEvents: 0, rideShareRequests: 0, matchNotifications: 0, rideCompletionProofs: 0, referralInvites: 0,
    referralRewardsDeleted: 0, referralRewardsKeptPaid: 1, referralRewardsFlagged: 0, smsSendLogs: 0, telegramUserSendErrors: 0, pendingReferralCodes: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getPersonDataArchives.mockResolvedValue([SUMMARY]);
  api.getPersonDataArchive.mockResolvedValue({ ...SUMMARY, payload: { schemaVersion: 1, person: { id: 42 }, bookings: [{ id: 1 }, { id: 2 }], smsSendLogs: [] } });
});

describe('PersonArchiveTab', () => {
  it('рядок знімка з причиною й лічильниками, плитки', async () => {
    render(<PersonArchiveTab />);
    const row = await screen.findByRole('listitem', { name: 'Архів #7' });
    expect(row).toHaveTextContent('Скарга водія 20.11');
    expect(row).toHaveTextContent('бронювань 2');
    expect(row).toHaveTextContent('виплачених збережено 1');
    expect(screen.getByText('Записів прибрано', { selector: '.admin-kit-tile-label' }).closest('.admin-kit-tile')).toHaveTextContent('3');
  });

  it('пошук іде на сервер, знімок відкривається розділами', async () => {
    const user = userEvent.setup();
    render(<PersonArchiveTab />);
    await screen.findByRole('listitem', { name: 'Архів #7' });
    await user.type(screen.getByRole('searchbox', { name: 'Пошук в архіві' }), 'скарга{Enter}');
    expect(api.getPersonDataArchives).toHaveBeenLastCalledWith('скарга');
    await user.click(screen.getByRole('button', { name: 'Знімок' }));
    const dialog = await screen.findByRole('dialog', { name: 'Архів #7' });
    const sections = within(dialog).getByLabelText('Розділи знімка');
    expect(sections).toHaveTextContent('Людина');
    expect(sections).toHaveTextContent('Бронювання · 2');
    expect(sections).toHaveTextContent('SMS · 0');
    expect(sections).not.toHaveTextContent('schemaVersion');
  });
});
