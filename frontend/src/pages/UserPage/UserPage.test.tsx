/**
 * /user: підписаний заголовок X-Telegram-Login у запитах, «Мої дані» — експорт файлом і видалення акаунта,
 * прострочений підпис → запрошення увійти знову (Docs/transport-open-data-2026-10.md, фаза 4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { UserPage } from './UserPage';
import { userState } from '@/utils/userState';
import { encodeTelegramLogin } from '@/utils/telegramLogin';
import type { TelegramUser } from '@/types';

const USER: TelegramUser = { id: 123456789, first_name: 'Іван', username: 'ivan_m', auth_date: 1760000000, hash: 'ab'.repeat(32) };
const PROFILE = {
  person: { id: 42, fullName: 'Іван Тест', phoneNormalized: '380671234567', telegramUserId: '123456789' },
  bookings: [],
  passengerListings: [],
  driverListings: [],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/user" element={<UserPage />} />
      <Route path="/login" element={<p>Сторінка входу</p>} />
      <Route path="/" element={<p>Головна</p>} />
    </Routes>,
    { initialEntries: ['/user'] },
  );
}

beforeEach(() => {
  localStorage.clear();
  userState.loginTelegram(USER, '');
  server.use(
    http.get(`${TEST_API_URL}/telegram/scenarios`, () => HttpResponse.json({ enabled: false, scenarios: {} })),
  );
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('UserPage: підпис Telegram Login', () => {
  it('профіль запитується з заголовком X-Telegram-Login (відповідь віджета цілком), без telegramUserId у query', async () => {
    let seen: { header: string | null; url: string } | null = null;
    server.use(
      http.get(`${TEST_API_URL}/user/profile`, ({ request }) => {
        seen = { header: request.headers.get('X-Telegram-Login'), url: request.url };
        return HttpResponse.json(PROFILE);
      }),
    );
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Іван Тест' })).toBeInTheDocument();
    expect(seen!.header).toBe(encodeTelegramLogin(USER));
    expect(seen!.url).not.toContain('telegramUserId');
  });

  it('401 від бекенду → запрошення увійти знову з посиланням на /login', async () => {
    server.use(http.get(`${TEST_API_URL}/user/profile`, () => HttpResponse.json({ error: 'Сесія застаріла', reason: 'expired' }, { status: 401 })));
    renderPage();
    expect(await screen.findByText(/Сесія входу через Telegram застаріла/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Увійти через Telegram' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('heading', { name: 'Мої дані' })).not.toBeInTheDocument();
  });
});

describe('UserPage: «Мої дані»', () => {
  it('«Завантажити мої дані» тягне /user/export з підписом і зберігає файл з ім\'ям із Content-Disposition', async () => {
    let header: string | null = null;
    server.use(
      http.get(`${TEST_API_URL}/user/profile`, () => HttpResponse.json(PROFILE)),
      http.get(`${TEST_API_URL}/user/export`, ({ request }) => {
        header = request.headers.get('X-Telegram-Login');
        return new HttpResponse(JSON.stringify({ schemaVersion: 1 }), {
          headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="malin-kiev-ua-my-data-2026-10-20.json"' },
        });
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked.push(this.download);
    };
    try {
      renderPage();
      const section = await screen.findByRole('region', { name: 'Мої дані' });
      expect(within(section).getByRole('link', { name: 'політиці конфіденційності' })).toHaveAttribute('href', '/about#privacy-policy');
      fireEvent.click(within(section).getByRole('button', { name: 'Завантажити мої дані' }));
      await waitFor(() => expect(clicked).toEqual(['malin-kiev-ua-my-data-2026-10-20.json']));
      expect(header).toBe(encodeTelegramLogin(USER));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  it('«Видалити акаунт»: підтвердження → DELETE /user {confirm:true} → вихід із сесії і підсумок', async () => {
    let body: unknown = null;
    let header: string | null = null;
    server.use(
      http.get(`${TEST_API_URL}/user/profile`, () => HttpResponse.json(PROFILE)),
      http.delete(`${TEST_API_URL}/user`, async ({ request }) => {
        header = request.headers.get('X-Telegram-Login');
        body = await request.json();
        return HttpResponse.json({ success: true, erasedAt: '2026-10-20T10:00:00.000Z', counts: {}, summary: 'скасовано майбутніх бронювань: 1' });
      }),
    );
    renderPage();
    const section = await screen.findByRole('region', { name: 'Мої дані' });
    fireEvent.click(within(section).getByRole('button', { name: 'Видалити акаунт' }));
    const confirm = within(section).getByRole('group', { name: 'Видалити акаунт?' });
    expect(confirm).toHaveTextContent(/майбутні бронювання скасуємо/);
    // «Ні» ховає підтвердження, нічого не шле
    fireEvent.click(within(confirm).getByRole('button', { name: 'Ні, залишити' }));
    expect(within(section).queryByRole('group')).not.toBeInTheDocument();
    expect(body).toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: 'Видалити акаунт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Так, видалити акаунт' }));
    expect(await screen.findByRole('heading', { name: 'Акаунт видалено' })).toBeInTheDocument();
    expect(screen.getByText(/скасовано майбутніх бронювань: 1/)).toBeInTheDocument();
    expect(body).toEqual({ confirm: true });
    expect(header).toBe(encodeTelegramLogin(USER));
    expect(userState.get()).toBeNull();
    expect(screen.getByRole('link', { name: 'На головну' })).toHaveAttribute('href', '/');
  });
});
