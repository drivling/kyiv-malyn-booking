/**
 * Редактор карти: вибір зупинки (список ↔ маркер), перейменування в рядку з валідацією, лічильник
 * незбережених змін, пропагація в кінцеві/headsign при збереженні. react-leaflet замокано.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { TransportDataset } from '@/api/transportDataset';
import { MapEditorTab } from './MapEditorTab';

const mapMock = vi.hoisted(() => ({
  panTo: vi.fn(),
  setView: vi.fn(),
  fitBounds: vi.fn(),
  getCenter: () => ({ lat: 50.77, lng: 29.24 }),
  getZoom: () => 15,
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock('react-leaflet', async () => {
  const ReactMod = await import('react');
  type MarkerProps = {
    title?: string;
    zIndexOffset?: number;
    eventHandlers?: { click?: () => void };
  };
  const Marker = ReactMod.forwardRef<HTMLButtonElement, MarkerProps>((p, ref) => (
    <button
      ref={ref}
      type="button"
      data-testid="marker"
      data-selected={p.zIndexOffset && p.zIndexOffset > 0 ? '1' : '0'}
      onClick={() => p.eventHandlers?.click?.()}
    >
      {p.title}
    </button>
  ));
  Marker.displayName = 'MarkerMock';
  return {
    MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
    TileLayer: () => null,
    Popup: () => null,
    Marker,
    useMap: () => mapMock,
  };
});

const dataset: TransportDataset = {
  stops: [
    { id: 'st_a', name: 'Базар', lat: 50.77, lng: 29.24 },
    { id: 'st_b', name: 'Вокзал', lat: 50.78, lng: 29.25 },
    { id: 'st_c', name: 'Лікарня', lat: 50.79, lng: 29.26 },
  ],
  routes: [
    { id: '2', fromName: 'Базар', toName: 'Лікарня', scheme: 'city', note: '', sourceUrl: '', schedule: null },
    { id: '3', fromName: 'Ринок', toName: 'Лікарня (Лісотехнікум)', scheme: 'city', note: '', sourceUrl: '', schedule: null },
  ],
  routeStops: [
    { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 3, mapOnly: false },
    { routeId: '2', stopId: 'st_b', orderThere: 2, orderBack: 2, mapOnly: false },
    { routeId: '2', stopId: 'st_c', orderThere: 3, orderBack: 1, mapOnly: false },
    { routeId: '3', stopId: 'st_c', orderThere: 1, orderBack: 1, mapOnly: false },
  ],
  trips: [
    { id: 't1', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '08:30:00', blockId: null },
    { id: 't2', routeId: '2', serviceId: 'everyday', headsign: 'Базар', directionId: '0', departureTime: '09:00:00', blockId: null },
  ],
  segments: [{ routeId: '2', fromStopId: 'st_a', toStopId: 'st_b', seconds: 240 }],
  meta: { defaultSec: 120, center: [50.768, 29.242] },
};

const DATASET_URL = `${TEST_API_URL}/transport/dataset`;
const list = () => screen.getByRole('list');
const rowOf = (name: string) => within(list()).getByRole('button', { name }).closest('li') as HTMLLIElement;
const markerOf = (name: string) => screen.getAllByTestId('marker').find((el) => el.textContent === name) as HTMLElement;
const saveButton = () => screen.getByRole('button', { name: /Зберегти в базу/ });

async function openEditor() {
  render(<MapEditorTab />);
  await screen.findByRole('heading', { name: /Зупинки/ }, { timeout: 5000 });
  await within(list()).findByRole('button', { name: 'Базар' });
}

async function renameLikarnia(user: ReturnType<typeof userEvent.setup>, to = 'Лікарня (центр)') {
  await user.click(within(list()).getByRole('button', { name: 'Лікарня' }));
  await user.click(screen.getByRole('button', { name: 'Перейменувати' }));
  const input = screen.getByRole('textbox', { name: 'Нова назва зупинки' });
  expect(input).toHaveValue('Лікарня');
  await user.clear(input);
  await user.type(input, `${to}{Enter}`);
}

beforeEach(() => {
  server.use(http.get(DATASET_URL, () => HttpResponse.json(dataset)));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mapMock.panTo.mockClear();
  mapMock.setView.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MapEditorTab: stops panel', () => {
  it('renders rows with id and coords; search narrows the list and shows «N з M»', async () => {
    const user = userEvent.setup();
    await openEditor();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(3);
    expect(within(rowOf('Базар')).getByText('st_a')).toBeInTheDocument();
    expect(within(rowOf('Базар')).getByText('50.770000, 29.240000')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.type(screen.getByRole('searchbox', { name: 'Пошук зупинки' }), 'лік');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: /Зупинки/ })).toHaveTextContent('1 з 3');
  });

  it('row click selects and pans the map; marker click selects without panning and raises the marker', async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.click(within(list()).getByRole('button', { name: 'Вокзал' }));
    expect(rowOf('Вокзал')).toHaveAttribute('aria-current', 'true');
    expect(mapMock.panTo).toHaveBeenCalledTimes(1);
    expect(markerOf('Вокзал')).toHaveAttribute('data-selected', '1');

    await user.click(markerOf('Лікарня'));
    expect(rowOf('Лікарня')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('Вокзал')).not.toHaveAttribute('aria-current');
    expect(mapMock.panTo).toHaveBeenCalledTimes(1);
    expect(markerOf('Лікарня')).toHaveAttribute('data-selected', '1');
    expect(markerOf('Вокзал')).toHaveAttribute('data-selected', '0');
  });

  it('rename in the row: badge, «було», propagation line, counter; save PUTs the propagated dataset', async () => {
    const user = userEvent.setup();
    let putBody: TransportDataset | null = null;
    server.use(
      http.put(DATASET_URL, async ({ request }) => {
        putBody = (await request.json()) as TransportDataset;
        return HttpResponse.json({ ok: true, counts: { stops: 3, routes: 2, routeStops: 4, trips: 2, segments: 1 } });
      })
    );
    await openEditor();
    await renameLikarnia(user);

    const row = rowOf('Лікарня (центр)');
    expect(within(row).getByText('не збережено')).toBeInTheDocument();
    expect(within(row).getByText('було: Лікарня')).toBeInTheDocument();
    expect(within(row).getByText('Також оновиться при збереженні: кінцева №2 · 1 рейс')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Повернути назву з бази' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Нова назва зупинки' })).not.toBeInTheDocument();
    expect(markerOf('Лікарня (центр)')).toBeTruthy();
    expect(saveButton()).toHaveTextContent('Зберегти в базу · 1 зміна');
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    await waitFor(() => expect(putBody).not.toBeNull());
    const body = putBody!;
    expect(body.stops.find((s) => s.id === 'st_c')?.name).toBe('Лікарня (центр)');
    expect(body.routes.find((r) => r.id === '2')?.toName).toBe('Лікарня (центр)');
    expect(body.routes.find((r) => r.id === '3')?.toName).toBe('Лікарня (Лісотехнікум)');
    expect(body.trips.map((t) => t.headsign)).toEqual(['Лікарня (центр)', 'Базар']);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/1 зміна.*перейменовано: 1/s));

    await screen.findByText(/Збережено: 3 зупинок/);
    expect(saveButton()).toHaveTextContent(/^Зберегти в базу$/);
    expect(saveButton()).toBeDisabled();
    expect(within(rowOf('Лікарня (центр)')).queryByText('не збережено')).not.toBeInTheDocument();
    expect(localStorage.getItem('transport-dataset-invalidate')).toBeTruthy();
  });

  it('a duplicate name is rejected inline and the row stays in edit mode', async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.click(within(list()).getByRole('button', { name: 'Вокзал' }));
    await user.click(screen.getByRole('button', { name: 'Перейменувати' }));
    const input = screen.getByRole('textbox', { name: 'Нова назва зупинки' });
    await user.clear(input);
    await user.type(input, 'базар {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Така назва вже є: Базар (st_a)');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(saveButton()).toBeDisabled();

    await user.clear(input);
    await user.type(input, '{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Назва не може бути порожньою');
  });

  it('«↶» restores the db name and clears the counter; Escape cancels editing', async () => {
    const user = userEvent.setup();
    await openEditor();
    await renameLikarnia(user);
    expect(saveButton()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Повернути назву з бази' }));
    expect(within(list()).getByRole('button', { name: 'Лікарня' })).toBeInTheDocument();
    expect(screen.queryByText('не збережено')).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Перейменувати' }));
    await user.type(screen.getByRole('textbox', { name: 'Нова назва зупинки' }), 'xxx{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Нова назва зупинки' })).not.toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: 'Лікарня' })).toHaveFocus();
  });

  it('a failed save shows an inline error and keeps the editor', async () => {
    const user = userEvent.setup();
    server.use(http.put(DATASET_URL, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    await openEditor();
    await renameLikarnia(user);
    await user.click(saveButton());
    await waitFor(() => expect(document.querySelector('.alert-error')).toBeTruthy());
    expect(list()).toBeInTheDocument();
    expect(saveButton()).toHaveTextContent('1 зміна');
  });

  it('beforeunload is blocked only while there are unsaved changes', async () => {
    const user = userEvent.setup();
    await openEditor();
    const fire = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(fire()).toBe(false);
    await renameLikarnia(user);
    expect(fire()).toBe(true);
  });

  it('keyboard from the search box: ↑/↓ select, Enter edits, Escape leaves editing', async () => {
    const user = userEvent.setup();
    await openEditor();
    const search = screen.getByRole('searchbox', { name: 'Пошук зупинки' });
    await user.click(search);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(rowOf('Вокзал')).toHaveAttribute('aria-current', 'true');
    expect(mapMock.panTo).toHaveBeenCalledTimes(2);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Нова назва зупинки' })).toHaveValue('Вокзал');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Нова назва зупинки' })).not.toBeInTheDocument();
  });

  it('direction mode: rows keep selection/rename, the modal has no name field, terminus shows the new name', async () => {
    const user = userEvent.setup();
    await openEditor();
    await renameLikarnia(user);
    await user.selectOptions(screen.getByLabelText('Маршрут'), '2');
    await user.click(screen.getByRole('button', { name: 'Редактор напрямку' }));
    expect(screen.getByRole('heading', { name: /Порядок зупинок/ })).toHaveTextContent('→ Лікарня (центр)');
    expect(screen.getByRole('button', { name: '→ Лікарня (центр)' })).toBeInTheDocument();
    expect(within(rowOf('Лікарня (центр)')).getByText('3.')).toBeInTheDocument();
    expect(within(rowOf('Лікарня (центр)')).getByText('не збережено')).toBeInTheDocument();

    await user.click(markerOf('Лікарня (центр)'));
    expect(rowOf('Лікарня (центр)')).toHaveAttribute('aria-current', 'true');
    const modal = screen.getByRole('heading', { name: /Зупинка: Лікарня \(центр\)/ }).closest('.map-editor-modal') as HTMLElement;
    expect(within(modal).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(modal).getByText('Назву зупинки можна змінити в списку праворуч.')).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Скасувати' }));

    await user.click(within(rowOf('Лікарня (центр)')).getByRole('button', { name: 'Порядок…' }));
    expect(screen.getByRole('heading', { name: /Зупинка: Лікарня \(центр\)/ })).toBeInTheDocument();
  });
});
