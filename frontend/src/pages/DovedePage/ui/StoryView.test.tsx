/**
 * Квиток міжміського рейсу в історії «Доведе»: маршрутку бронюють тут же — «Забронювати» відкриває модалку головної
 * (з попередженням для «Зубастика» всередині); на електричку — лише квиток перевізника; попереджень на самому квитку
 * немає (рішення власника 2026-11-19).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { Schedule } from '@/types';
import type { Story, StoryLeg } from '../compose/types';
import { StoryView } from './StoryView';

const schedule = (over: Partial<Schedule>): Schedule => ({ id: 7, route: 'Kyiv-Malyn-Irpin', departureTime: '08:00', maxSeats: 18, supportPhone: null, priceUah: 310, ...over }) as Schedule;

const leg = (mode: 'marshrutka' | 'elektrichka', s: Schedule): StoryLeg => ({
  kind: 'intercity',
  mode,
  schedule: s,
  boardLabel: 'від метро «Академмістечко»',
  boardMins: 480,
  boardApprox: false,
  alightLabel: 'на автостанції',
  alightMins: 600,
  alightApprox: true,
  usual: false,
  via: null,
  transit: null,
  routeLabel: 'Київ — Малин',
  priceUah: s.priceUah ?? null,
  fromCity: 'Kyiv',
  toCity: 'Malyn',
  ticketUrl: mode === 'elektrichka' ? 'https://example.com/ticket' : null,
  tripNumber: mode === 'elektrichka' ? '6501' : null,
  later: [],
});

const story = (l: StoryLeg): Story => ({ id: 's', mode: 'marshrutka', date: '2026-11-20', leaveMins: 470, arriveMins: 600, arriveApprox: true, fromLabel: 'Київ', toLabel: 'Малин', legs: [l], endLabel: 'Малин', endNote: null, priceUah: 310, transfers: 0, lead: '' });

const renderStory = (s: Story) =>
  render(
    <MemoryRouter>
      <StoryView story={s} stopName={(id) => id} />
    </MemoryRouter>,
  );

describe('квиток міжміського рейсу', () => {
  it('маршрутка: «Забронювати» відкриває модалку бронювання головної; на квитку попереджень немає', async () => {
    server.use(http.get(`${TEST_API_URL}/schedules/:id/availability`, () => HttpResponse.json({ isAvailable: true, availableSeats: 10, maxSeats: 18, bookedSeats: 8 })));
    renderStory(story(leg('marshrutka', schedule({}))));
    expect(screen.queryByText(/лише телефоном|не працює/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Квиток ↗' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Забронювати' }));
    expect(await screen.findByRole('heading', { name: 'Бронювання маршрутки' })).toBeInTheDocument();
    expect(document.querySelector('.mizh-page.dv-booking .mizh-modal')).not.toBeNull();
  });

  it('електричка: квиток перевізника, без «Забронювати»', () => {
    renderStory(story(leg('elektrichka', schedule({ route: 'Kyiv-Malyn', vehicleType: 'elektrichka' }))));
    expect(screen.getByRole('link', { name: 'Квиток ↗' })).toHaveAttribute('href', 'https://example.com/ticket');
    expect(screen.queryByRole('button', { name: 'Забронювати' })).toBeNull();
  });
});
