/** «Маршрути»: плитки, коридор з варіантами «через …», мітки проблем, міста з прапорцями й кількістю маршрутів, дії. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TripPoint, TripRoute } from '@/types';
import { RoutesTab, type RoutesTabProps } from './RoutesTab';

const pt = (id: number, code: string, nameUk: string, sortOrder: number, over: Partial<TripPoint> = {}): TripPoint => ({ id, code, nameUk, sortOrder, requiredOnTrip: false, appearInFromTo: true, appearInPoputky: true, ...over });
const POINTS = [pt(1, 'Kyiv', 'Київ', 10, { quickDirectPointIds: [2, 3] }), pt(2, 'Malyn', 'Малин', 20, { hasLocalTransport: true }), pt(3, 'Zhytomyr', 'Житомир', 30), pt(5, 'Irpin', 'Ірпінь', 50, { appearInFromTo: false })];
const stop = (pointId: number, position: number, role: string) => ({ id: pointId * 10 + position, pointId, position, role, point: POINTS.find((p) => p.id === pointId) });
const ROUTES: TripRoute[] = [
  { id: 4, slug: 'Kyiv-Malyn', labelUk: 'Київ → Малин', startPointId: 1, endPointId: 2, corridorTripRouteId: null, carDurationMinutes: 95, stops: [stop(1, 0, 'start'), stop(2, 1, 'end')] },
  { id: 9, slug: 'Kyiv-Malyn-Irpin', labelUk: 'Київ → Малин (через Ірпінь)', startPointId: 1, endPointId: 2, corridorTripRouteId: 4, carDurationMinutes: 95, stops: [stop(1, 0, 'start'), stop(5, 1, 'via'), stop(2, 2, 'end')] },
  { id: 19, slug: 'Kyiv-Zhytomyr', labelUk: 'Київ → Житомир', startPointId: 1, endPointId: 3, corridorTripRouteId: null, carDurationMinutes: null, stops: [] },
];

function renderTab(over: Partial<RoutesTabProps> = {}) {
  const props: RoutesTabProps = { points: POINTS, routes: ROUTES, loading: false, onReload: vi.fn(), onAddPoint: vi.fn(), onEditPoint: vi.fn(), onDeletePoint: vi.fn(), onAddRoute: vi.fn(), onEditRoute: vi.fn(), onDeleteRoute: vi.fn(), ...over };
  render(<RoutesTab {...props} />);
  return props;
}

describe('RoutesTab', () => {
  it('плитки; коридор, під ним варіант «через Ірпінь»; проблеми — мітками', () => {
    renderTab();
    const tiles = screen.getByRole('group', { name: 'Маршрути й міста' });
    expect(within(tiles).getByText('Маршрутів').parentElement).toHaveTextContent('3');
    expect(within(tiles).getByText('Маршрутів').parentElement).toHaveTextContent('коридорів 2');
    expect(within(tiles).getByText('Міст').parentElement).toHaveTextContent('у пошуку 3');
    expect(within(tiles).getByText('Без часу авто').closest('.admin-kit-tile')).toHaveClass('admin-kit-tile--warn');
    expect(within(tiles).getByText('Без точок маршруту').parentElement).toHaveTextContent('1');

    const rows = within(screen.getByRole('region', { name: 'Маршрути' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Київ → Малин');
    expect(rows[0]).toHaveTextContent('варіантів 1');
    expect(rows[0]).toHaveTextContent('авто 95 хв');
    expect(rows[1]).toHaveClass('route-row--variant');
    expect(rows[1]).toHaveTextContent('через Ірпінь');
    expect(rows[2]).toHaveTextContent('Київ → Житомир');
    expect(within(rows[2]).getByText('немає точок маршруту')).toBeInTheDocument();
    expect(within(rows[2]).getByText('немає часу авто')).toBeInTheDocument();
  });

  it('міста за порядком; прапорці, швидкі напрямки, скільки маршрутів', () => {
    renderTab();
    const rows = within(screen.getByRole('region', { name: 'Міста' })).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Київ', 'Малин', 'Житомир', 'Ірпінь']);
    expect(rows[0]).toHaveTextContent('швидкі: Малин, Житомир');
    expect(rows[0]).toHaveTextContent('маршрутів 3');
    expect(rows[1]).toHaveTextContent('міський транспорт');
    expect(rows[3]).not.toHaveTextContent('у «звідки / куди»');
    expect(rows[3]).toHaveTextContent('маршрутів 1');
  });

  it('дії: змінити й видалити маршрут і місто, додати', async () => {
    const user = userEvent.setup();
    const p = renderTab();
    await user.click(screen.getByRole('button', { name: 'Змінити маршрут Київ → Малин (через Ірпінь)' }));
    expect(p.onEditRoute).toHaveBeenCalledWith(ROUTES[1]);
    await user.click(screen.getByRole('button', { name: 'Видалити місто Ірпінь' }));
    expect(p.onDeletePoint).toHaveBeenCalledWith(POINTS[3]);
    await user.click(screen.getByRole('button', { name: 'Додати маршрут' }));
    await user.click(screen.getByRole('button', { name: 'Додати місто' }));
    expect(p.onAddRoute).toHaveBeenCalled();
    expect(p.onAddPoint).toHaveBeenCalled();
  });

  it('порожньо — «Додати перший маршрут»', () => {
    renderTab({ routes: [] });
    expect(screen.getByRole('button', { name: 'Додати перший маршрут' })).toBeInTheDocument();
  });
});
