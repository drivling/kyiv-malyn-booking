/**
 * Вкладка «Столова»: розбір окремої людини (панель «Писали в групі» з Джури), звіт про пропущені
 * повідомлення, прибирання замовлення, підсвітка синонімів, що лежать на кількох стравах.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { LunchDayPeople, LunchDaySummary, LunchOrderRow } from '@/types';
import { LunchTab } from './LunchTab';

const API = `${TEST_API_URL}/admin/lunch`;

const order: LunchOrderRow = {
  id: 900,
  participantId: 50,
  displayName: 'Діана',
  username: null,
  rawText: 'Пюре',
  unmatchedText: null,
  totalUah: 45,
  trayCount: 1,
  trayTotalUah: 5,
  paidUah: 0,
  debtUah: 45,
  lines: [
    { menuItemId: 1, dishId: 1, menuItemName: 'Пюре', rawName: 'Пюре', qty: 1, unitPriceUah: 40, lineTotalUah: 40 },
  ],
};

function summaryWith(orders: LunchOrderRow[], dishes?: LunchDaySummary['dishes']): LunchDaySummary {
  return {
    date: '2026-10-02',
    day: { id: 1, status: 'ordering', payeeCard: null, menuMessageId: null, updatedAt: '2026-10-02T08:00:00.000Z' },
    trayPriceUah: 5,
    dishes: dishes ?? [
      { id: 1, name: 'Пюре', priceUah: 40, trayRole: 'second', synonyms: [] },
      { id: 2, name: 'Салат грецький', priceUah: 60, trayRole: 'salad', synonyms: [] },
    ],
    menuItems: [
      { id: 1, dishId: 1, name: 'Пюре', priceUah: 40, trayRole: 'second' },
      { id: 2, dishId: 2, name: 'Салат грецький', priceUah: 60, trayRole: 'salad' },
    ],
    orders,
    payments: [],
    debts: orders.filter((o) => o.debtUah > 0),
    totals: {
      orderUah: orders.reduce((s, o) => s + o.totalUah, 0),
      paidUah: 0,
      debtUah: orders.reduce((s, o) => s + o.debtUah, 0),
    },
  };
}

const people: LunchDayPeople = {
  date: '2026-10-02',
  available: true,
  people: [
    {
      tgUserId: '111',
      name: 'Аліна',
      username: 'alina',
      isMe: false,
      participantId: null,
      orderId: null,
      hasOrder: false,
      orderTotalUah: null,
      messageCount: 2,
      messages: [
        { tgMessageId: '101', sentAt: '2026-10-02T07:36:00.000Z', editedAt: null, text: 'привіт', mediaKind: null },
        { tgMessageId: '102', sentAt: '2026-10-02T07:37:00.000Z', editedAt: null, text: 'Пюре, салат оливьє', mediaKind: null },
      ],
    },
    {
      tgUserId: '222',
      name: 'Діана',
      username: null,
      isMe: false,
      participantId: 50,
      orderId: 900,
      hasOrder: true,
      orderTotalUah: 45,
      messageCount: 1,
      messages: [{ tgMessageId: '103', sentAt: '2026-10-02T07:38:00.000Z', editedAt: null, text: 'Пюре', mediaKind: null }],
    },
  ],
};

async function peoplePanel(): Promise<HTMLElement> {
  const heading = await screen.findByText(/Писали в групі сьогодні/);
  return heading.closest('section') as HTMLElement;
}

async function orderRow(name: string): Promise<HTMLElement> {
  return (await screen.findByText(name, { selector: 'td' })).closest('tr') as HTMLElement;
}

function useHandlers(opts: { summary?: LunchDaySummary; people?: LunchDayPeople | 'fail' } = {}) {
  server.use(
    http.get(`${API}/today`, () => HttpResponse.json(opts.summary ?? summaryWith([order]))),
    http.get(`${API}/day-people`, () =>
      opts.people === 'fail' ? HttpResponse.json({ error: 'x' }, { status: 500 }) : HttpResponse.json(opts.people ?? people)
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LunchTab · розбір окремої людини', () => {
  it('панель показує лише тих, у кого немає замовлення; «і з замовленням» розкриває решту', async () => {
    useHandlers();
    const user = userEvent.setup();
    render(<LunchTab />);

    expect(await screen.findByText(/Писали в групі сьогодні · без замовлення \(1\)/)).toBeInTheDocument();
    const panel = screen.getByText(/Писали в групі сьогодні/).closest('section') as HTMLElement;
    expect(within(panel).getByText('Аліна')).toBeInTheDocument();
    expect(within(panel).getByText('Пюре, салат оливьє')).toBeInTheDocument();
    expect(within(panel).queryByText('Діана')).toBeNull();

    await user.click(within(panel).getByRole('checkbox', { name: /і з замовленням \(1\)/ }));
    expect(within(panel).getByText('Діана')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Перерозібрати' })).toBeInTheDocument();
  });

  it('«Розібрати» шле tgUserId з notify і показує звіт із причиною пропуску', async () => {
    useHandlers();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/reparse-person`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          ok: true,
          reparse: {
            scanned: 2,
            orders: 1,
            payments: 0,
            skipped: 1,
            placeholder: true,
            source: 'telegram',
            person: { tgUserId: '111', name: 'Аліна' },
            details: [
              { messageId: 101, name: 'Аліна', text: 'привіт', outcome: 'skipped', reason: 'жодна страва не збіглась з меню' },
              {
                messageId: 102,
                name: 'Аліна',
                text: 'Пюре, салат оливьє',
                outcome: 'order',
                reason: 'не розпізнано: салат оливьє',
              },
            ],
          },
          summary: summaryWith([order]),
        });
      })
    );
    const user = userEvent.setup();
    render(<LunchTab />);

    await user.click(within(await peoplePanel()).getByRole('button', { name: 'Розібрати' }));

    expect(bodies).toEqual([{ tgUserId: '111', notify: true }]);
    const report = await screen.findByRole('region', { name: 'Звіт розбору' });
    expect(within(report).getByText('Розбір: Аліна')).toBeInTheDocument();
    expect(within(report).getByText(/жодна страва не збіглась з меню/)).toBeInTheDocument();
    expect(within(report).getByText(/не розпізнано: салат оливьє/)).toBeInTheDocument();
    expect(await screen.findByText(/додано порожнім рядком/)).toBeInTheDocument();
  });

  it('вимкнений чекбокс підтвердження → notify:false', async () => {
    useHandlers();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/reparse-person`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true, reparse: { orders: 1, person: { tgUserId: '111', name: 'Аліна' } }, summary: summaryWith([order]) });
      })
    );
    const user = userEvent.setup();
    render(<LunchTab />);
    const panel = await peoplePanel();
    await user.click(within(panel).getByRole('checkbox', { name: /Написати людині підтвердження/ }));
    await user.click(within(panel).getByRole('button', { name: 'Розібрати' }));
    await screen.findByText(/Аліна: розібрано/);
    expect(bodies).toEqual([{ tgUserId: '111', notify: false }]);
  });

  it('нічого не знайдено → помилка з пересиланням на звіт, замовлень не додано', async () => {
    useHandlers();
    server.use(
      http.post(`${API}/reparse-person`, () =>
        HttpResponse.json({
          ok: true,
          reparse: {
            orders: 0,
            payments: 0,
            errors: ['У цієї людини за день не знайдено повідомлень, схожих на замовлення чи оплату'],
            person: { tgUserId: '111', name: 'Аліна' },
          },
          summary: summaryWith([order]),
        })
      )
    );
    const user = userEvent.setup();
    render(<LunchTab />);
    await user.click(within(await peoplePanel()).getByRole('button', { name: 'Розібрати' }));
    expect(await screen.findByText(/нічого схожого на замовлення чи оплату не знайдено/)).toBeInTheDocument();
  });

  it('кнопка «Розібрати» біля замовлення шле participantId', async () => {
    useHandlers({ people: 'fail' });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/reparse-person`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true, reparse: { orders: 1, person: { tgUserId: '222', name: 'Діана' } }, summary: summaryWith([order]) });
      })
    );
    const user = userEvent.setup();
    render(<LunchTab />);
    const row = await orderRow('Діана');
    await user.click(within(row).getByRole('button', { name: 'Розібрати' }));
    await screen.findByText(/Діана: розібрано/);
    expect(bodies).toEqual([{ participantId: 50, notify: true }]);
  });

  it('«Прибрати» питає підтвердження і викликає DELETE', async () => {
    useHandlers({ people: 'fail' });
    const deleted: string[] = [];
    server.use(
      http.delete(`${API}/orders/900`, ({ request }) => {
        deleted.push(new URL(request.url).pathname);
        return HttpResponse.json({ ok: true, summary: summaryWith([]) });
      })
    );
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    render(<LunchTab />);
    const row = await orderRow('Діана');

    confirm.mockReturnValueOnce(false);
    await user.click(within(row).getByRole('button', { name: 'Прибрати' }));
    expect(deleted).toEqual([]);

    confirm.mockReturnValueOnce(true);
    await user.click(within(row).getByRole('button', { name: 'Прибрати' }));
    await screen.findByText(/Замовлення «Діана» прибрано/);
    expect(deleted).toEqual(['/admin/lunch/orders/900']);
  });

  it('якщо Джура недоступна — вкладка працює, панель просто порожня', async () => {
    useHandlers({ people: 'fail' });
    render(<LunchTab />);
    expect(await screen.findByText(/Писали в групі сьогодні · без замовлення \(0\)/)).toBeInTheDocument();
    expect(screen.getByText('Діана', { selector: 'td' })).toBeInTheDocument();
  });

  it('синонім, що лежить на двох стравах, підсвічений як конфлікт', async () => {
    useHandlers({
      summary: summaryWith([], [
        { id: 1, name: 'Пюре', priceUah: 40, trayRole: 'second', synonyms: [] },
        {
          id: 2,
          name: 'Салат грецький',
          priceUah: 60,
          trayRole: 'salad',
          synonyms: [{ id: 10, rawText: 'салат оливьє', rawNorm: 'салат оливе' }],
        },
        {
          id: 3,
          name: "Салат Олів'є",
          priceUah: 50,
          trayRole: 'salad',
          synonyms: [
            { id: 11, rawText: 'салат оливьє', rawNorm: 'салат оливе' },
            { id: 12, rawText: 'олівʼє', rawNorm: 'оліве' },
          ],
        },
      ]),
    });
    const { container } = render(<LunchTab />);
    await screen.findByText(/База страв \(3\)/);
    const conflicts = container.querySelectorAll('.lunch-syn-chip--conflict');
    expect(conflicts).toHaveLength(2);
    expect(container.querySelectorAll('.lunch-syn-chip')).toHaveLength(3);
  });
});
