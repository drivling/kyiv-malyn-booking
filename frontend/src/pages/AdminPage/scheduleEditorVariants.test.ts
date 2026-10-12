import { describe, it, expect } from 'vitest';
import type { TransportRouteStopDto, TransportRouteVariantDto, TransportTripDto } from '@/api/transportDataset';
import {
  MAIN_PATH,
  canSetTimepoint,
  moveTripToPath,
  parseVariantsText,
  pathChain,
  setTimepoint,
  timepointAt,
  tripPath,
  variantsForDirection,
  variantsToText,
} from './scheduleEditorVariants';
import { computeTripTimes } from './scheduleEditorTiming';

const routeStops: TransportRouteStopDto[] = [
  { routeId: '9', stopId: 'st_p', orderThere: 1, orderBack: 4 },
  { routeId: '9', stopId: 'st_t', orderThere: 2, orderBack: 3, mapOnly: true },
  { routeId: '9', stopId: 'st_m', orderThere: 3, orderBack: 2 },
  { routeId: '9', stopId: 'st_o', orderThere: 4, orderBack: 1 },
  { routeId: '9', stopId: 'st_x', orderThere: -1, orderBack: -1 },
  { routeId: '5', stopId: 'st_p', orderThere: 1, orderBack: 1 },
];
const toStation: TransportRouteVariantDto = {
  id: '9-v1',
  directionId: '1',
  name: 'через вокзал',
  stops: [{ stopId: 'st_p' }, { stopId: 'st_w', mapOnly: true }, { stopId: 'st_v' }],
};
const fromStation: TransportRouteVariantDto = {
  id: '9-v2',
  directionId: '0',
  name: 'від вокзалу до лікарні',
  stops: [{ stopId: 'st_v' }, { stopId: 'st_o' }, { stopId: 'st_m' }, { stopId: 'st_p' }, { stopId: 'st_l' }],
};
const trip = (extra: Partial<TransportTripDto> = {}): TransportTripDto => ({
  id: '9-02',
  routeId: '9',
  directionId: '0',
  departureTime: '07:05:00',
  ...extra,
});

describe('paths of a route', () => {
  it('variantsForDirection keeps the variants of one direction', () => {
    const route = { variants: [toStation, fromStation] };
    expect(variantsForDirection(route, '1')).toEqual([toStation]);
    expect(variantsForDirection(route, '0')).toEqual([fromStation]);
    expect(variantsForDirection({ variants: null }, '1')).toEqual([]);
    expect(variantsForDirection(null, '0')).toEqual([]);
  });

  it('pathChain: main chain by direction order (technical points only in the timing chain) or the variant', () => {
    expect(pathChain(routeStops, '9', '1', null)).toEqual({ chain: ['st_p', 'st_t', 'st_m', 'st_o'], passengers: ['st_p', 'st_m', 'st_o'] });
    expect(pathChain(routeStops, '9', '0', null)).toEqual({ chain: ['st_o', 'st_m', 'st_t', 'st_p'], passengers: ['st_o', 'st_m', 'st_p'] });
    expect(pathChain(routeStops, '9', '1', toStation)).toEqual({ chain: ['st_p', 'st_w', 'st_v'], passengers: ['st_p', 'st_v'] });
  });

  it('tripPath: the trip variant if the direction has it, otherwise the main path', () => {
    expect(tripPath(trip({ variantId: '9-v2' }), [fromStation])).toBe('9-v2');
    expect(tripPath(trip({ variantId: 'gone' }), [fromStation])).toBe(MAIN_PATH);
    expect(tripPath(trip({ variantId: null }), [fromStation])).toBe(MAIN_PATH);
  });

  it('moveTripToPath drops start/end and keeps timepoints on stops of the new path only', () => {
    const t = trip({
      startStopId: 'st_o',
      endStopId: 'st_m',
      timepoints: [{ stopId: 'st_o', time: '07:15' }, { stopId: 'st_l', time: '07:50' }],
    });
    expect(moveTripToPath(t, '9-v2', ['st_v', 'st_o', 'st_m', 'st_p', 'st_l'])).toEqual({
      variantId: '9-v2',
      startStopId: null,
      endStopId: null,
      timepoints: [{ stopId: 'st_o', time: '07:15' }, { stopId: 'st_l', time: '07:50' }],
    });
    expect(moveTripToPath(t, MAIN_PATH, ['st_o', 'st_m', 'st_p'])).toEqual({
      variantId: null,
      startStopId: null,
      endStopId: null,
      timepoints: [{ stopId: 'st_o', time: '07:15' }],
    });
    expect(moveTripToPath(trip(), MAIN_PATH, ['st_o']).timepoints).toBeNull();
  });
});

