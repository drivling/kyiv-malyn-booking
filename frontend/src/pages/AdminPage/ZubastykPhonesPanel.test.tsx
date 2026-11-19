/** Телефони «Зубастика» в адмінці: список з сервера, змінити / додати / прибрати, перевірка номера, «типові з коду». */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { ZUBASTYK_PHONES } from '@/pages/MizhgorodskiPage/zubastykContent';
import { ZubastykPhonesPanel } from './ZubastykPhonesPanel';

function mock() {
  const sent: unknown[] = [];
  let view = { phones: [...ZUBASTYK_PHONES], changed: false, updatedAt: null as string | null, defaults: [...ZUBASTYK_PHONES] };
  server.use(
    http.get(`${TEST_API_URL}/admin/site/zubastyk-phones`, () => HttpResponse.json(view)),
    http.put(`${TEST_API_URL}/admin/site/zubastyk-phones`, async ({ request }) => {
      const body = (await request.json()) as { phones?: Array<{ phone: string; note?: string }>; reset?: boolean };
      sent.push(body);
      view = body.reset
        ? { ...view, phones: [...ZUBASTYK_PHONES], changed: false }
        : {
            ...view,
            changed: true,
            updatedAt: '2026-11-19T10:00:00.000Z',
            phones: body.phones!.map((p) => {
              const d = p.phone.replace(/\D/g, '');
              const digits = d.startsWith('0') ? `38${d}` : d;
              return { digits, label: p.phone, ...(p.note ? { note: p.note } : {}) };
            }),
          };
      return HttpResponse.json(view);
    }),
  );
  return sent;
}

afterEach(() => vi.restoreAllMocks());

describe('ZubastykPhonesPanel', () => {
  it('змінити номер, прибрати резервний, додати новий — зберегти; хибний номер не зберегти', async () => {
    const sent = mock();
    const user = userEvent.setup();
    render(<ZubastykPhonesPanel />);
    expect(await screen.findByDisplayValue('093 192 00 08')).toBeInTheDocument();
    expect(screen.getByText('типові з коду')).toBeInTheDocument();
    expect(screen.getByLabelText('Примітка 4')).toHaveValue('резервний');

    await user.click(screen.getByRole('button', { name: 'Прибрати номер 4' }));
    await user.click(screen.getByRole('button', { name: '+ додати номер' }));
    const added = screen.getByLabelText('Номер 4');
    await user.type(added, '123');
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
    await user.clear(added);
    await user.type(added, '067 111 22 33');
    await user.type(screen.getByLabelText('Примітка 4'), 'нічний');
    await user.click(screen.getByRole('button', { name: 'Зберегти' }));
    expect(await screen.findByText(/Збережено/)).toBeInTheDocument();
    expect(sent[0]).toEqual({
      phones: [{ phone: '093 192 00 08' }, { phone: '096 142 00 08' }, { phone: '066 162 00 08' }, { phone: '067 111 22 33', note: 'нічний' }],
    });
    expect(screen.getByText(/змінено в адмінці/)).toBeInTheDocument();
  });

  it('«Скинути до типових з коду» — після підтвердження', async () => {
    const sent = mock();
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ZubastykPhonesPanel />);
    await screen.findByDisplayValue('093 192 00 08');
    await user.click(screen.getByRole('button', { name: 'Зберегти' }));
    await user.click(await screen.findByRole('button', { name: 'Скинути до типових з коду' }));
    expect(await screen.findByText('Знову типові телефони з коду.')).toBeInTheDocument();
    expect(sent[sent.length - 1]).toEqual({ reset: true });
  });
});
