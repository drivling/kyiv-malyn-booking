import { describe, expect, it } from 'vitest';
import { journeyToMap } from './mapData';
import type { Journey, TransitLeg, WalkLeg } from './types';

const coords: Record<string, [number, number]> = {
  A: [50.0, 29.0],
  X: [50.005, 29.0], // технічна точка між A і B
  B: [50.01, 29.0],
  C: [50.02, 29.0],
};

const ride = (board: string, alight: string, stopIds: string[]): TransitLeg => ({
  kind: 'transit',
  routeId: '2',
  tripId: 't',
  direction: 'there',
  variantId: null,
  boardStopId: board,
  alightStopId: alight,
  depMins: 480,
  arrMins: 490,
  stopIds,
  stopTimes: [],
  patternIndex: 0,
  tripIndex: 0,
  boardPos: 0,
  alightPos: 1,
});

const journey = (legs: Journey['legs']): Journey => ({ legs, departMins: 480, arriveMins: 490, transfers: 0, walkMeters: 0, waitMins: 0 });

describe('journeyToMap', () => {
  it('ділянка рейсу йде вздовж ланцюжка з технічними точками, а не прямою між зупинками', () => {
    const m = journeyToMap(journey([ride('A', 'B', ['A', 'B'])]), { coords, chainOf: () => ['A', 'X', 'B', 'C'] });
    expect(m.legs).toEqual([{ kind: 'transit', routeId: '2', positions: [coords.A, coords.X, coords.B] }]);
    expect(m.nodes).toEqual([coords.A, coords.B]);
  });

  it('без ланцюжка рейсу — прямі між пасажирськими зупинками', () => {
    const m = journeyToMap(journey([ride('A', 'C', ['A', 'B', 'C'])]), { coords, chainOf: () => [] });
    expect(m.legs[0].positions).toEqual([coords.A, coords.B, coords.C]);
  });

  it('пішки: від точки до зупинки і між зупинками', () => {
    const walk1: WalkLeg = { kind: 'walk', from: { lat: 49.999, lng: 29 }, to: { stopId: 'A' }, depMins: 478, arrMins: 480, meters: 111 };
    const walk2: WalkLeg = { kind: 'walk', from: { stopId: 'B' }, to: { stopId: 'C' }, depMins: 490, arrMins: 492, meters: 50 };
    const m = journeyToMap(journey([walk1, ride('A', 'B', ['A', 'B']), walk2]), { coords, chainOf: () => ['A', 'X', 'B'] });
    expect(m.legs.map((l) => l.kind)).toEqual(['walk', 'transit', 'walk']);
    expect(m.legs[0].positions).toEqual([[49.999, 29], coords.A]);
    expect(m.legs[2].positions).toEqual([coords.B, coords.C]);
    expect(m.legs[0].routeId).toBeUndefined();
  });

  it('зупинка без координат не ламає: ділянка пропускається', () => {
    const m = journeyToMap(journey([ride('Q', 'Z', ['Q', 'Z'])]), { coords, chainOf: () => [] });
    expect(m.legs).toEqual([]);
    expect(m.nodes).toEqual([]);
  });
});
