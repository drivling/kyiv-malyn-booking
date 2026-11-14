/** Синоніми «Доведе» в адмінці: слово з журналу → вибране місце; список і «забути». */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedeSynonymRow } from '@/types';
import { DovedeSynonymsPanel } from './DovedeSynonymsPanel';
import { placeOptions, searchPlaceOptions } from './dovedePlaceOptions';

const STOPS = [{ id: 'st_0071', name: 'Поворот на Коновальця' }];

function mock(initial: DovedeSynonymRow[] = []) {
  const rows = [...initial];
  const posted: unknown[] = [];
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/synonyms`, () => HttpResponse.json({ synonyms: rows })),
    http.post(`${TEST_API_URL}/admin/dovede/synonyms`, async ({ request }) => {
      const body = (await request.json()) as { phrase: string; placeId: string };
      posted.push(body);
      const row = { id: rows.length + 1, phrase: body.phrase.toLowerCase(), placeId: body.placeId, createdAt: '2026-11-14T08:00:00.000Z' };
      rows.unshift(row);
      return HttpResponse.json(row);
    }),
    http.delete(`${TEST_API_URL}/admin/dovede/synonyms/:id`, ({ params }) => {
      const at = rows.findIndex((r) => r.id === Number(params.id));
      if (at >= 0) rows.splice(at, 1);
      return HttpResponse.json({ ok: true });
    }),
  );
  return { posted };
}

describe('місця для вибору', () => {
  const options = placeOptions(STOPS);
  it('шукає серед районів, зупинок, орієнтирів і вулиць — за всіма словами', () => {
    expect(searchPlaceOptions(options, 'атб').map((o) => o.id)).toContain('lm.atb-market');
    expect(searchPlaceOptions(options, 'коновальця поворот').map((o) => o.id)).toEqual(['st_0071']);
    expect(searchPlaceOptions(options, 'городищанська').map((o) => o.id)).toContain('street.horodyshchanska');
    expect(searchPlaceOptions(options, 'вокзал').map((o) => o.id)).toContain('malyn.vokzal');
    expect(searchPlaceOptions(options, '   ')).toEqual([]);
    expect(searchPlaceOptions(options, 'немає такого місця')).toEqual([]);
  });
});

describe('DovedeSynonymsPanel', () => {
  it('слово з журналу → пошук місця → «Навчити»; новий синонім одразу в списку', async () => {
    const { posted } = mock();
    render(<DovedeSynonymsPanel stops={STOPS} seed={{ word: 'Епіцентр', n: 1 }} />);
    expect(await screen.findByText(/Синонімів ще немає/)).toBeInTheDocument();
    expect(screen.getByLabelText('Як кажуть люди')).toHaveValue('Епіцентр');
    const save = screen.getByRole('button', { name: 'Навчити' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Яке це місце'), 'атб');
    const found = screen.getByRole('list', { name: 'Знайдені місця' });
    await userEvent.click(within(found).getByRole('button', { name: /АТБ-Маркет/ }));
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(posted).toEqual([{ phrase: 'Епіцентр', placeId: 'lm.atb-market' }]));
    const row = (await screen.findByText('епіцентр')).closest('tr')!;
    expect(row).toHaveTextContent('супермаркет АТБ-Маркет');
    expect(screen.getByLabelText('Як кажуть люди')).toHaveValue('');
  });

  it('«забути» питає підтвердження й прибирає рядок; місце, якого вже немає, видно як є', async () => {
    mock([
      { id: 1, phrase: 'бам', placeId: 'st_0071', createdAt: '' },
      { id: 2, phrase: 'стара назва', placeId: 'lm.nema-takoho', createdAt: '' },
    ]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DovedeSynonymsPanel stops={STOPS} seed={null} />);
    expect((await screen.findByText('бам')).closest('tr')).toHaveTextContent('Поворот на Коновальця');
    expect(screen.getByText('стара назва').closest('tr')).toHaveTextContent('такого місця вже немає');
    await userEvent.click(screen.getByRole('button', { name: 'Забути синонім «бам»' }));
    await waitFor(() => expect(screen.queryByText('бам')).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledWith('Забути синонім «бам»?');
    confirm.mockRestore();
  });

  it('помилку сервера показує, форму не очищає', async () => {
    mock();
    server.use(http.post(`${TEST_API_URL}/admin/dovede/synonyms`, () => HttpResponse.json({ error: 'Такого місця немає у словнику' }, { status: 400 })));
    render(<DovedeSynonymsPanel stops={STOPS} seed={{ word: 'епіцентр', n: 1 }} />);
    await userEvent.type(await screen.findByLabelText('Яке це місце'), 'вокзал');
    await userEvent.click(within(screen.getByRole('list', { name: 'Знайдені місця' })).getAllByRole('button')[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Навчити' }));
    expect(await screen.findByText('Такого місця немає у словнику')).toBeInTheDocument();
    expect(screen.getByLabelText('Як кажуть люди')).toHaveValue('епіцентр');
  });
});
