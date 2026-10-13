/**
 * Редактор розкладу: варіанти шляху (перемикач «Шлях», шлях рейсу, JSON варіантів), опорні часи,
 * baseRevision у збереженні й 409 «дані змінилися». Датасет — через MSW.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { DATASET_CONFLICT_MESSAGE, type TransportDataset } from '@/api/transportDataset';
import { ScheduleEditorTab } from './ScheduleEditorTab';

const DATASET_URL = `${TEST_API_URL}/transport/dataset`;

/** №9: основний «туди» Промінь → Малинівка → Олекси Тихого; варіант «туди» Промінь → Вокзал (перший рейс) */
const dataset: TransportDataset = {
  stops: [
    { id: 'st_p', name: 'Промінь', lat: 50.77, lng: 29.24 },
    { id: 'st_m', name: 'Малинівка', lat: 50.78, lng: 29.27 },
    { id: 'st_o', name: 'Олекси Тихого', lat: 50.79, lng: 29.29 },
    { id: 'st_v', name: 'Вокзал', lat: 50.775, lng: 29.28 },
  ],
  routes: [
    {
      id: '9',
      fromName: 'Промінь',
      toName: 'Олекси Тихого',
      variants: [{ id: '9-v1', directionId: '1', name: 'через вокзал', stops: [{ stopId: 'st_p' }, { stopId: 'st_v' }] }],
    },
  ],
  routeStops: [
    { routeId: '9', stopId: 'st_p', orderThere: 1, orderBack: 3 },
    { routeId: '9', stopId: 'st_m', orderThere: 2, orderBack: 2 },
    { routeId: '9', stopId: 'st_o', orderThere: 3, orderBack: 1 },
  ],
  trips: [
    {
      id: '9-01', routeId: '9', serviceId: 'everyday', headsign: '', directionId: '1', departureTime: '06:45:00', blockId: null,
      variantId: '9-v1', timepoints: [{ stopId: 'st_v', time: '07:05' }],
    },
    { id: '9-03', routeId: '9', serviceId: 'everyday', headsign: '', directionId: '1', departureTime: '08:10:00', blockId: null },
    { id: '9-12', routeId: '9', serviceId: 'everyday', headsign: '', directionId: '0', departureTime: '09:00:00', blockId: null },
  ],
  segments: [],
  meta: { defaultSec: 120 },
  revision: '2026-10-12T10:00:00.000Z',
};

const gridStops = () => Array.from(document.querySelectorAll('.schedule-editor-stop-name')).map((td) => td.textContent);
const departures = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>('.schedule-editor-trip-head input[title="Відправлення з першої обслуговуваної зупинки"]')
  ).map((i) => i.value);
const pathGroup = () => screen.getByRole('group', { name: 'Шлях' });
const saveButton = () => screen.getByRole('button', { name: 'Зберегти в базу' });

async function openEditor() {
  render(<ScheduleEditorTab />);
  await screen.findByRole('heading', { name: /Маршрут №9/ }, { timeout: 5000 });
}

