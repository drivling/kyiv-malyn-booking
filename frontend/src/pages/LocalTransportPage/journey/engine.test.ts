import { describe, expect, it } from 'vitest';
import { assembleTimetable } from './timetable';
import { journeyWindow, legAlternatives, planDay } from './plan';
import type { JourneyOptions } from './options';
import type { Endpoint, Journey, PatternTrip, Timetable, TimetableStop, TransitLeg, WalkLeg } from './types';

/**
 * Мережа на одній вулиці (lng = 29), 0.01° широти ≈ 1.11 км — зупинки далеко одна від одної, крім C і C2 (222 м).
 *
 *   A ── B ── C ── D ── E                F
 *             C2 (222 м від C, інша сторона вулиці)
 *
 *   №1  A→B→C        480/490/500 і 540/550/560
 *   №2  C→D→E        501, 510, 570 (з C)
 *   №3  A→E прямий   485 → 560
 *   №5  C2→F         503, 506, 570 (з C2)
 *   №6  A→C повільніший за №1 і виїжджає раніше (479 → 505): завжди домінований
 */
const OPTS: Partial<JourneyOptions> = {
  detourFactor: 1,
  walkSpeedMps: 1,
  minTransferMin: 2,
  maxTransferWalkM: 400,
  maxAccessWalkMin: 15,
  maxTransfers: 2,
  maxTransferWaitMin: 90,
  maxDirectWalkMin: 20,
};

const STOPS: TimetableStop[] = [
  { id: 'A', lat: 50.0, lng: 29 },
  { id: 'B', lat: 50.01, lng: 29 },
  { id: 'C', lat: 50.02, lng: 29 },
  { id: 'C2', lat: 50.022, lng: 29 },
  { id: 'D', lat: 50.03, lng: 29 },
  { id: 'E', lat: 50.04, lng: 29 },
  { id: 'F', lat: 50.06, lng: 29 },
];

const trip = (tripId: string, ...times: number[]): PatternTrip => ({ tripId, times });

function network(opts: { direct?: boolean; options?: Partial<JourneyOptions> } = {}): Timetable {
  const idx = (id: string) => STOPS.findIndex((s) => s.id === id);
  const pat = (routeId: string, ids: string[], trips: PatternTrip[]) => ({
    routeId,
    direction: 'there' as const,
    variantId: null,
    stops: ids.map(idx),
    trips,
  });
  return assembleTimetable({
    stops: STOPS,
    patterns: [
      pat('1', ['A', 'B', 'C'], [trip('1a', 480, 490, 500), trip('1b', 540, 550, 560)]),
      pat('2', ['C', 'D', 'E'], [trip('2a', 501, 511, 521), trip('2b', 510, 520, 530), trip('2c', 570, 580, 590)]),
      ...(opts.direct === false ? [] : [pat('3', ['A', 'E'], [trip('3a', 485, 560)])]),
      pat('5', ['C2', 'F'], [trip('5a', 503, 513), trip('5b', 506, 516), trip('5c', 570, 580)]),
      pat('6', ['A', 'C'], [trip('6a', 479, 505)]),
    ],
    options: { ...OPTS, ...opts.options },
  });
}

const stop = (stopId: string): Endpoint => ({ kind: 'stop', stopId });
const summary = (js: Journey[]) => js.map((j) => [j.departMins, j.arriveMins, j.transfers]);
const transitLegs = (j: Journey) => j.legs.filter((l): l is TransitLeg => l.kind === 'transit');
const walkLegs = (j: Journey) => j.legs.filter((l): l is WalkLeg => l.kind === 'walk');

