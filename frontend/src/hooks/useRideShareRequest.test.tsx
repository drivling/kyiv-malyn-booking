/**
 * useRideShareRequest: запит на попутку з сайту йде з підписаним заголовком X-Telegram-Login, без
 * telegramUserId у тілі; 401 (підпис прострочений) → повідомлення «увійдіть ще раз», як на /user.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { userState } from '@/utils/userState';
import { encodeTelegramLogin } from '@/utils/telegramLogin';
import type { TelegramUser, ViberListing } from '@/types';
import { RIDESHARE_LOGIN_STALE_MESSAGE, useRideShareRequest } from './useRideShareRequest';

const USER: TelegramUser = { id: 123456789, first_name: 'Іван', username: 'ivan_m', auth_date: 1760000000, hash: 'ab'.repeat(32) };
const DRIVER = {
  id: 11,
  listingType: 'driver',
  route: 'Kyiv-Malyn',
  date: '2026-11-01T00:00:00.000Z',
  departureTime: '09:00',
  seats: 3,
  notes: null,
  priceUah: null,
  senderName: 'Водій',
  isActive: true,
  createdAt: '2026-10-20T00:00:00.000Z',
} as unknown as ViberListing;

beforeEach(() => {
  localStorage.clear();
  userState.loginTelegram(USER, '');
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useRideShareRequest', () => {
  it('шле POST /rideshare/request із заголовком X-Telegram-Login і лише driverListingId у тілі', async () => {
    let seen: { header: string | null; body: unknown } | null = null;
    server.use(
      http.post(`${TEST_API_URL}/rideshare/request`, async ({ request }) => {
        seen = { header: request.headers.get('X-Telegram-Login'), body: await request.json() };
        return HttpResponse.json({ success: true, requestId: 1, message: 'Запит надіслано водію.', driverNotified: true }, { status: 201 });
      }),
    );
    const onNeedLogin = vi.fn();
    const { result } = renderHook(() => useRideShareRequest({ listings: [DRIVER], onNeedLogin }));
    expect(result.current.isTelegramLoggedIn).toBe(true);
    await act(() => result.current.requestRide(11));
    expect(seen!.header).toBe(encodeTelegramLogin(USER));
    expect(seen!.body).toEqual({ driverListingId: 11 });
    await waitFor(() => expect(result.current.showRequestStatusModal).toBe(true));
    expect(result.current.requestStatusData?.driverNotified).toBe(true);
    expect(result.current.requestError).toBe('');
    expect(onNeedLogin).not.toHaveBeenCalled();
  });

  it('401 від бекенду → повідомлення «увійдіть ще раз», без модалки статусу', async () => {
    server.use(
      http.post(`${TEST_API_URL}/rideshare/request`, () => HttpResponse.json({ error: 'Сесія застаріла', reason: 'expired' }, { status: 401 })),
    );
    const { result } = renderHook(() => useRideShareRequest({ listings: [DRIVER], onNeedLogin: vi.fn() }));
    await act(() => result.current.requestRide(11));
    await waitFor(() => expect(result.current.requestError).toBe(RIDESHARE_LOGIN_STALE_MESSAGE));
    expect(result.current.requestError).toMatch(/увійдіть ще раз/);
    expect(result.current.showRequestStatusModal).toBe(false);
  });

  it('без входу через Telegram нічого не шле, а кличе onNeedLogin', async () => {
    userState.logout();
    const onNeedLogin = vi.fn();
    const { result } = renderHook(() => useRideShareRequest({ listings: [DRIVER], onNeedLogin }));
    expect(result.current.isTelegramLoggedIn).toBe(false);
    await act(() => result.current.requestRide(11));
    expect(onNeedLogin).toHaveBeenCalledTimes(1);
  });
});
