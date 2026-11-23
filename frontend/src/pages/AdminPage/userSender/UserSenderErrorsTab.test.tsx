/** «Помилки user-sender»: вид помилки з поясненням, фільтр, обнулення з підтвердженням. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ getTelegramUserSendErrors: vi.fn(), clearTelegramUserSendErrors: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { UserSenderErrorsTab } from './UserSenderErrorsTab';

const ROWS = [
  { id: 1, contact: '@olena', contactType: 'username', errorCode: 2, errorText: 'Traceback…\ntelethon.errors.PeerFloodError: PEER_FLOOD', createdAt: new Date().toISOString() },
  { id: 2, contact: '380671112233', contactType: 'phone', errorCode: 2, errorText: 'RPCError: PRIVACY_PREMIUM_REQUIRED', createdAt: '2026-10-01T10:00:00Z' },
];

const renderTab = () =>
  render(
    <MemoryRouter>
      <UserSenderErrorsTab />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.getTelegramUserSendErrors.mockResolvedValue(ROWS);
  api.clearTelegramUserSendErrors.mockResolvedValue({ deleted: 2 });
});

describe('UserSenderErrorsTab', () => {
  it('рядок: контакт, тип, вид з поясненням, повний текст у згортці', async () => {
    renderTab();
    const row = await screen.findByRole('listitem', { name: 'Помилка #1' });
    expect(row).toHaveTextContent('@olena');
    expect(row).toHaveTextContent('@username');
    expect(row).toHaveTextContent('PEER_FLOOD');
    expect(row).toHaveTextContent('Telegram тимчасово обмежив акаунт');
    expect(within(row).getByText('повний текст')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '«Сповіщення»' })).toHaveAttribute('href', '/admin/notifications');
  });

  it('фільтр за видом і обнулення лише після підтвердження', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderTab();
    await screen.findByRole('list', { name: 'Помилки' });
    await user.click(screen.getByRole('button', { name: 'PRIVACY_PREMIUM_REQUIRED 1' }));
    expect(within(screen.getByRole('list', { name: 'Помилки' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/лише від Premium/, { selector: '.usend-hint' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Обнулити' }));
    expect(api.clearTelegramUserSendErrors).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Обнулити' }));
    expect(api.clearTelegramUserSendErrors).toHaveBeenCalled();
    expect(await screen.findByText('Обнулено: видалено 2 записів.')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