describe('planDay: прямі поїздки', () => {
  it('віддає всі рейси дня, а повільніший і раніший за №1 (домінований) — відкидає', () => {
    const { journeys } = planDay(network(), stop('A'), stop('C'));
    expect(summary(journeys)).toEqual([
      [480, 500, 0],
      [540, 560, 0],
    ]);
    expect(transitLegs(journeys[0])[0]).toMatchObject({ routeId: '1', tripId: '1a', boardStopId: 'A', alightStopId: 'C' });
  });

  it('невідома зупинка, та сама зупинка і недосяжна пара — порожньо', () => {
    const tt = network();
    expect(planDay(tt, stop('A'), stop('Z')).journeys).toEqual([]);
    expect(planDay(tt, stop('A'), stop('A')).journeys).toEqual([]);
    expect(planDay(tt, stop('E'), stop('A')).journeys).toEqual([]);
  });
});

describe('planDay: пересадки', () => {
  it('Парето: прямий повільніший і з пересадкою швидший — обидва; хто встиг — той їде', () => {
    const { journeys } = planDay(network(), stop('A'), stop('E'));
    expect(summary(journeys)).toEqual([
      [480, 530, 1], // №1 до C 8:20, №2 о 8:21 не встигаємо (буфер 2 хв), їдемо о 8:30
      [485, 560, 0], // прямий №3
      [540, 590, 1], // №1 до C 9:20, №2 о 9:30
    ]);
    const first = journeys[0];
    expect(transitLegs(first).map((l) => [l.routeId, l.tripId])).toEqual([
      ['1', '1a'],
      ['2', '2b'],
    ]);
    expect(first.waitMins).toBe(10);
  });

  it('буфер пересадки minTransferMin: з нульовим встигаємо на рейс 8:21', () => {
    const { journeys } = planDay(network({ options: { minTransferMin: 0 } }), stop('A'), stop('E'));
    expect(journeys[0]).toMatchObject({ departMins: 480, arriveMins: 521, transfers: 1 });
  });

  it('пішки між зупинками: з №1 на №5 через 222 м; рейс 8:23 не встигаємо, їдемо о 8:26', () => {
    const { journeys } = planDay(network(), stop('A'), stop('F'));
    expect(summary(journeys)).toEqual([
      [480, 516, 1],
      [540, 580, 1],
    ]);
    const j = journeys[0];
    expect(j.legs.map((l) => l.kind)).toEqual(['transit', 'walk', 'transit']);
    const walk = walkLegs(j)[0];
    expect(walk).toMatchObject({ from: { stopId: 'C' }, to: { stopId: 'C2' }, depMins: 500, arrMins: 504, meters: 222 });
    expect(transitLegs(j)[1]).toMatchObject({ tripId: '5b', depMins: 506 });
    expect(j.walkMeters).toBe(222);
    expect(j.waitMins).toBe(2);
  });

  it('maxTransfers = 0 залишає лише прямі', () => {
    const { journeys } = planDay(network({ options: { maxTransfers: 0 } }), stop('A'), stop('E'));
    expect(summary(journeys)).toEqual([[485, 560, 0]]);
  });

  it('довге очікування на пересадці відсікається, коли є інший варіант', () => {
    const { journeys } = planDay(network({ options: { maxTransferWaitMin: 5 } }), stop('A'), stop('E'));
    expect(summary(journeys)).toEqual([[485, 560, 0]]);
  });

  it('…а коли інших варіантів нема, ліміт очікування знімається', () => {
    const { journeys } = planDay(network({ direct: false, options: { maxTransferWaitMin: 5 } }), stop('A'), stop('E'));
    expect(summary(journeys)).toEqual([
      [480, 530, 1],
      [540, 590, 1],
    ]);
  });
});

