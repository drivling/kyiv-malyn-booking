import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { routeShortNames, stopRoutesFromRouteStops } from '../../scripts/transport-stop-routes.mjs';

describe('stopRoutesFromRouteStops (static stop pages)', () => {
  const rows = [
    { routeId: '3', stopId: 'st_0042', orderThere: -1, orderBack: 7 },
    { routeId: '12', stopId: 'st_0042', orderThere: 4, orderBack: -1 },
    { routeId: '5', stopId: 'st_0042', orderThere: -1, orderBack: -1 }, // вимкнена: №5 тут не зупиняється
    { routeId: '1', stopId: 'st_0042', orderThere: 3, orderBack: 3 }, // прихований маршрут
    { routeId: '12', stopId: 'st_0008', orderThere: -1, orderBack: -1 },
    { routeId: '7', stopId: 'st_0113', orderThere: 2, orderBack: 2, mapOnly: true },
    { routeId: '7', stopId: 'Лікарня', orderThere: 1, orderBack: 1 },
  ];

  it('chips list only routes that serve the stop, without hidden ones', () => {
    const map = stopRoutesFromRouteStops(rows, new Set(['1']));
    expect([...map.get('st_0042')].sort()).toEqual(['12', '3']);
  });

  it('a stop switched off everywhere keeps its page, with no chips', () => {
    const map = stopRoutesFromRouteStops(rows, new Set(['1']));
    expect(map.has('st_0008')).toBe(true);
    expect([...map.get('st_0008')]).toEqual([]);
  });

  it('map-only points and non-stop ids get no page', () => {
    const map = stopRoutesFromRouteStops(rows, new Set(['1']));
    expect(map.has('st_0113')).toBe(false);
    expect(map.has('Лікарня')).toBe(false);
    expect(stopRoutesFromRouteStops(undefined, new Set()).size).toBe(0);
  });
});

describe('routeShortNames (numbers on static stop pages)', () => {
  it('maps ids to their trimmed display numbers, skipping empty ones and numbers equal to the id', () => {
    const names = routeShortNames([
      { id: '11', shortName: ' 11/1 ' },
      { id: '5', shortName: '' },
      { id: '7', shortName: '7' },
      { id: '2' },
    ]);
    expect([...names]).toEqual([['11', '11/1']]);
    expect(routeShortNames(undefined).size).toBe(0);
  });
});

