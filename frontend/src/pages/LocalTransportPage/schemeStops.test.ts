import { describe, it, expect } from 'vitest';
import { routesAtNode, routesAtStop, schemeNodeForStop, stopsOfNode } from './schemeStops';
import { SCHEME_NODES } from './scheme/malyn-scheme-nodes';

const dataset = {
  stops: [
    { id: 'st_0019', name: 'Залізничний вокзал', lat: 50.774, lng: 29.295 },
    { id: 'st_0035', name: 'Лікарня', lat: 50.77, lng: 29.21 },
    { id: 'st_0036', name: 'Лікарня 2', lat: 50.7701, lng: 29.2101 },
    { id: 'st_0072', name: 'Поліклініка', lat: 50.772, lng: 29.212 },
  ],
  routes: [
    { id: '2', fromName: 'Паперова фабрика', toName: 'Шевченка, 119' },
    { id: '3', fromName: 'Лісотехнікум', toName: 'Залізничний вокзал' },
    { id: '7', fromName: 'Лікарня', toName: 'Залізничний вокзал' },
    { id: '12', fromName: 'Лікарня', toName: 'Залізничний вокзал', unreliable: true },
    { id: '401', fromName: 'Малин', toName: 'Київ' },
  ],
  routeStops: [
    { routeId: '3', stopId: 'st_0019', orderThere: 9, orderBack: 1 },
    { routeId: '2', stopId: 'st_0019', orderThere: 9, orderBack: 1 },
    { routeId: '12', stopId: 'st_0019', orderThere: 5, orderBack: 1 },
    { routeId: '401', stopId: 'st_0019', orderThere: 1, orderBack: 2 },
    { routeId: '5', stopId: 'st_0019', orderThere: 0, orderBack: 0, mapOnly: true },
    { routeId: '2', stopId: 'st_0035', orderThere: 5, orderBack: 5 },
    { routeId: '2', stopId: 'st_0036', orderThere: 6, orderBack: 4 },
    { routeId: '7', stopId: 'st_0072', orderThere: 1, orderBack: 7 },
    { routeId: '3', stopId: 'st_0072', orderThere: 2, orderBack: 6 },
    { routeId: '12', stopId: 'st_0072', orderThere: 1, orderBack: 7 },
  ],
};

describe('routesAtStop', () => {
  it('lists scheme lines through the stop in legend order, skipping map-only and unreliable ones', () => {
    expect(routesAtStop(dataset, 'st_0019')).toEqual(['2', '3']);
  });

  it('ignores routes that are not on the scheme', () => {
    expect(routesAtStop(dataset, 'st_0072')).toEqual(['3', '7']);
    expect(routesAtStop({ ...dataset, routeStops: [{ routeId: '401', stopId: 'st_x' }] }, 'st_x')).toEqual([]);
  });

  it('skips routes on which the stop is switched off (-1 both ways), e.g. route 10 past «Будматеріали»', () => {
    const switchedOff = {
      ...dataset,
      routeStops: [
        { routeId: '3', stopId: 'st_b', orderThere: -1, orderBack: 7 },
        { routeId: '12', stopId: 'st_b', orderThere: 4, orderBack: -1 },
        { routeId: '7', stopId: 'st_b', orderThere: -1, orderBack: -1 },
      ],
      routes: dataset.routes.map((r) => ({ ...r, unreliable: false })),
    };
    expect(routesAtStop(switchedOff, 'st_b')).toEqual(['3', '12']);
  });

  it('returns nothing for an empty or unknown stop', () => {
    expect(routesAtStop(dataset, '')).toEqual([]);
    expect(routesAtStop(dataset, 'st_9999')).toEqual([]);
  });
});

describe('scheme nodes', () => {
  it('every generated node lists its primary stop first and the ids are unique across nodes', () => {
    const seen = new Set<string>();
    for (const n of SCHEME_NODES) {
      expect(n.stopIds[0]).toBe(n.id);
      for (const id of n.stopIds) {
        expect(seen.has(id), `${id} in two nodes`).toBe(false);
        seen.add(id);
      }
    }
  });

  it('finds the node for any of its stops, none for a stop between nodes', () => {
    const likarnia = schemeNodeForStop('st_0035');
    expect(likarnia?.name).toBe('Лікарня · Поліклініка');
    expect(schemeNodeForStop('st_0072')).toBe(likarnia); // Поліклініка — частина вузла
    expect(schemeNodeForStop('st_0036')).toBe(likarnia);
    expect(schemeNodeForStop('st_a')).toBeNull();
    expect(schemeNodeForStop('')).toBeNull();
  });

  it('a node sees the lines of all its stops, merged in legend order without unreliable routes', () => {
    const node = schemeNodeForStop('st_0036')!;
    expect(routesAtNode(dataset, node)).toEqual(['2', '3', '7']);
    expect(stopsOfNode(dataset, node)).toEqual([
      { stopId: 'st_0035', name: 'Лікарня', routeIds: ['2'] },
      { stopId: 'st_0036', name: 'Лікарня 2', routeIds: ['2'] },
      { stopId: 'st_0072', name: 'Поліклініка', routeIds: ['3', '7'] },
    ]);
  });

  it('a single-stop node behaves like routesAtStop', () => {
    const vokzal = schemeNodeForStop('st_0019')!;
    expect(vokzal.stopIds).toEqual(['st_0019']);
    expect(routesAtNode(dataset, vokzal)).toEqual(routesAtStop(dataset, 'st_0019'));
  });
});
