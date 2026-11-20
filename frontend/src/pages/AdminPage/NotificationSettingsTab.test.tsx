/** «Сповіщення»: стан каналів, лічильники біля вимикачів, вимикачі зберігаються одразу, ліміт за id, SMS-рядки. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationSettings, NotificationSettingsUsage } from '@/types';

const api = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(),
  getNotificationSettingsUsage: vi.fn(),
  updateNotificationSettings: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { NotificationSettingsTab } from './NotificationSettingsTab';

const SETTINGS: NotificationSettings = {
  id: 1,
  smsFallbackEnabled: false,
  smsMatchEnabled: true,
  smsAuthorConfirmationEnabled: false,
  smsBookingReminderEnabled: false,
  smsInactivityReminderEnabled: false,
  smsChannelPromoEnabled: false,
  smsMatchTypeThreshold: 'exact',
  smsDailyCap: 50,
  smsMonthlyCap: 1000,
  turboSmsSender: null,
  hasToken: true,
  tokenHint: '••••1234',
  tgUserMatchEnabled: true,
  tgUserAuthorConfirmationEnabled: true,
  tgUserByIdEnabled: true,
  tgUserByIdDailyCap: null,
  updatedAt: '2026-11-20T10:00:00Z',
};

const USAGE: NotificationSettingsUsage = {
  sentToday: 2,
  capToday: 50,
  sentThisMonth: 9,
  capThisMonth: 1000,
  recent: [
    { id: 7, phoneNormalized: '380931234567', useCase: 'match', channel: 'sms', status: 'failed', segments: 2, errorText: 'balance', createdAt: '2026-11-20T09:00:00Z', sentAt: null },
  ],
  smsByUseCase: { match: { sent: 9, failed: 1 } },
  telegramUser: {
    configured: true,
    today: { sent: 3, failed: 1 },
    month: { sent: 40, failed: 6 },
    byPurpose: { match: { sent: 25, failed: 4 }, authorConfirmation: { sent: 12, failed: 2 }, promo: { sent: 3, failed: 0 } },
    byId: { enabled: true, lockedBy: null, cap: 20, defaultCap: 20, usedToday: 4, flooded: true },
    recentErrors: [{ id: 1, contactType: 'user_id', errorCode: 2, errorText: 'PeerFloodError: PEER_FLOOD', createdAt: '2026-11-20T08:00:00Z' }],
  },
};

beforeEach(() => {
  api.getNotificationSettings.mockResolvedValue(SETTINGS);
  api.getNotificationSettingsUsage.mockResolvedValue(USAGE);
  api.updateNotificationSettings.mockImplementation(async (p: Partial<NotificationSettings>) => ({ ...SETTINGS, ...p }));
});

describe('NotificationSettingsTab', () => {
  it('стан каналів, плитки й лічильники біля вимикачів', async () => {
    render(<NotificationSettingsTab />);
    const tiles = await screen.findByRole('group', { name: 'Відправки' });
    expect(within(tiles).getByText('Особистий акаунт сьогодні').parentElement).toHaveTextContent('3 не дійшло 1');
    expect(within(tiles).getByText('SMS за місяць').parentElement).toHaveTextContent('9 з 1000');
    expect(screen.getByText('Telegram обмежив (PEER_FLOOD)')).toBeInTheDocument();
    expect(screen.getByText('вимкнено')).toBeInTheDocument(); // SMS: головний вимикач

    const user = screen.getByRole('region', { name: 'Особистий Telegram-акаунт' });
    expect(within(user).getByText('цього місяця: 25 дійшло · 4 ні')).toBeInTheDocument();
    expect(within(user).getByText(/сьогодні 4 з 20/)).toBeInTheDocument();
    expect(within(user).getByText('PEER_FLOOD — до кінця доби не пишемо')).toBeInTheDocument();
    expect(within(user).getByText(/цього місяця 3/)).toBeInTheDocument();
    expect(within(user).getByText('PeerFloodError: PEER_FLOOD')).toBeInTheDocument();

    const sms = screen.getByRole('region', { name: 'Платні SMS' });
    expect(within(sms).getByText('цього місяця: 9 надіслано · 1 ні')).toBeInTheDocument();
    // сценарій увімкнено, а головний вимикач — ні
    expect(within(sms).getByText('не діє: головний вимикач вимкнено')).toBeInTheDocument();
    expect(within(sms).getAllByText('не задано — SMS не підуть')).toHaveLength(1);
  });

  it('вимикач зберігається одразу одним полем', async () => {
    const user = userEvent.setup();
    render(<NotificationSettingsTab />);
    await user.click(await screen.findByRole('switch', { name: 'Збіги пар водій ↔ пасажир' }));
    expect(api.updateNotificationSettings).toHaveBeenCalledWith({ tgUserMatchEnabled: false });
    expect(await screen.findByRole('status')).toHaveTextContent('Збережено: збіги пар');
  });

  it('ліміт листів за id: зберегти число, потім скинути до типового', async () => {
    const user = userEvent.setup();
    render(<NotificationSettingsTab />);
    const field = await screen.findByRole('spinbutton', { name: 'Скільки листів за id на добу' });
    await user.clear(field);
    await user.type(field, '7');
    await user.click(within(field.closest('form') as HTMLElement).getByRole('button', { name: 'Зберегти' }));
    expect(api.updateNotificationSettings).toHaveBeenCalledWith({ tgUserByIdDailyCap: 7 });
    await user.click(await screen.findByRole('button', { name: 'Скинути до типового' }));
    expect(api.updateNotificationSettings).toHaveBeenLastCalledWith({ tgUserByIdDailyCap: null });
  });

  it('змінна сервера блокує листи за id', async () => {
    api.getNotificationSettingsUsage.mockResolvedValue({
      ...USAGE,
      telegramUser: { ...USAGE.telegramUser!, byId: { ...USAGE.telegramUser!.byId, enabled: false, lockedBy: 'TELEGRAM_USER_DM_BY_ID=0' } },
    });
    render(<NotificationSettingsTab />);
    expect(await screen.findByRole('switch', { name: 'Писати незнайомим за id' })).toBeDisabled();
    expect(screen.getByText(/Вимкнено на сервері \(TELEGRAM_USER_DM_BY_ID=0\)/)).toBeInTheDocument();
  });

  it('останні SMS: помилка виділена', async () => {
    render(<NotificationSettingsTab />);
    const list = await screen.findByRole('region', { name: 'Останні SMS' });
    const row = within(list).getByRole('listitem');
    expect(row).toHaveClass('is-failed');
    expect(row).toHaveTextContent('збіг пари');
    expect(row).toHaveTextContent('balance');
    expect(row).toHaveTextContent('помилка');
  });
});
