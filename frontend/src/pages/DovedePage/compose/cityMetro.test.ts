/** Метро всередині дороги містом: крок «SUBWAY» з відповіді сервера стає своєю карткою метро. */
import { describe, expect, it } from 'vitest';
import { metroTrip } from '../data/kyiv';
import { metroStationByName, withOwnMetro } from './cityMetro';
import type { CityRoute, CityStep, StoryLeg } from './types';

type CityLeg = Extract<StoryLeg, { kind: 'city' }>;

const DATE = '2026-11-18';
const leg = (steps: CityStep[], city: CityLeg['city'] = 'Kyiv'): CityLeg => {
  const route: CityRoute = { source: 'stored', fromLabel: 'А', toLabel: 'Б', steps, minutes: steps.reduce((n, s) => n + s.minutes, 0), fetchedAt: '2026-11-17T08:00:00.000Z' };
  return { kind: 'city', city, cityName: city === 'Kyiv' ? 'Київ' : 'Житомир', ask: { city, from: 'А', to: 'Б', date: DATE, time: '09:00' }, fromLabel: 'А', toLabel: 'Б', route, depMins: 540, arrMins: 540 + route.minutes, mapsUrl: 'https://maps.example/x' };
};
const walk = (minutes: number, meters = minutes * 70): CityStep => ({ kind: 'walk', minutes, meters });
const subway = (fromStop: string, toStop: string, minutes = 10, line = '2'): CityStep => ({ kind: 'transit', mode: 'SUBWAY', line, fromStop, toStop, minutes, stops: 4 });
const bus = (line: string, minutes = 15): CityStep => ({ kind: 'transit', mode: 'BUS', line, fromStop: 'x', toStop: 'y', minutes, stops: 6 });

describe('cityMetro', () => {
  it('станцію з відповіді Google впізнає за назвою: лапки, «ст. м.», «станція метро», інша мова', () => {
    expect(metroStationByName('Палац "Україна"')?.id).toBe('kyiv.m.palats-ukraina');
    expect(metroStationByName('ст. м. Контрактова площа')?.id).toBe('kyiv.m.kontraktova');
    expect(metroStationByName('Станція метро «Хрещатик»')?.name).toBe('Хрещатик');
    expect(metroStationByName('Святошино')?.id).toBe('kyiv.sviatoshyn');
    expect(metroStationByName('пл. Севастопольська')).toBeNull();
    expect(metroStationByName(undefined)).toBeNull();
  });

  it('пішки → метро → автобус: пішки до станції, своя картка метро, решта — крок містом від виходу з метро', () => {
    const got = withOwnMetro(leg([walk(9), subway('Палац "Україна"', 'Контрактова площа'), walk(2), bus('368', 16), walk(5)]), 540, DATE)!;
    const own = metroTrip('kyiv.m.palats-ukraina', 'kyiv.m.kontraktova', { mins: 549, date: DATE })!;
    expect(got.legs.map((l) => l.kind)).toEqual(['walk', 'metro', 'city']);
    expect(got.legs[0]).toMatchObject({ kind: 'walk', minutes: 9, toLabel: 'Палац «Україна»' });
    expect(got.legs[1]).toMatchObject({ kind: 'metro', depMins: 549, arrMins: 549 + own.minutes, minutes: own.minutes, headwayMin: own.headwayMin, priceUah: own.priceUah, mapsUrl: 'https://maps.example/x' });
    const rest = got.legs[2] as CityLeg;
    expect([rest.fromLabel, rest.toLabel, rest.depMins, rest.arrMins, rest.route!.minutes]).toEqual(['метро «Контрактова площа»', 'Б', 549 + own.minutes, 549 + own.minutes + 23, 23]);
    expect(got.minutes).toBe(9 + own.minutes + 23);
  });

  it('два поїзди з пересадкою пішки між ними — одна поїздка нашим метро з пересадкою', () => {
    const got = withOwnMetro(leg([walk(4), subway('Академмістечко', 'Театральна', 25, '1'), walk(3), subway('Золоті ворота', 'Лукʼянівська', 4, '3'), walk(6)]), 540, DATE)!;
    expect(got.legs.map((l) => l.kind)).toEqual(['walk', 'metro', 'walk']);
    const m = got.legs[1] as Extract<StoryLeg, { kind: 'metro' }>;
    expect(m.transfers.map((t) => [t.from.name, t.to.name])).toEqual([['Театральна', 'Золоті ворота']]);
    expect(got.legs[2]).toMatchObject({ kind: 'walk', minutes: 6, toLabel: 'Б' });
  });

  it('без метро, Житомир, станція не впізнана, метро зачинене — крок лишається, як був (null)', () => {
    expect(withOwnMetro(leg([walk(3), bus('110'), walk(1)]), 540, DATE)).toBeNull();
    expect(withOwnMetro(leg([walk(3), subway('Палац "Україна"', 'Контрактова площа')], 'Zhytomyr'), 540, DATE)).toBeNull();
    expect(withOwnMetro(leg([walk(3), subway('Невідома', 'Контрактова площа')]), 540, DATE)).toBeNull();
    expect(withOwnMetro(leg([walk(3), subway('Палац "Україна"', 'Контрактова площа')]), 23 * 60 + 50, DATE)).toBeNull();
    expect(withOwnMetro({ ...leg([walk(3)]), route: null }, 540, DATE)).toBeNull();
  });
});
