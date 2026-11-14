/**
 * Дошка попуток «Доведе»: записки водіїв і відривний корінець — номера в розмітці немає, доки його не «відірвуть».
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { ComposeOutcome } from '../compose/types';
import { PoputkyCard, slipNumber } from './RideBoard';

type Poputky = Extract<ComposeOutcome, { kind: 'poputky' }>;

const INFO: Poputky = {
  kind: 'poputky',
  fromCity: 'Kyiv',
  toCity: 'Malyn',
  fromLabel: 'Київ',
  toLabel: 'Малин',
  rides: [
    { id: 7, time: '08:20-08:30', seats: 3, priceUah: 250, notes: 'м. Житомирська', name: 'Микола Науменко' },
    { id: 8, time: null, seats: null, priceUah: null, notes: null, name: null },
  ],
  more: 2,
  passengers: 1,
  boardUrl: '/mizhgorodski?type=carpool&from=Kyiv&to=Malyn&date=2026-11-14',
};

const renderBoard = (info: Poputky = INFO) =>
  render(
    <MemoryRouter>
      <PoputkyCard info={info} dateLabel="завтра, субота" />
    </MemoryRouter>,
  );

describe('дошка попуток', () => {
  it('записка: час, скорочене імʼя, місця, ціна й примітка; номера в розмітці немає', () => {
    const { container } = renderBoard();
    const notes = screen.getAllByRole('listitem');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toHaveTextContent('08:20–08:30');
    expect(within(notes[0]).getByText('Микола Н.')).toBeInTheDocument();
    expect(within(notes[0]).getByText('місць: 3')).toBeInTheDocument();
    expect(within(notes[0]).getByText('250 грн')).toBeInTheDocument();
    expect(within(notes[0]).getByText('м. Житомирська')).toBeInTheDocument();
    expect(notes[1]).toHaveTextContent('час не вказано');
    expect(within(notes[1]).getByText('Водій')).toBeInTheDocument();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.getByText('ще 2 на дошці · шукають попутку: 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Уся дошка попуток →' })).toHaveAttribute('href', INFO.boardUrl);
  });

  it('«Відірвати номер» питає контакт саме цього оголошення й перетворює корінець на посилання', async () => {
    const asked: string[] = [];
    server.use(
      http.get(`${TEST_API_URL}/viber-listings/:id/contact`, ({ params }) => {
        asked.push(String(params.id));
        return HttpResponse.json({ contact: '380501234567' });
      }),
    );
    renderBoard();
    await userEvent.click(screen.getAllByRole('button', { name: /Відірвати номер/ })[0]);
    const call = await screen.findByRole('link', { name: /Подзвонити/ });
    expect(call).toHaveAttribute('href', 'tel:380501234567');
    expect(within(call).getByLabelText('+380 50 123 45 67')).toBeInTheDocument();
    expect(asked).toEqual(['7']);
    // другий корінець лишився на місці
    expect(screen.getAllByRole('button', { name: /Відірвати номер/ })).toHaveLength(1);
  });

  it('не вдалося — корінець на місці й каже про це; Telegram відкривається як посилання', async () => {
    let fail = true;
    server.use(
      http.get(`${TEST_API_URL}/viber-listings/:id/contact`, () => (fail ? HttpResponse.json({ error: 'x' }, { status: 404 }) : HttpResponse.json({ contact: '@vasyl_driver' }))),
    );
    renderBoard({ ...INFO, rides: [INFO.rides[0]] });
    await userEvent.click(screen.getByRole('button', { name: /Відірвати номер/ }));
    const retry = await screen.findByRole('button', { name: /Не відірвалось — ще раз/ });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByRole('link', { name: /Написати в Telegram/ })).toHaveAttribute('href', 'https://t.me/vasyl_driver');
  });

  it('порожня дошка й примітка', () => {
    renderBoard({ ...INFO, rides: [], more: 0, passengers: 0, notice: 'На цей час оголошень немає — ось усі за день.' });
    expect(screen.getByText('На цей день оголошень від водіїв поки немає.')).toBeInTheDocument();
    expect(screen.getByText('На цей час оголошень немає — ось усі за день.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити дошку попуток →' })).toBeInTheDocument();
  });

  it('номер на корінці — групами, як його диктують', () => {
    expect(slipNumber('380501234567')).toBe('+380 50 123 45 67');
    expect(slipNumber('+38 (050) 123-45-67')).toBe('+380 50 123 45 67');
    expect(slipNumber('@vasyl_driver')).toBe('@vasyl_driver');
  });
});
