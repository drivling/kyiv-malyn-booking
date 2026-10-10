import { describe, it, expect } from 'vitest';
import { buildRouteLines, pickBoundsStops, routeStopChain, withOrder } from './routeGeometry';
import type { RouteStopWithOrder } from './types';

const stopsByRoute: Record<string, RouteStopWithOrder[]> = {
  '3': [
    { id: 'st_a', name: 'A', order_there: 1, order_back: 4 },
    { id: 'turn', name: 'поворот', order_there: 2, order_back: 3, map_only: true },
    { id: 'st_b', name: 'B', order_there: 3, order_back: 2, belongs_to: 'there' },
    { id: 'st_c', name: 'C', order_there: 4, order_back: 1 },
    { id: 'st_x', name: 'X', order_there: -1, order_back: 0 },
  ],
  '1': [{ id: 'st_a', name: 'A', order_there: 1, order_back: 2 }, { id: 'st_c', name: 'C', order_there: 2, order_back: 1 }],
};
const coords: Record<string, [number, number]> = { st_a: [50.1, 29.1], turn: [50.15, 29.15], st_b: [50.2, 29.2], st_c: [50.3, 29.3] };

describe('withOrder', () => {
  it('turns a legacy list of names into ordered stops', () => {
    expect(withOrder(['A', 'B', 'C'])).toEqual([
      { name: 'A', order_there: 1, order_back: 3, belongs_to: 'both' },
      { name: 'B', order_there: 2, order_back: 2, belongs_to: 'both' },
      { name: 'C', order_there: 3, order_back: 1, belongs_to: 'both' },
    ]);
    expect(withOrder([])).toEqual([]);
  });
});

describe('routeStopChain', () => {
  it('orders by direction, honours belongs_to and order > 0, keeps map_only vertices by default', () => {
    expect(routeStopChain(stopsByRoute, '3', 'there')).toEqual(['st_a', 'turn', 'st_b', 'st_c']);
    expect(routeStopChain(stopsByRoute, '3', 'back')).toEqual(['st_c', 'turn', 'st_a']);
  });

  it('markersOnly drops the technical points; all returns every point sorted', () => {
    expect(routeStopChain(stopsByRoute, '3', 'there', { markersOnly: true })).toEqual(['st_a', 'st_b', 'st_c']);
    expect(routeStopChain(stopsByRoute, '3', 'back', { all: true })).toEqual(['st_x', 'st_c', 'st_b', 'turn', 'st_a']);
  });

  it('returns nothing for an unknown route', () => {
    expect(routeStopChain(stopsByRoute, '99', 'there')).toEqual([]);
    expect(routeStopChain(undefined, '3', 'there')).toEqual([]);
  });
});

describe('buildRouteLines', () => {
  it('draws verified routes in their scheme colour with every vertex that has coordinates', () => {
    const lines = buildRouteLines(coords, stopsByRoute, ['3', '1', '99']);
    expect(lines).toHaveLength(1);
    expect(lines[0].routeId).toBe('3');
    expect(lines[0].color).toBe('#1B9E4B');
    expect(lines[0].positions).toEqual([coords.st_a, coords.turn, coords.st_b, coords.st_c]);
  });

  it('skips a line with fewer than two located vertices', () => {
    expect(buildRouteLines({ st_a: coords.st_a }, stopsByRoute, ['3'])).toEqual([]);
  });

  it('draws route 10 (ex-6): its stop order and segments are rebuilt, so it is a verified route', () => {
    const withTen = {
      ...stopsByRoute,
      '10': [
        { id: 'st_a', name: 'A', order_there: 1, order_back: 2 },
        { id: 'st_c', name: 'C', order_there: 2, order_back: 1 },
      ],
    };
    const lines = buildRouteLines(coords, withTen, ['10']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ routeId: '10', color: '#C99700', positions: [coords.st_a, coords.st_c] });
  });
});

describe('pickBoundsStops', () => {
  const chain = ['st_a', 'turn', 'st_b', 'st_c'];
  it('fits the segment between З and До when the line is drawn', () => {
    expect(pickBoundsStops({ chain, stops: coords, fromStopName: 'st_c', toStopName: 'st_a', hasLine: true })).toEqual({
      names: chain,
      padding: [50, 50],
    });
  });
  it('fits both stops without a line, one stop alone, nothing without a pick', () => {
    expect(pickBoundsStops({ chain, stops: coords, fromStopName: 'st_a', toStopName: 'st_c', hasLine: false })).toEqual({
      names: ['st_a', 'st_c'],
      padding: [50, 50],
    });
    expect(pickBoundsStops({ chain, stops: coords, toStopName: 'st_b', hasLine: true })).toEqual({ names: ['st_b'], padding: [40, 40] });
    expect(pickBoundsStops({ chain, stops: coords, fromStopName: 'nowhere', hasLine: true })).toEqual({ names: [], padding: [40, 40] });
  });
});