beforeEach(() => {
  server.use(http.get(DATASET_URL, () => HttpResponse.json(dataset)));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScheduleEditorTab: route variants', () => {
  it('«Шлях» shows the main grid or a variant grid with its own stops and trips', async () => {
    const user = userEvent.setup();
    await openEditor();
    expect(within(pathGroup()).getByRole('button', { name: 'основний' })).toHaveAttribute('aria-pressed', 'true');
    expect(gridStops()).toEqual(['Промінь', 'Малинівка', 'Олекси Тихого']);
    expect(departures()).toEqual(['08:10']);

    await user.click(within(pathGroup()).getByRole('button', { name: 'через вокзал' }));
    expect(gridStops()).toEqual(['Промінь', 'Вокзал']);
    expect(departures()).toEqual(['06:45']);
    const anchor = document.querySelector('.schedule-editor-cell--timepoint');
    expect(anchor).toHaveTextContent('07:05');
    expect(anchor).toHaveAttribute('title', 'Опорний час із листка');
  });

  it('moving a trip to another path switches the grid to it', async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.selectOptions(screen.getByTitle('Шлях рейсу: основний ланцюжок напрямку або варіант шляху'), '9-v1');
    expect(within(pathGroup()).getByRole('button', { name: 'через вокзал' })).toHaveAttribute('aria-pressed', 'true');
    expect(departures()).toEqual(['06:45', '08:10']);
    expect(screen.getByText('Рейс 9-03 — на шляху «через вокзал»')).toBeInTheDocument();
  });

  it('a broken variants JSON blocks saving; a valid one adds a path to its direction', async () => {
    const user = userEvent.setup();
    let puts = 0;
    server.use(http.put(DATASET_URL, () => ((puts += 1), HttpResponse.json({ ok: true, counts: {} }))));
    await openEditor();
    const json = screen.getByLabelText(/Варіанти шляху \(JSON/);
    expect(JSON.parse((json as HTMLTextAreaElement).value)).toEqual(dataset.routes[0].variants);

    fireEvent.change(json, { target: { value: '[{' } });
    expect(screen.getByText(/^Некоректний JSON/)).toBeInTheDocument();
    await user.click(saveButton());
    expect(screen.getByText('Виправте JSON розкладу чи варіантів шляху маршруту перед збереженням.')).toBeInTheDocument();
    expect(puts).toBe(0);

    const back = { id: '9-v2', directionId: '0', name: 'від вокзалу', stops: [{ stopId: 'st_v' }, { stopId: 'st_p' }] };
    fireEvent.change(json, { target: { value: JSON.stringify([...dataset.routes[0].variants!, back]) } });
    expect(screen.queryByText(/^Некоректний JSON/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Олекси Тихого → Промінь' }));
    expect(within(pathGroup()).getByRole('button', { name: 'від вокзалу' })).toBeInTheDocument();
  });
});

describe('ScheduleEditorTab: timepoints and saving', () => {
  it('«Опорні часи» edits a timepoint; save sends it with baseRevision, the next save — the new revision', async () => {
    const user = userEvent.setup();
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.put(DATASET_URL, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ok: true, counts: { routes: 1, trips: 3, variants: 1 }, revision: `rev-${bodies.length + 1}` });
      })
    );
    await openEditor();
    expect(screen.getByRole('button', { name: '↩ зворотний о 09:00' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Опорні часи' }));
    // перша зупинка — відправлення, тож поля там немає
    expect(screen.queryByLabelText('Опорний час рейсу 9-03 на зупинці Промінь')).not.toBeInTheDocument();
    const cell = screen.getByLabelText('Опорний час рейсу 9-03 на зупинці Малинівка');
    fireEvent.change(cell, { target: { value: '08:20' } });
    expect(screen.getByTitle(/Є опорні часи — прибуття разом з ними не задається/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /зворотний/ })).not.toBeInTheDocument();

    await user.click(saveButton());
    await screen.findByText('Збережено: 1 маршрутів, 3 рейсів, 1 варіантів шляху');
    const first = bodies[0] as { baseRevision?: string; revision?: string; trips: Array<{ id: string; timepoints?: unknown }> };
    expect(first.baseRevision).toBe('2026-10-12T10:00:00.000Z');
    expect('revision' in first).toBe(false);
    expect(first.trips.find((t) => t.id === '9-03')?.timepoints).toEqual([{ stopId: 'st_m', time: '08:20' }]);

    await user.click(saveButton());
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].baseRevision).toBe('rev-2');
  });

  it('409 from the server says the data changed and how to recover', async () => {
    const user = userEvent.setup();
    server.use(http.put(DATASET_URL, () => HttpResponse.json({ error: 'changed' }, { status: 409 })));
    await openEditor();
    await user.click(saveButton());
    expect(await screen.findByText(DATASET_CONFLICT_MESSAGE)).toBeInTheDocument();
  });
});
