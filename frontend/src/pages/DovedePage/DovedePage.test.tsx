import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { apiClient } from '@/api/client';
import type { PoputkySearchResponse, Schedule } from '@/types';
import DovedePage from './DovedePage';

const train: Schedule = {
  id: 2,
  route: 'Kyiv-Malyn',
  departureTime: '14:51',
  arrivalTime: '17:11',
  durationMinutes: 140,
  vehicleType: 'elektrichka',
  boardingPlace: 'Київ-Пас. (Приміський)',
  alightingPlace: 'Малин',
  tripNumber: '6613',
  priceUah: 60,
  ticketPurchaseUrl: 'https://lnk.ua/x',
  activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  maxSeats: 20,
  supportPhone: null,
  createdAt: '',
  updatedAt: '',
};

describe('«Доведе» — сторінка (фаза 1, без ШІ)', () => {
  beforeEach(() => {
    // лише Date: пʼятниця 13.11.2026, 14:20 за Києвом; таймери справжні (waitFor)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:20:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('питання → розклад коридору → історія електрички без пересадок', async () => {
    const search = vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue({
      from: null,
      to: null,
      date: '2026-11-13',
      listings: [],
      schedules: [train],
      availability: {},
    } satisfies PoputkySearchResponse);
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва (Святошин) до Малина на вокзал{Enter}');

    expect(await screen.findByText(/Електричка 6613 о ≈15:16 з платформи «Святошин»/)).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith({ from: 'Kyiv', to: 'Malyn', date: '2026-11-13' });
    expect(screen.getByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Квиток ↗' })).toHaveAttribute('href', 'https://lnk.ua/x');
    expect(screen.getByText('Розумію:')).toBeInTheDocument();
  });

  it('незнайоме місце — чесна відповідь, без запиту розкладу', async () => {
    const search = vi.spyOn(apiClient, 'searchPoputky');
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'з Ковалівки до Малина{Enter}');
    expect(await screen.findByText('Не знаю, де це: «Ковалівки»')).toBeInTheDocument();
    await waitFor(() => expect(search).not.toHaveBeenCalled());
  });
});
