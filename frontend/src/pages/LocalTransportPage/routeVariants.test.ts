import { describe, it, expect } from 'vitest';
import {
  chainForRecord,
  chainsServingPair,
  recordDirection,
  recordVariant,
  routeChainSources,
  servedStopIds,
  variantChain,
  type VariantsByRoute,
} from './routeVariants';
import type { RouteStopWithOrder, TransportData, TransportRecord } from './types';

const stopsByRoute: Record<string, RouteStopWithOrder[]> = {
  '9': [
    { id: 'st_p', name: 'Промінь', order_there: 1, order_back: 4 },
    { id: 'st_t', name: '№9 т.1', order_there: 2, order_back: 3, map_only: true },
    { id: 'st_m', name: 'Малинівка', order_there: 3, order_back: 2 },
    { id: 'st_o', name: 'Олекси Тихого', order_there: 4, order_back: 1 },
    { id: 'st_x', name: 'Вимкнена', order_there: -1, order_back: -1 },
  ],
};
const variantsByRoute: VariantsByRoute = {
  '9': [
    {
      id: '9-v1',
      direction: 'there',
      name: 'Перший рейс: центр → вокзал',
      stops: [
        { id: 'st_p', name: 'Промінь' },
        { id: 'st_w', name: '№9 т.9', map_only: true },
        { id: 'st_v', name: 'Вокзал' },
      ],
    },
    {
      id: '9-v2',
      direction: 'back',
      name: 'Перший рейс: вокзал → лікарня',
      stops: [
        { id: 'st_v', name: 'Вокзал' },
        { id: 'st_o', name: 'Олекси Тихого' },
        { id: 'st_m', name: 'Малинівка' },
        { id: 'st_p', name: 'Промінь' },
        { id: 'st_l', name: 'Лікарня' },
      ],
    },
  ],
};
const rec = (extra: Partial<TransportRecord>): TransportRecord => ({
  route_id: '9',
  trip_id: '9-01',
  trip_headsign: '',
  direction_id: '1',
  ...extra,
});

describe('recordDirection / recordVariant', () => {
  it('direction_id "0" is back, anything else there', () => {
    expect(recordDirection({ direction_id: '0' })).toBe('back');
    expect(recordDirection({ direction_id: '1' })).toBe('there');
    expect(recordDirection({ direction_id: '' })).toBe('there');
  });

  it('a variant counts only on its route and direction', () => {
    expect(recordVariant(variantsByRoute, rec({ variant_id: '9-v1' }))?.id).toBe('9-v1');
    expect(recordVariant(variantsByRoute, rec({ variant_id: '9-v2' }))).toBeNull(); // інший напрямок
    expect(recordVariant(variantsByRoute, rec({ variant_id: 'nope' }))).toBeNull();
    expect(recordVariant(variantsByRoute, rec({ variant_id: null }))).toBeNull();
    expect(recordVariant(undefined, rec({ variant_id: '9-v1' }))).toBeNull();
  });
});

describe('chainForRecord', () => {
  it('variant trip → its chain (technical points unless markersOnly)', () => {
    expect(chainForRecord(stopsByRoute, variantsByRoute, rec({ variant_id: '9-v1' }))).toEqual(['st_p', 'st_w', 'st_v']);
    expect(chainForRecord(stopsByRoute, variantsByRoute, rec({ variant_id: '9-v1' }), { markersOnly: true })).toEqual(['st_p', 'st_v']);
    expect(variantChain(variantsByRoute['9']![1])).toEqual(['st_v', 'st_o', 'st_m', 'st_p', 'st_l']);
  });

  it('main trip or unknown variant → main chain of its direction', () => {
    expect(chainForRecord(stopsByRoute, variantsByRoute, rec({}))).toEqual(['st_p', 'st_t', 'st_m', 'st_o']);
    expect(chainForRecord(stopsByRoute, variantsByRoute, rec({ direction_id: '0', variant_id: 'nope' }), { markersOnly: true })).toEqual([
      'st_o',
      'st_m',
      'st_p',
    ]);
  });
});

describe('servedStopIds / chainsServingPair', () => {
  it('passenger stops of the main chains and of every variant', () => {
    expect([...servedStopIds(stopsByRoute, variantsByRoute, '9')].sort()).toEqual(['st_l', 'st_m', 'st_o', 'st_p', 'st_v']);
    expect([...servedStopIds(stopsByRoute, undefined, '9')].sort()).toEqual(['st_m', 'st_o', 'st_p']);
    expect(servedStopIds(undefined, undefined, '9').size).toBe(0);
  });

  it('main there/back first, then variants; from must precede to', () => {
    expect(chainsServingPair(stopsByRoute, variantsByRoute, '9', 'st_p', 'st_m').map((c) => [c.direction, c.variantId])).toEqual([
      ['there', null],
    ]);
    expect(chainsServingPair(stopsByRoute, variantsByRoute, '9', 'st_m', 'st_p').map((c) => [c.direction, c.variantId])).toEqual([
      ['back', null],
      ['back', '9-v2'],
    ]);
    const toStation = chainsServingPair(stopsByRoute, variantsByRoute, '9', 'st_p', 'st_v');
    expect(toStation).toEqual([{ direction: 'there', variantId: '9-v1', chain: ['st_p', 'st_w', 'st_v'] }]);
    expect(chainsServingPair(stopsByRoute, variantsByRoute, '9', 'st_p', 'st_w')).toEqual([]); // технічна точка
  });

  it('routeChainSources reads both maps from the site data', () => {
    const data = { records: [], supplement: { stops: { stops_by_route: stopsByRoute, variants_by_route: variantsByRoute } } } as unknown as TransportData;
    expect(routeChainSources(data).variantsByRoute).toBe(variantsByRoute);
    expect(routeChainSources(null).stopsByRoute).toBeUndefined();
  });
});