describe('planDay: точки замість зупинок', () => {
  it('пішки до зупинки на старті: відступ зсунуто якнайпізніше', () => {
    // 49.999 → 111 м до A = 2 хв
    const { journeys } = planDay(network(), { kind: 'point', lat: 49.999, lng: 29 }, stop('C'));
    const j = journeys[0];
    expect(j.legs.map((l) => l.kind)).toEqual(['walk', 'transit']);
    expect(walkLegs(j)[0]).toMatchObject({ from: { lat: 49.999, lng: 29 }, to: { stopId: 'A' }, depMins: 478, arrMins: 480, meters: 111 });
    expect(j.departMins).toBe(478);
  });

  it('пішки від зупинки до точки призначення входить у прибуття', () => {
    // 50.041 → 111 м від E = 2 хв
    const { journeys } = planDay(network({ direct: false }), stop('A'), { kind: 'point', lat: 50.041, lng: 29 });
    expect(journeys[0]).toMatchObject({ departMins: 480, arriveMins: 532, transfers: 1 });
    const last = journeys[0].legs[journeys[0].legs.length - 1] as WalkLeg;
    expect(last).toMatchObject({ kind: 'walk', from: { stopId: 'E' }, to: { lat: 50.041, lng: 29 }, depMins: 530, arrMins: 532 });
  });

  it('зупинки далі за maxAccessWalkMin від точки не беруться', () => {
    const { journeys } = planDay(network(), { kind: 'point', lat: 49.9, lng: 29 }, stop('C'));
    expect(journeys).toEqual([]);
  });
});

describe('planDay: піший маршрут напряму', () => {
  it('близькі кінці — пропонуємо пішки', () => {
    // A–B = 1112 м = 19 хв ≤ 20
    expect(planDay(network(), stop('A'), stop('B')).directWalk).toEqual({ meters: 1112, minutes: 19 });
  });
  it('далекі — ні', () => {
    expect(planDay(network(), stop('A'), stop('C')).directWalk).toBeNull();
  });
});

describe('journeyWindow', () => {
  const day = () => planDay(network(), stop('A'), stop('C')).journeys; // 480→500, 540→560

  it('відправлення о…: основні — з відправленням не раніше, «раніше» — решта', () => {
    const w = journeyWindow(day(), { mode: 'depart', mins: 500 });
    expect(summary(w.items)).toEqual([[540, 560, 0]]);
    expect(w).toMatchObject({ hiddenEarlier: 1, hiddenLater: 0 });
    expect(summary(journeyWindow(day(), { mode: 'depart', mins: 500, before: 1 }).items)).toEqual([
      [480, 500, 0],
      [540, 560, 0],
    ]);
  });

  it('прибуття о…: основні — ті, що встигають, найпізніші за відправленням', () => {
    const w = journeyWindow(day(), { mode: 'arrive', mins: 520 });
    expect(summary(w.items)).toEqual([[480, 500, 0]]);
    expect(w).toMatchObject({ hiddenEarlier: 0, hiddenLater: 1 });
    expect(journeyWindow(day(), { mode: 'arrive', mins: 560 }).items).toHaveLength(2);
    expect(journeyWindow(day(), { mode: 'arrive', mins: 560, before: 1 }).hiddenEarlier).toBe(1);
  });

  it('ліміт after обрізає хвіст і рахує приховане', () => {
    const w = journeyWindow(day(), { mode: 'depart', mins: 0, after: 1 });
    expect(summary(w.items)).toEqual([[480, 500, 0]]);
    expect(w.hiddenLater).toBe(1);
  });
});

describe('legAlternatives', () => {
  it('наступні рейси того ж патерна з тієї ж посадки до тієї ж висадки', () => {
    const tt = network();
    const { journeys } = planDay(tt, stop('B'), stop('C'));
    const leg = transitLegs(journeys[0])[0]; // №1, 8:10 → 8:20
    expect(leg).toMatchObject({ depMins: 490, arrMins: 500 });
    expect(legAlternatives(tt, leg)).toEqual([{ tripId: '1b', depMins: 550, arrMins: 560 }]);
  });

  it('count обмежує кількість', () => {
    const tt = network();
    const { journeys } = planDay(tt, stop('C'), stop('E'));
    const leg = transitLegs(journeys[0])[0];
    expect(legAlternatives(tt, leg, 1)).toHaveLength(1);
  });
});
