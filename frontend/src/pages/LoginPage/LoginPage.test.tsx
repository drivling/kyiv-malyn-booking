import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { LoginPage } from '@/pages/LoginPage/LoginPage';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';

describe('LoginPage admin auth', () => {
  it('logs in as admin, persists token, redirects to /admin', async () => {
    const replace = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...loc, replace, href: loc.href, origin: loc.origin },
    });

    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { initialEntries: ['/login'] });

    await user.click(screen.getByRole('button', { name: 'Адмін' }));
    await user.type(screen.getByLabelText('Пароль адміністратора'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Увійти як адмін' }));

    await waitFor(() => {
      expect(apiClient.getAuthToken()).toBe('admin-authenticated');
    });
    expect(userState.isAdmin()).toBe(true);
    expect(localStorage.getItem('adminToken')).toBe('admin-authenticated');
    expect(replace).toHaveBeenCalledWith('/admin');

    Object.defineProperty(window, 'location', { configurable: true, value: loc });
  });

  it('shows error on failed admin login', async () => {
    server.use(
      http.post(`${TEST_API_URL}/admin/login`, () =>
        HttpResponse.json({ error: 'Невірний пароль' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { initialEntries: ['/login'] });

    await user.click(screen.getByRole('button', { name: 'Адмін' }));
    await user.type(screen.getByLabelText('Пароль адміністратора'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Увійти як адмін' }));

    expect(await screen.findByText(/Невірний пароль|Помилка|Unauthorized/i)).toBeInTheDocument();
    expect(apiClient.getAuthToken()).toBeNull();
  });
});
