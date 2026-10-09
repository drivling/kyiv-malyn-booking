/**
 * Шапка: гість / Telegram-користувач / адмін; доступні назви дій не залежать від ширини
 * (на телефоні текст ховається CSS, aria-label лишається).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, within } from '@/test/utils';
import { userState } from '@/utils/userState';
import { NavBar } from './NavBar';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderNav(path = '/transport') {
  return renderWithProviders(
    <>
      <NavBar />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </>,
    { initialEntries: [path] }
  );
}

afterEach(() => {
  localStorage.clear();
});

describe('NavBar', () => {
  it('guest: four site links and «Логін»; the city is a separate span so it can hide on narrow screens', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Головне меню' });
    expect(within(nav).getByRole('link', { name: 'Міжміські' })).toHaveAttribute('href', '/mizhgorodski');
    const transport = within(nav).getByRole('link', { name: /^Транспорт/ });
    expect(transport).toHaveAttribute('href', '/transport');
    expect(transport.querySelector('.nav-link-city')).toHaveTextContent(/\S/);
    expect(within(nav).getByRole('link', { name: 'Про нас' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Допомога' })).toBeInTheDocument();
    const login = within(nav).getByRole('link', { name: 'Логін' });
    expect(login).toHaveAttribute('href', '/login');
    expect(login.querySelector('svg')).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Вийти' })).not.toBeInTheDocument();
    expect(nav.className).toContain('app-nav--bbc');
  });

  it('telegram user: profile chip named by phone, «Вийти» clears the state and goes to /mizhgorodski', async () => {
    const user = userEvent.setup();
    userState.loginTelegram({ id: 1, first_name: 'Олена', auth_date: 1, hash: 'h' }, '+380671234567');
    renderNav('/user');
    const nav = screen.getByRole('navigation', { name: 'Головне меню' });
    const profile = within(nav).getByRole('link', { name: 'Мій профіль: +380671234567' });
    expect(profile).toHaveAttribute('href', '/user');
    expect(within(nav).queryByRole('link', { name: 'Логін' })).not.toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: 'Вийти' }));
    expect(userState.get()).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/mizhgorodski');
    expect(within(nav).getByRole('link', { name: 'Логін' })).toBeInTheDocument();
  });

  it('telegram user without a phone is named by first name', () => {
    userState.loginTelegram({ id: 2, first_name: 'Ігор', auth_date: 1, hash: 'h' }, '');
    renderNav();
    expect(screen.getByRole('link', { name: 'Мій профіль: Ігор' })).toBeInTheDocument();
  });

  it('admin on /admin: «Адмін панель» keeps its words, «Вийти» present, admin palette class', () => {
    userState.loginAdmin('token');
    renderNav('/admin');
    const nav = screen.getByRole('navigation', { name: 'Головне меню' });
    expect(within(nav).getByRole('link', { name: 'Адмін панель' })).toHaveAttribute('href', '/admin');
    expect(within(nav).getByRole('button', { name: 'Вийти' })).toBeInTheDocument();
    expect(nav.className).toContain('app-nav--admin');
  });
});
