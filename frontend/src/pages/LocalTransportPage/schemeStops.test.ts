import { describe, it, expect } from 'vitest';
import { routesAtStop } from './schemeStops';

const dataset = {
  routes: [
    { id: '2', fromName: 'Паперова фабрика', toName: 'Шевченка, 119' },
    { id: '3', fromName: 'Лісотехнікум', toName: 'Залізничний вокзал' },
    { id: '12', fromName: 'Лікарня', toName: 'Залізничний вокзал', unreliable: true },
    { id: '401', fromName: 'Малин', toName: 'Київ' },
  ],
  routeStops: [
    { routeId: '3', stopId: 'st_0019', orderThere: 9, orderBack: 1 },
    { routeId: '2', stopId: 'st_0019', orderThere: 9, orderBack: 1 },
    { routeId: '12', stopId: 'st_0019', orderThere: 5, orderBack: 1 },
    { routeId: '401', stopId: 'st_0019', orderThere: 1, orderBack: 2 },
    { routeId: '5', stopId: 'st_0019', orderThere: 0, orderBack: 0, mapOnly: true },
    { routeId: '7', stopId: 'st_0035', orderThere: 1, orderBack: 7 },
  ],
};

describe('routesAtStop', () => {
  it('lists scheme lines through the stop in legend order, skipping map-only and unreliable ones', () => {
    expect(routesAtStop(dataset, 'st_0019')).toEqual(['2', '3']);
  });

  it('ignores routes that are not on the scheme', () => {
    expect(routesAtStop(dataset, 'st_0035')).toEqual(['7']);
    expect(routesAtStop({ ...dataset, routeStops: [{ routeId: '401', stopId: 'st_x' }] }, 'st_x')).toEqual([]);
  });

  it('returns nothing for an empty or unknown stop', () => {
    expect(routesAtStop(dataset, '')).toEqual([]);
    expect(routesAtStop(dataset, 'st_9999')).toEqual([]);
  });
});
