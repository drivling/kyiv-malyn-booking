/**
 * Сторінка «Доведе» з місцем людини (Docs/dovede-geo-roadmap.md, Г2): людина в Малині питає без «звідки» — відповідь
 * від того місця, де вона стоїть, а не «Звідки вирушаєте?»; координати не потрапляють в адресу сторінки. Місце й мікрофон
 * — кожному, кому відкрито «Доведе» (гість із паролем теж); поки сторінка просить пароль, не питаємо нічого.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { apiClient } from '@/api/client';
import { ADMIN_TOKEN_STORAGE_KEY } from '@/utils/adminTokenStorage';
import DovedePage from '../DovedePage';
import { markIntroSeen } from '../intro/introState';
import { resetLocate } from './locate';

function LocationProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

const getCurrentPosition = vi.fn((ok: (p: GeolocationPosition) => void) => ok({ coords: { latitude: 50.7639, longitude: 29.2683, accuracy: 15 } } as GeolocationPosition));

describe('«Доведе» — звідки = де я зараз', () => {
  beforeEach(() => {
    markIntroSeen();
    resetLocate();
    getCurrentPosition.mockClear();
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:20:00Z'));
    vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: true });
    vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue({ from: null, to: null, date: '2026-11-13', listings: [], schedules: [], availability: {} });
  });
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('адмін у Малині: «як доїхати до вокзалу» — від місця людини, без «Звідки вирушаєте?» і без координат в адресі', async () => {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, 'x'.repeat(64));
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <DovedePage />
        <LocationProbe />
      </>,
      { initialEntries: ['/dovede'] },
    );
    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'як доїхати до вокзалу{Enter}');

    expect(await screen.findAllByText(/ви тут|де ви зараз/)).not.toHaveLength(0);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Звідки вирушаєте?')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('t=malyn.vokzal'));
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).not.toMatch(/[?&]f=|here|50\\.76|29\\.26/);
  });

  it('гість із паролем (без токена адміна): так само від місця людини, і є мікрофон', async () => {
    const w = window as unknown as Record<string, unknown>;
    w.webkitSpeechRecognition = function () {};
    try {
      const user = userEvent.setup();
      renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
      expect(await screen.findByRole('button', { name: 'Сказати голосом' })).toBeInTheDocument();
      await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'як доїхати до вокзалу{Enter}');
      expect(await screen.findAllByText(/ви тут|де ви зараз/)).not.toHaveLength(0);
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Звідки вирушаєте?')).toBeNull();
    } finally {
      delete w.webkitSpeechRecognition;
    }
  });

  it('сторінка просить пароль: ні мікрофона, ні геолокації', async () => {
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: false });
    const w = window as unknown as Record<string, unknown>;
    w.webkitSpeechRecognition = function () {};
    try {
      renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
      expect(await screen.findByLabelText('Пароль')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Сказати голосом' })).toBeNull();
      expect(getCurrentPosition).not.toHaveBeenCalled();
    } finally {
      delete w.webkitSpeechRecognition;
    }
  });
});
