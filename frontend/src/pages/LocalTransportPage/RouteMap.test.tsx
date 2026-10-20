/**
 * Карта планувальника: точки «Звідки/Куди» замість зупинок, клік по карті → картка «Звідси / Сюди»,
 * шар обраної поїздки (кольорові ділянки рейсів, пунктир пішки). react-leaflet замокано.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteMap } from './RouteMap';
import { routeColor } from './routeColors';
import type { MapJourney } from './journey/mapData';

const leaflet = vi.hoisted(() => ({ handlers: {} as Record<string, (e: { latlng: { lat: number; lng: number } }) => void> }));

vi.mock('react-leaflet', async () => {
  type P = Record<string, any>;
  return {
    MapContainer: ({ children }: P) => <div data-testid="map">{children}</div>,
    TileLayer: () => null,
    Pane: () => null,
    Polyline: (p: P) => (
      <div
        data-testid="polyline"
        data-pane={p.pane}
        data-color={p.pathOptions?.color}
        data-weight={p.pathOptions?.weight}
        data-opacity={p.pathOptions?.opacity}
        data-dash={p.pathOptions?.dashArray ?? ''}
        data-points={JSON.stringify(p.positions)}
      />
    ),
    CircleMarker: (p: P) => <div data-testid="node" data-center={JSON.stringify(p.center)} />,
    Marker: ({ position, children, eventHandlers }: P) => (
      <div data-testid="marker" data-pos={JSON.stringify(position)} onClick={() => eventHandlers?.click?.()}>
        {children}
      </div>
    ),
    Tooltip: ({ children }: P) => <span>{children}</span>,
    useMap: () => ({ fitBounds: vi.fn(), invalidateSize: vi.fn(), getZoom: () => 13 }),
    useMapEvents: (h: Record<string, () => void>) => {
      Object.assign(leaflet.handlers, h);
      return { getZoom: () => 13 };
    },
  };
});

const coords = { center: [50.768, 29.242] as [number, number], stops: { st_a: [50.77, 29.24], st_b: [50.78, 29.25] } as Record<string, [number, number]> };
const base = { coordsData: coords, stopNames: ['st_a', 'st_b'], resolveStopLabel: (k: string) => ({ st_a: 'Базар', st_b: 'Вокзал' })[k as 'st_a'] ?? k };

beforeEach(() => {
  leaflet.handlers = {};
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('RouteMap: pick a point on the map', () => {
  it('a click opens «Точка на карті» with «Звідси / Сюди»; «Сюди» reports the coordinates and closes the card', async () => {
    const user = userEvent.setup();
    const onPickPoint = vi.fn();
    render(<RouteMap {...base} onPickPoint={onPickPoint} />);
    expect(screen.queryByRole('dialog', { name: 'Точка на карті' })).not.toBeInTheDocument();

    act(() => leaflet.handlers.click({ latlng: { lat: 50.7712, lng: 29.2455 } }));
    const card = screen.getByRole('dialog', { name: 'Точка на карті' });
    // тимчасовий маркер у вибраному місці
    expect(screen.getAllByTestId('marker').some((m) => m.getAttribute('data-pos') === '[50.7712,29.2455]')).toBe(true);

    await user.click(within(card).getByRole('button', { name: 'Сюди' }));
    expect(onPickPoint).toHaveBeenCalledWith('to', 50.7712, 29.2455);
    expect(screen.queryByRole('dialog', { name: 'Точка на карті' })).not.toBeInTheDocument();
  });

  it('«Звідси» reports the from-slot; Escape closes the card without picking', async () => {
    const user = userEvent.setup();
    const onPickPoint = vi.fn();
    render(<RouteMap {...base} onPickPoint={onPickPoint} />);
    act(() => leaflet.handlers.click({ latlng: { lat: 50.7712, lng: 29.2455 } }));
    await user.click(screen.getByRole('button', { name: 'Звідси' }));
    expect(onPickPoint).toHaveBeenLastCalledWith('from', 50.7712, 29.2455);

    act(() => leaflet.handlers.click({ latlng: { lat: 50.7, lng: 29.2 } }));
    expect(screen.getByRole('dialog', { name: 'Точка на карті' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Точка на карті' })).not.toBeInTheDocument();
    expect(onPickPoint).toHaveBeenCalledTimes(1);
  });

  it('without onPickPoint a click on the map does nothing', () => {
    render(<RouteMap {...base} />);
    expect(leaflet.handlers.click).toBeUndefined();
  });

  it('a click on a stop marker opens the stop card, not the point card', async () => {
    const user = userEvent.setup();
    render(<RouteMap {...base} markerStopNames={['st_a']} onPickFromStop={vi.fn()} onPickToStop={vi.fn()} onPickPoint={vi.fn()} />);
    act(() => leaflet.handlers.click({ latlng: { lat: 50.7, lng: 29.2 } }));
    expect(screen.getByRole('dialog', { name: 'Точка на карті' })).toBeInTheDocument();
    const stopMarker = screen.getAllByTestId('marker').find((m) => m.getAttribute('data-pos') === JSON.stringify(coords.stops.st_a))!;
    await user.click(stopMarker);
    expect(screen.queryByRole('dialog', { name: 'Точка на карті' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Зупинка Базар' })).toBeInTheDocument();
  });
});

describe('RouteMap: points as «Звідки» / «Куди»', () => {
  it('markers at the points and their names in the strip', () => {
    render(
      <RouteMap
        {...base}
        showStrip
        fromPoint={[50.7701, 29.2401]}
        fromPointLabel="Моє місцезнаходження"
        toStopName="st_b"
        markerStopNames={['st_a', 'st_b']}
      />
    );
    const strip = screen.getByLabelText('Обрані зупинки');
    expect(strip).toHaveTextContent('Звідки: Моє місцезнаходження');
    expect(strip).toHaveTextContent('Куди: Вокзал');
    expect(screen.getAllByTestId('marker').some((m) => m.getAttribute('data-pos') === '[50.7701,29.2401]')).toBe(true);
    expect(screen.getByText('Моє місцезнаходження', { selector: 'span:not(.lt-chip)' })).toBeInTheDocument();
  });

  it('both points: the swap button is enabled', () => {
    render(<RouteMap {...base} showStrip fromPoint={[50.77, 29.24]} toPoint={[50.78, 29.25]} onSwapStops={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Поміняти місцями Звідки та Куди' })).toBeEnabled();
  });
});

describe('RouteMap: the opened journey', () => {
  const color = routeColor('2') ?? '#054752';
  const journey: MapJourney = {
    legs: [
      { kind: 'walk', positions: [[50.7701, 29.2401], [50.77, 29.24]] },
      { kind: 'transit', routeId: '2', positions: [[50.77, 29.24], [50.775, 29.245], [50.78, 29.25]] },
    ],
    nodes: [[50.77, 29.24], [50.78, 29.25]],
  };

  it('a ride is a coloured line over a white casing, the walk is dashed, boarding points are circles', () => {
    render(<RouteMap {...base} journey={journey} />);
    const lines = screen.getAllByTestId('polyline');
    const ride = lines.find((l) => l.getAttribute('data-pane') === 'lt-journey')!;
    expect(ride.getAttribute('data-color')).toBe(color);
    expect(JSON.parse(ride.getAttribute('data-points')!)).toHaveLength(3);
    expect(lines.find((l) => l.getAttribute('data-pane') === 'lt-journey-casing')!.getAttribute('data-color')).toBe('#fff');
    const walk = lines.find((l) => l.getAttribute('data-pane') === 'lt-journey-walk')!;
    expect(walk.getAttribute('data-dash')).not.toBe('');
    expect(screen.getAllByTestId('node')).toHaveLength(2);
  });

  const routeLine = { routeId: '2', color, positions: [[50.76, 29.23], [50.77, 29.24], [50.78, 29.25], [50.79, 29.26]] as [number, number][] };
  const polylinesIn = (pane: string) => screen.queryAllByTestId('polyline').filter((l) => l.getAttribute('data-pane') === pane);

  it('with a journey the full line of its route stays only as a thin faint background; the ridden part is thick', () => {
    render(<RouteMap {...base} routeLines={[routeLine]} highlightRouteIds={['2']} journey={journey} />);
    const [background] = polylinesIn('lt-lines');
    expect(background.getAttribute('data-weight')).toBe('3');
    expect(Number(background.getAttribute('data-opacity'))).toBeLessThan(0.5);
    expect(polylinesIn('lt-lines-casing')).toHaveLength(0); // білої підкладки під фоном немає
    const ride = polylinesIn('lt-journey')[0];
    expect(ride.getAttribute('data-weight')).toBe('6');
    expect(ride.getAttribute('data-opacity')).toBe('1');
  });

  it('other routes are fainter than the background of the journey routes', () => {
    const other = { routeId: '3', color: '#00aa00', positions: [[50.76, 29.2], [50.77, 29.21]] as [number, number][] };
    render(<RouteMap {...base} routeLines={[routeLine, other]} highlightRouteIds={['2']} journey={journey} />);
    const bg = polylinesIn('lt-lines')[0];
    const dim = polylinesIn('lt-lines-dim')[0];
    expect(Number(dim.getAttribute('data-opacity'))).toBeLessThan(Number(bg.getAttribute('data-opacity')));
  });

  it('without a journey a highlighted route keeps the bold style with a white casing (route page, no pair)', () => {
    render(<RouteMap {...base} routeLines={[routeLine]} highlightRouteIds={['2']} />);
    const [line] = polylinesIn('lt-lines');
    expect(line.getAttribute('data-weight')).toBe('5');
    expect(line.getAttribute('data-opacity')).toBe('1');
    expect(polylinesIn('lt-lines-casing')).toHaveLength(1);
  });

  it('no journey — no journey layers', () => {
    render(<RouteMap {...base} />);
    expect(screen.queryAllByTestId('polyline').filter((l) => l.getAttribute('data-pane')?.startsWith('lt-journey'))).toHaveLength(0);
    expect(screen.queryAllByTestId('node')).toHaveLength(0);
  });
});
