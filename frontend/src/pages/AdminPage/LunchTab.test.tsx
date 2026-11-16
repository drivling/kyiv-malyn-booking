/**
 * Вкладка «Столова»: розбір окремої людини (панель «Писали в групі» з Джури), звіт про пропущені
 * повідомлення, прибирання замовлення, підсвітка синонімів, що лежать на кількох стравах,
 * «Оплатив» і правка нашої відповіді в групі.
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
    await user.click(within(panel).getByRole('checkbox', { name: /Підтвердження в групі/ }));
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

describe('LunchTab · наша відповідь у групі', () => {
  it('«Оплатив» шле participantId і каже, що «✅ Оплатив» дописується правкою відповіді', async () => {
    useHandlers();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/pay`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          ok: true,
          payment: { amountUah: 45, ordered: 45, paid: 45, debt: 0 },
          summary: summaryWith([{ ...order, paidUah: 45, debtUah: 0 }]),
          telegramQueued: true,
          telegramError: null,
          hasReply: true,
        });
      })
    );
    const user = userEvent.setup();
    render(<LunchTab />);

    await user.click(within(await orderRow('Діана')).getByRole('button', { name: 'Оплатив' }));

    expect(bodies).toEqual([{ participantId: 50 }]);
    expect(await screen.findByText(/«✅ Оплатив» у відповіді в групі поставлено в чергу на правку/)).toBeInTheDocument();
  });

  it('«Оплатив» без нашої відповіді в групі — так і каже', async () => {
    useHandlers();
    server.use(
      http.post(`${API}/pay`, () =>
        HttpResponse.json({
          ok: true,
          payment: { amountUah: 45, ordered: 45, paid: 45, debt: 0 },
          summary: summaryWith([{ ...order, paidUah: 45, debtUah: 0 }]),
          telegramQueued: false,
          telegramError: null,
          hasReply: false,
        })
      )
    );
    const user = userEvent.setup();
    render(<LunchTab />);
    await user.click(within(await orderRow('Діана')).getByRole('button', { name: 'Оплатив' }));
    expect(await screen.findByText(/нашої відповіді в групі немає/)).toBeInTheDocument();
  });

  it('звіт «Розібрати»: попередню відповідь правимо, а не пишемо нову', async () => {
    useHandlers();
    server.use(
      http.post(`${API}/reparse-person`, () =>
        HttpResponse.json({
          ok: true,
          reparse: {
            scanned: 1,
            orders: 1,
            payments: 0,
            skipped: 0,
            notified: true,
            notifiedEdit: true,
            person: { tgUserId: '111', name: 'Аліна' },
            details: [],
          },
          summary: summaryWith([order]),
        })
      )
    );
    const user = userEvent.setup();
    render(<LunchTab />);
    await user.click(within(await peoplePanel()).getByRole('button', { name: 'Розібрати' }));
    const report = await screen.findByRole('region', { name: 'Звіт розбору' });
    expect(within(report).getByText(/нашу відповідь у групі поставлено в чергу на правку/)).toBeInTheDocument();
  });
});

describe('LunchTab · чеки, готівка і порівняння моделей', () => {
  it('готівку видно біля боргу, а в «Оплатах» — звідки кожна оплата', async () => {
    const cashOrder: LunchOrderRow = { ...order, cashPromised: true };
    const paid: LunchOrderRow = { ...order, id: 901, participantId: 51, displayName: 'Лера', paidUah: 45, debtUah: 0 };
    const summary: LunchDaySummary = {
      ...summaryWith([cashOrder, paid]),
      payments: [
        { id: 1, displayName: 'Лера', amountUah: 45, rawText: 'чек (photo): 45 грн', source: 'receipt', createdAt: '2026-10-02T08:00:00.000Z' },
        { id: 2, displayName: 'Марта', amountUah: 90, rawText: 'чек за посиланням (суму не перевірено)', source: 'link', createdAt: '2026-10-02T08:01:00.000Z' },
      ],
    };
    server.use(
      http.get(`${API}/today`, () => HttpResponse.json(summary)),
      http.get(`${API}/day-people`, () => HttpResponse.json(people)),
    );
    render(<LunchTab />);
    const debts = (await screen.findByText(/Борги \(1\)/)).nextElementSibling as HTMLElement;
    expect(within(debts).getByText(/45 грн · 💵 готівкою/)).toBeInTheDocument();
    expect(screen.getByTitle('Написав(ла), що віддасть готівкою')).toBeInTheDocument();
    const payments = screen.getByRole('list', { name: 'Оплати за день' });
    expect(within(payments).getByText(/сума з чека \(фото \/ PDF\)/)).toBeInTheDocument();
    expect(within(payments).getByText(/посилання на чек — суму не перевірено/)).toBeInTheDocument();
  });

  it('порівняння моделей: задача слухачеві, опитування, таблиця з розбіжностями й вартістю', async () => {
    const posted: unknown[] = [];
    const job = { id: 5, status: 'pending', params: { date: '2026-10-02' }, result: null, error: null, createdAt: '2026-10-02T10:00:00.000Z', finishedAt: null };
    const report = {
      date: '2026-10-02',
      models: ['claude-opus-5-5', 'claude-haiku-5-5'],
      baseline: 'claude-opus-5-5',
      skipped: 0,
      media: [
        {
          messageId: 10,
          source: 'photo',
          time: '11:58',
          results: [
            { model: 'claude-opus-5-5', seconds: 8.4, error: null, kind: 'menu', items: 34, amountUah: null, costUsd: 0.021, agree: true },
            {
              model: 'claude-haiku-5-5', seconds: 3.1, error: null, kind: 'menu', items: 34, amountUah: null, costUsd: 0.0005, agree: false,
              menuDiff: { missing: ['Борщ'], extra: [], prices: [{ name: 'Суп грибний', base: 55, other: 65 }] },
            },
          ],
        },
        {
          messageId: 12,
          source: 'pdf',
          time: '12:12',
          results: [
            { model: 'claude-opus-5-5', seconds: 2.0, error: null, kind: 'receipt', items: 0, amountUah: 115, costUsd: 0.01, agree: true },
            { model: 'claude-haiku-5-5', seconds: 1.2, error: null, kind: 'receipt', items: 0, amountUah: 115, costUsd: 0.0003, agree: true },
          ],
        },
      ],
      summary: [
        { model: 'claude-opus-5-5', media: 2, menu: 1, receipt: 1, other: 0, errors: 0, agree: 2, costUsd: 0.031, seconds: 10.4 },
        { model: 'claude-haiku-5-5', media: 2, menu: 1, receipt: 1, other: 0, errors: 0, agree: 1, costUsd: 0.0008, seconds: 4.3 },
      ],
    };
    let polls = 0;
    server.use(
      http.get(`${API}/today`, () => HttpResponse.json(summaryWith([order]))),
      http.get(`${API}/day-people`, () => HttpResponse.json(people)),
      http.post(`${API}/ocr-compare`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ job }, { status: 201 });
      }),
      http.get(`${API}/ocr-compare/5`, () => {
        polls += 1;
        return HttpResponse.json({ job: polls === 1 ? { ...job, status: 'running' } : { ...job, status: 'done', result: report } });
      }),
    );
    const user = userEvent.setup();
    render(<LunchTab ocrComparePollMs={10} />);
    await screen.findByText(/Борги \(1\)/);
    expect(screen.getByLabelText('День для порівняння моделей')).toHaveValue('2026-10-02'); // день з адмінки

    await user.click(screen.getByRole('button', { name: 'Порівняти моделі' }));
    const table = await screen.findByRole('table', { name: 'Порівняння моделей за 2026-10-02' });
    expect(posted).toEqual([{ date: '2026-10-02' }]);
    expect(within(table).getByText('Opus 5.5 (еталон)')).toBeInTheDocument();
    expect(within(table).getByText(/меню: 34 страв ≠/)).toBeInTheDocument();
    expect(within(table).getByText('немає: Борщ')).toBeInTheDocument();
    expect(within(table).getByText('ціни: Суп грибний 55 → 65')).toBeInTheDocument();
    expect(within(table).getByText(/чек: 115 грн ✓/)).toBeInTheDocument();
    expect(within(table).getByText(/збіглось 1 з 2/)).toBeInTheDocument();
    expect(within(table).getByText(/\$0\.0008/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Порівняти моделі' })).toBeEnabled();
  });

  it('порівняння моделей: помилка запуску й невдала задача', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/today`, () => HttpResponse.json(summaryWith([order]))),
      http.get(`${API}/day-people`, () => HttpResponse.json(people)),
      http.post(`${API}/ocr-compare`, () =>
        fail
          ? HttpResponse.json({ error: 'У бекенда немає ANTHROPIC_API_KEY' }, { status: 409 })
          : HttpResponse.json({ job: { id: 6, status: 'pending', params: null, result: null, error: null, createdAt: '', finishedAt: null } }, { status: 201 }),
      ),
      http.get(`${API}/ocr-compare/6`, () =>
        HttpResponse.json({ job: { id: 6, status: 'failed', params: null, result: null, error: 'слухача перезапущено — запустіть ще раз', createdAt: '', finishedAt: null } }),
      ),
    );
    const user = userEvent.setup();
    render(<LunchTab ocrComparePollMs={10} />);
    await screen.findByText(/Борги \(1\)/);
    await user.click(screen.getByRole('button', { name: 'Порівняти моделі' }));
    expect(await screen.findByText('У бекенда немає ANTHROPIC_API_KEY')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Порівняти моделі' }));
    expect(await screen.findByText('Не вдалося: слухача перезапущено — запустіть ще раз')).toBeInTheDocument();
  });
});