describe('timepoints', () => {
  const passengers = ['st_v', 'st_o', 'st_m', 'st_p', 'st_l'];

  it('setTimepoint adds, replaces and removes, keeping the chain order; timepointAt reads HH:MM', () => {
    let t = trip();
    t = { ...t, timepoints: setTimepoint(t, 'st_p', '07:45', passengers) };
    t = { ...t, timepoints: setTimepoint(t, 'st_o', '07:15', passengers) };
    expect(t.timepoints).toEqual([{ stopId: 'st_o', time: '07:15' }, { stopId: 'st_p', time: '07:45' }]);
    t = { ...t, timepoints: setTimepoint(t, 'st_o', '07:16', passengers) };
    expect(timepointAt(t, 'st_o')).toBe('07:16');
    expect(timepointAt({ timepoints: [{ stopId: 'st_o', time: '07:16:00' }] }, 'st_o')).toBe('07:16');
    expect(timepointAt(t, 'st_m')).toBe('');
    t = { ...t, timepoints: setTimepoint(t, 'st_o', '', passengers) };
    t = { ...t, timepoints: setTimepoint(t, 'st_p', '', passengers) };
    expect(t.timepoints).toBeNull();
  });

  it('canSetTimepoint: only served stops after the first one, and not together with «Прибуття»', () => {
    const chain = ['st_v', 'st_o', 'st_m', 'st_p', 'st_l'];
    const timing = computeTripTimes(trip({ startStopId: 'st_o' }), {}, '9', chain, 120);
    expect(canSetTimepoint(trip(), timing, 'st_m')).toBe(true);
    expect(canSetTimepoint(trip(), timing, 'st_o')).toBe(false); // перша обслуговувана — там відправлення
    expect(canSetTimepoint(trip(), timing, 'st_v')).toBe(false); // рейс тут не зупиняється
    expect(canSetTimepoint(trip({ arrivalTime: '07:50:00' }), timing, 'st_m')).toBe(false);
    expect(canSetTimepoint(trip(), null, 'st_m')).toBe(false);
  });
});

describe('variants JSON editor', () => {
  it('round-trips the variants; empty text — no variants', () => {
    expect(variantsToText([])).toBe('');
    expect(variantsToText(null)).toBe('');
    expect(parseVariantsText(variantsToText([toStation]))).toEqual({ variants: [toStation], error: '' });
    expect(parseVariantsText('  ')).toEqual({ variants: [], error: '' });
  });

  it('reports the first problem in Ukrainian', () => {
    expect(parseVariantsText('{').error).toMatch(/^Некоректний JSON/);
    expect(parseVariantsText('{}').error).toMatch(/Потрібен масив варіантів/);
    expect(parseVariantsText('[1]').error).toBe("Варіант 1: потрібен об'єкт");
    expect(parseVariantsText('[{"directionId":"1"}]').error).toBe('Варіант 1: потрібен id');
    expect(parseVariantsText('[{"id":"a","directionId":"2"}]').error).toMatch(/directionId — "1" \(туди\) або "0" \(назад\)/);
    expect(parseVariantsText('[{"id":"a","directionId":"1","name":" "}]').error).toMatch(/потрібна назва/);
    expect(parseVariantsText('[{"id":"a","directionId":"1","name":"x","stops":[{"id":"st_p"}]}]').error).toMatch(/stops — масив/);
    expect(parseVariantsText('[{"id":"a","directionId":"1","name":"x","stops":"st_p"}]').variants).toBeNull();
  });
});
