/** «Реклама»: розділи з лічильниками, розсилка всім лише після підтвердження, нагадування й заблоковані, профілі. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getChannelPromoPersons: vi.fn(),
  sendChannelPromo: vi.fn(),
  createPerson: vi.fn(),
  getTelegramReminderPersons: vi.fn(),
  sendTelegramReminders: vi.fn(),
  sendReferralPromo: vi.fn(),
  sendReminderViaUserAccount: vi.fn(),
  importViberAnalytics: vi.fn(),
  getViberAnalyticsSummary: vi.fn(),
  getViberAnalyticsPromoScenarios: vi.fn(),
  sendViberAnalyticsPersonPromo: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { PromoTab } from './PromoTab';

function Shell() {
  const { section } = useParams<{ section?: string }>();
  return <PromoTab section={section} />;
}
function renderAt(path = '/admin/promo') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/:tab?/:section?" element={<Shell />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getChannelPromoPersons.mockResolvedValue([
    { id: 1, phoneNormalized: '380671112233', fullName: 'Олена' },
    { id: 2, phoneNormalized: '380931234567', fullName: null },
  ]);
  api.getTelegramReminderPersons.mockResolvedValue([{ id: 5, phoneNormalized: '380501112233', fullName: 'Петро', telegramReminderSentAt: null }]);
  api.sendChannelPromo.mockResolvedValue({ sent: [{ phone: '380671112233', fullName: 'Олена', via: 'sms' }], notFound: [{ phone: '380931234567', fullName: null }], smsSent: 1 });
  api.sendTelegramReminders.mockResolvedValue({ success: true, total: 1, sent: 0, failed: 1, message: '', blocked: [{ id: 5, phoneNormalized: '380501112233', fullName: 'Петро' }] });
  api.sendReminderViaUserAccount.mockResolvedValue({ success: true, sent: 1, failed: 0, message: 'Відправлено 1' });
});

describe('PromoTab', () => {
  it('розділи з лічильниками й «Надіслати всім» лише після підтвердження', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderAt();
    const list = await screen.findByRole('list', { name: 'Кому піде реклама каналу' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    const nav = screen.getByRole('navigation', { name: 'Розділи «Реклама»' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Реклама каналу 2', 'Нагадування в боті 1', 'Постійні клієнти']);

    await user.click(screen.getByRole('button', { name: 'Надіслати всім 2' }));
    expect(api.sendChannelPromo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Надіслати всім 2' }));
    expect(api.sendChannelPromo).toHaveBeenCalledWith({ filter: 'no_communication' });
    const result = await screen.findByLabelText('Результат розсилки');
    expect(result).toHaveTextContent('платних SMS 1');
    expect(result).toHaveTextContent('не знайдено в Telegram 1');
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('фільтр «Кому» перезапитує список', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('list', { name: 'Кому піде реклама каналу' });
    await user.click(screen.getByRole('button', { name: 'Не знайдені в Telegram' }));
    expect(api.getChannelPromoPersons).toHaveBeenLastCalledWith('promo_not_found');
  });

  it('нагадування: заблокованим можна написати від свого імені', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/admin/promo/reminders');
    const list = await screen.findByRole('list', { name: 'Кому піде нагадування' });
    expect(list).toHaveTextContent('ще не нагадували');
    await user.click(screen.getByRole('button', { name: 'Нагадати всім 1' }));
    expect(api.sendTelegramReminders).toHaveBeenCalledWith({ filter: 'all' });
    const blocked = await screen.findByLabelText('Заблокували бота');
    await user.click(within(blocked).getByRole('button', { name: 'Нагадати їм від мого імені' }));
    expect(api.sendReminderViaUserAccount).toHaveBeenCalledWith(['380501112233']);
    expect(await within(blocked).findByText('Відправлено 1')).toBeInTheDocument();
  });

  it('постійні клієнти: профіль рядком і кнопки сценаріїв', async () => {
    const user = userEvent.setup();
    api.getViberAnalyticsSummary.mockResolvedValue({
      clients: [
        {
          phoneNormalized: '380671112233', fullName: 'Олена', totalRides: 7, firstRideDate: '2026-09-01', lastRideDate: '2026-11-10',
          routes: [{ route: 'Kyiv-Malyn', count: 5, share: 0.7 }], weekdayStats: [], timeOfDayStats: { morning: 5, day: 1, evening: 1, night: 0 },
          behaviorSummary: 'Їздить зранку по буднях', recommendations: ['Нагадати в понеділок'], hasTelegramBot: true, communicationFailed: false, profileRole: 'passenger',
        },
      ],
      total: 1, page: 1, pageSize: 50, totalPages: 1,
    });
    api.getViberAnalyticsPromoScenarios.mockResolvedValue({
      scenarios: [{ key: 'passenger_notify', label: 'Нагадування на тиждень', profiles: ['passenger'] }],
      scenarioKeysByProfile: { driver: [], passenger: ['passenger_notify'], mixed: [] },
    });
    api.sendViberAnalyticsPersonPromo.mockResolvedValue({ success: true, sentVia: 'bot' });
    renderAt('/admin/promo/regulars');
    await user.click(await screen.findByRole('button', { name: 'Показати профілі' }));
    const row = within(await screen.findByRole('list', { name: 'Постійні клієнти' })).getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('поїздок 7');
    expect(row).toHaveTextContent('Kyiv-Malyn (5)');
    await user.click(within(row).getByRole('button', { name: 'Нагадування на тиждень' }));
    expect(api.sendViberAnalyticsPersonPromo).toHaveBeenCalledWith('380671112233', 'passenger_notify', 'Kyiv-Malyn');
    expect(await screen.findByText('Реклама відправлена (бот).')).toBeInTheDocument();
  });
});
