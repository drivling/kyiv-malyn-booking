/** «Дані»: плитки, фільтр з адреси, рядок людини, пошук у базі, правка, архів і видалення з підтвердженням. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { PersonWithCounts } from '@/types';

const api = vi.hoisted(() => ({
  getPersons: vi.fn(),
  updatePerson: vi.fn(),
  deletePerson: vi.fn(),
  archivePersonData: vi.fn(),
  refreshPersonNames: vi.fn(),
  checkPersonUsernames: vi.fn(),
  analyzePhonesViaPhoneCheck: vi.fn(),
  lookupPhone: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { PersonsTab } from './PersonsTab';

const person = (over: Partial<PersonWithCounts>): PersonWithCounts => ({
  id: 1, phoneNormalized: '380671112233', fullName: 'Олена', telegramChatId: null, telegramUserId: null, telegramUsername: null,
  telegramPromoSentAt: null, telegramReminderSentAt: null, telegramBotBlockedAt: null, smsOptOut: false, phoneBlockedAt: null,
  phoneBlockReason: null, blockedAttemptAt: null, blockedAttemptCount: 0, dataArchivedAt: null, createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z', _count: { bookings: 2, viberListings: 0 }, ...over,
});
const LIST = [
  person({ id: 1, telegramChatId: '555', telegramUsername: 'olena' }),
  person({ id: 2, fullName: null, phoneNormalized: '380931234567', _count: { bookings: 0, viberListings: 3 } }),
  person({ id: 3, fullName: 'Іван', phoneBlockedAt: '2026-11-10T10:00:00Z', phoneBlockReason: 'скарга', blockedAttemptCount: 2 }),
];

const renderAt = (path = '/admin/data') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PersonsTab />
    </MemoryRouter>
  );
const ids = () => within(screen.getByRole('list', { name: 'Люди' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
const tile = (label: string) => screen.getByText(label, { selector: '.admin-kit-tile-label' }).closest('.admin-kit-tile') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.getPersons.mockResolvedValue(LIST);
  api.updatePerson.mockResolvedValue({});
  api.deletePerson.mockResolvedValue({ id: 2, deleted: { bookings: 0, viberListings: 3, viberRideEvents: 0 } });
});

describe('PersonsTab', () => {
  it('плитки, нові спочатку, мітки в рядку', async () => {
    renderAt();
    await screen.findByRole('list', { name: 'Люди' });
    expect(ids()).toEqual(['Персона #3', 'Персона #2', 'Персона #1']);
    expect(tile('У боті')).toHaveTextContent('1 без бота 2');
    expect(tile('Без імені')).toHaveAttribute('href', '/admin/data?only=noname');
    expect(tile('Заблоковані')).toHaveTextContent('1 повернулися 1');
    const ivan = screen.getByRole('listitem', { name: 'Персона #3' });
    expect(ivan).toHaveTextContent('заборона 10.11.26');
    expect(ivan).toHaveTextContent('повернувся 2×');
    expect(screen.getByRole('listitem', { name: 'Персона #1' })).toHaveTextContent('у боті');
    expect(screen.getByRole('listitem', { name: 'Персона #2' })).toHaveTextContent('без імені');
  });

  it('?only=blocked і пошук у базі', async () => {
    const user = userEvent.setup();
    renderAt('/admin/data?only=blocked');
    await screen.findByRole('list', { name: 'Люди' });
    expect(ids()).toEqual(['Персона #3']);
    await user.type(screen.getByRole('searchbox', { name: 'Пошук по телефону або імені' }), 'Іван{Enter}');
    expect(api.getPersons).toHaveBeenLastCalledWith('Іван');
  });

  it('правка зберігає форму, видалення питає', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderAt();
    const row = await screen.findByRole('listitem', { name: 'Персона #2' });
    await user.click(within(row).getByRole('button', { name: 'Редагувати' }));
    const dialog = screen.getByRole('dialog', { name: 'Персона #2' });
    await user.type(within(dialog).getByLabelText('Імʼя'), 'Марта');
    await user.click(within(dialog).getByRole('button', { name: 'Зберегти' }));
    expect(api.updatePerson).toHaveBeenCalledWith(2, expect.objectContaining({ fullName: 'Марта', phone: '380931234567', phoneBlocked: false }));

    await user.click(within(screen.getByRole('listitem', { name: 'Персона #2' })).getByRole('button', { name: 'Видалити' }));
    expect(api.deletePerson).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('listitem', { name: 'Персона #2' })).getByRole('button', { name: 'Видалити' }));
    expect(api.deletePerson).toHaveBeenCalledWith(2);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('архів вимагає причину', async () => {
    const user = userEvent.setup();
    api.archivePersonData.mockResolvedValue({ personId: 1, archiveId: 9, counts: { bookings: 2, viberListings: 0, viberRideEvents: 0, referralRewardsKeptPaid: 0 } });
    renderAt();
    const row = await screen.findByRole('listitem', { name: 'Персона #1' });
    await user.click(within(row).getByRole('button', { name: 'Архівувати' }));
    const dialog = screen.getByRole('dialog', { name: 'Архівувати #1' });
    const submit = within(dialog).getByRole('button', { name: 'Архівувати' });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'скарга 20.11');
    await user.click(submit);
    expect(api.archivePersonData).toHaveBeenCalledWith(1, 'скарга 20.11');
    expect(await screen.findByText(/заархівовано \(архів #9\)/)).toBeInTheDocument();
  });
});
