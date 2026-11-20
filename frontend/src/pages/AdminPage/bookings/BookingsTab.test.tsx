/** «Бронювання»: плитки, «попереду» за замовчуванням, дні поїздок, фільтр з адреси, видалення з підтвердженням. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Booking } from '@/types';
import { addDays, kyivDate } from './bookingsText';

const api = vi.hoisted(() => ({ getBookings: vi.fn(), deleteBooking: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { BookingsTab } from './BookingsTab';

const today = kyivDate();
const day = (n: number) => `${addDays(today, n)}T00:00:00.000Z`;
const b = (over: Partial<Booking>): Booking => ({
  id: 1, route: 'Kyiv-Malyn-Irpin', date: day(0), departureTime: '08:00', seats: 1, name: 'Олена', phone: '380671112233',
  scheduleId: 1, source: 'schedule', createdAt: new Date().toISOString(), ...over,
});
const LIST = [
  b({ id: 1, departureTime: '18:00', seats: 2 }),
  b({ id: 2, date: day(1), source: 'viber_match', viberListingId: 77, name: 'Петро', seats: 3 }),
  b({ id: 3, date: day(-3), name: 'Марта' }),
];

function renderAt(path = '/admin/bookings') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BookingsTab />
    </MemoryRouter>
  );
}

const ids = () => screen.queryAllByRole('listitem').map((li) => li.getAttribute('aria-label'));

beforeEach(() => {
  vi.clearAllMocks();
  api.getBookings.mockResolvedValue(LIST);
  api.deleteBooking.mockResolvedValue(undefined);
});

describe('BookingsTab', () => {
  it('плитки й дні поїздок: за замовчуванням лише попереду', async () => {
    renderAt();
    const todaySection = await screen.findByRole('region', { name: /^Сьогодні, / });
    expect(todaySection).toHaveTextContent('бронювань 1 · 2 місця');
    expect(screen.getByRole('region', { name: /^Завтра, / })).toHaveTextContent('попутка · оголошення #77');
    expect(ids()).toEqual(['Бронювання #1', 'Бронювання #2']);
    const tile = (label: string) => screen.getByText(label, { selector: '.admin-kit-tile-label' }).closest('.admin-kit-tile') as HTMLElement;
    expect(tile('Попереду')).toHaveTextContent('2 5 місць · попуток 1');
    expect(tile('Сьогодні')).toHaveAttribute('href', '/admin/bookings?when=today');
    expect(screen.getByRole('button', { name: 'Попереду 2' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('?when=past показує минулі; тип «Попутки» звужує', async () => {
    const user = userEvent.setup();
    renderAt('/admin/bookings?when=past');
    await screen.findByRole('region', { name: /, / });
    expect(ids()).toEqual(['Бронювання #3']);
    await user.click(screen.getByRole('button', { name: 'Усі 3' }));
    await user.click(screen.getByRole('button', { name: 'Попутки' }));
    expect(ids()).toEqual(['Бронювання #2']);
  });

  it('видалення питає підтвердження', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderAt();
    const row = await screen.findByRole('listitem', { name: 'Бронювання #1' });
    await user.click(within(row).getByRole('button', { name: 'Видалити' }));
    expect(api.deleteBooking).not.toHaveBeenCalled();
    await user.click(within(row).getByRole('button', { name: 'Видалити' }));
    expect(api.deleteBooking).toHaveBeenCalledWith(1);
    expect(await screen.findByText('Бронювання #1 видалено.')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
