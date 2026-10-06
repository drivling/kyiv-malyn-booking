/**
 * Модалка бронювання маршрутки: для «Зубастика» (Київ ↔ Малин) заявка й далі йде в POST /bookings,
 * але до і після відправлення модалка явно каже, що онлайн-бронювання не працює — лише за телефоном.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { Schedule } from '@/types';
import { BusBookingModal } from './BusBookingModal';

const schedule = (route: string): Schedule =>
  ({
    id: 101,
    route,
    departureTime: '08:00',
    maxSeats: 14,
    supportPhone: '+380501112233',
    priceUah: 280,
    vehicleType: 'marshrutka',
    createdAt: '',
    updatedAt: '',
  }) as unknown as Schedule;

function renderModal(route: string) {
  const posted: unknown[] = [];
  server.use(
    http.post(`${TEST_API_URL}/bookings`, async ({ request }) => {
      const body = await request.json();
      posted.push(body);
      return HttpResponse.json({ id: 1, ...(body as object), createdAt: '' }, { status: 201 });
    })
  );
  render(
    <MemoryRouter>
      <BusBookingModal
        schedule={schedule(route)}
        date="2026-12-01"
        fromCity="Kyiv"
        toCity="Malyn"
        initialAvailability={{ scheduleId: 101, maxSeats: 14, bookedSeats: 0, availableSeats: 14, isAvailable: true }}
        onClose={vi.fn()}
      />
    </MemoryRouter>
  );
  return posted;
}

async function submit() {
  const user = userEvent.setup();
  const dialog = screen.getByRole('dialog');
  await user.clear(within(dialog).getByPlaceholderText('0501234567'));
  await user.type(within(dialog).getByPlaceholderText('0501234567'), '0501234567');
  await user.type(within(dialog).getByPlaceholderText('Іван Петренко'), 'Іван Петренко');
  await user.click(within(dialog).getByRole('button', { name: 'Забронювати' }));
  await screen.findByText('Заявку прийнято');
}

describe('BusBookingModal', () => {
  it('«Зубастик»: попередження до відправлення, заявка йде в базу, після — «місце ще не заброньоване»', async () => {
    const posted = renderModal('Kyiv-Malyn-Irpin');
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Онлайн-бронювання поки не працює');
    expect(note).toHaveTextContent('лише за телефоном');
    expect(within(note).getByRole('link', { name: '093 192 00 08' })).toHaveAttribute('href', 'tel:+380931920008');

    await submit();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ scheduleId: 101, route: 'Kyiv-Malyn-Irpin', seats: 1 });
    const after = screen.getByRole('note');
    expect(after).toHaveTextContent('Місце ще не заброньоване');
    expect(after).toHaveTextContent('Зателефонуйте, щоб забронювати місце');
    expect(screen.queryByText(/Для підтвердження зручно зателефонувати/)).not.toBeInTheDocument();
  });

  it('інші напрямки — без попередження, як раніше', async () => {
    const posted = renderModal('Malyn-Zhytomyr-Potiivka');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    await submit();
    expect(posted).toHaveLength(1);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText(/Для підтвердження зручно зателефонувати/)).toBeInTheDocument();
  });
});
