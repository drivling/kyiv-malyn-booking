/**
 * Відповідь сервера про дорогу містом → кроки за видом транспорту. Відповіді — справжні, з нашої бази
 * (`fixtures/kyiv-city-modes.json`: по одній на вид — фунікулер, трамвай, швидкісний трамвай, тролейбус, автобус,
 * маршрутка, кільцева, приміська електричка, метро + трамвай Подолом).
 */
import { describe, expect, it } from 'vitest';
import { metroTrip } from '../data/kyiv';
import { nextRingRide } from '../data/kyivRing';
import fixtures from './fixtures/kyiv-city-modes.json';
import { funicularWay, metroStationByName, ridePhrase, rideLook, ringStationByName, splitCityRoute } from './cityTransit';
import type { CityRoute, CityStep, StoryLeg } from './types';

type CityLeg = Extract<StoryLeg, { kind: 'city' }>;
type Ride = Extract<StoryLeg, { kind: 'cityRide' }>;

const DATE = '2026-11-19';
const answers = fixtures.answers as unknown as Record<string, { ask: { from: string; to: string; time: string }; route: CityRoute }>;
const legOf = (route: CityRoute, city: CityLeg['city'] = 'Kyiv'): CityLeg => ({
  kind: 'city',
  city,
  cityName: city === 'Kyiv' ? 'Київ' : 'Житомир',
  ask: { city, from: 'А', to: 'Б', date: DATE, time: '12:00' },
  fromLabel: route.fromLabel,
  toLabel: route.toLabel,
  route,
  depMins: 720,
  arrMins: 720 + route.minutes,
  mapsUrl: 'https://maps.example/x',
});
const split = (key: string, dep = 720) => splitCityRoute(legOf(answers[key].route), dep, DATE)!;
const kinds = (legs: StoryLeg[]) => legs.map((l) => (l.kind === 'cityRide' ? `ride:${rideLook(l.step)}` : l.kind));
const rides = (legs: StoryLeg[]) => legs.filter((l): l is Ride => l.kind === 'cityRide');

describe('cityTransit: назви станцій із відповіді Google', () => {
  it('метро: лапки, «ст. м.», «станція метро», російська назва', () => {
    expect(metroStationByName('Палац "Україна"')?.id).toBe('kyiv.m.palats-ukraina');
    expect(metroStationByName('ст. м. Контрактова площа')?.id).toBe('kyiv.m.kontraktova');
    expect(metroStationByName('Станція метро «Хрещатик»')?.name).toBe('Хрещатик');
    expect(metroStationByName('Святошино')?.id).toBe('kyiv.sviatoshyn');
    expect(metroStationByName('пл. Севастопольська')).toBeNull();
  });

  it('кільцева: латинська «i» Google, «Північна» = наша «Вокзальна»', () => {
    expect(ringStationByName('Видубичi')?.id).toBe('kyiv.e.vydubychi');
    expect(ringStationByName('Північна')?.id).toBe('kyiv.e.vokzalna');
    expect(ringStationByName('Київ-Пасажирський (Північна)')?.id).toBe('kyiv.e.vokzalna');
    expect(ringStationByName('Борщагівка')?.id).toBe('kyiv.borshch');
    expect(ringStationByName('ДВРЗ')).toBeNull();
  });
});

describe('cityTransit: кожен вид — свій крок', () => {
  it('у фікстурах є всі види, заради яких їх збирали', () => {
    const modes = new Set(Object.values(answers).flatMap((a) => a.route.steps.filter((s) => s.kind === 'transit').map((s) => s.mode)));
    expect([...modes].sort()).toEqual(['BUS', 'FUNICULAR', 'HEAVY_RAIL', 'SHARE_TAXI', 'SUBWAY', 'TRAM', 'TROLLEYBUS']);
  });

  it('фунікулер: пішки → фунікулер вгору від «Поштова площа» до «Михайлівська площа» → пішки; униз — навпаки', () => {
    const up = split('funicular');
    expect(kinds(up.legs)).toEqual(['walk', 'ride:funicular', 'walk']);
    const r = rides(up.legs)[0];
    expect(funicularWay('Kyiv', r.step)).toEqual({ up: true, from: 'Поштова площа', to: 'Михайлівська площа' });
    expect(ridePhrase('Kyiv', r.step)).toBe('фунікулер вгору до «Михайлівська площа»');
    // очікування, якого Google не розписав (9 − 7 хв), — перед вагончиком; уся дорога — як у відповіді
    expect([r.depMins, up.minutes]).toEqual([720 + 2 + 2, 9]);
    expect([r.checkedAt, r.mapsUrl]).toEqual([answers.funicular.route.fetchedAt, 'https://maps.example/x']);
    // пішки — до нашої назви станції, а не до «Нижняя станция» Google
    expect(up.legs[0]).toMatchObject({ kind: 'walk', toLabel: 'Поштова площа' });
    const down = rides(split('funicular_down').legs)[0];
    expect(funicularWay('Kyiv', down.step)).toEqual({ up: false, from: 'Михайлівська площа', to: 'Поштова площа' });
    // у місті без свого опису — лише сторона
    expect(funicularWay('Zhytomyr', down.step)).toEqual({ up: false, from: 'верхня станція', to: 'нижня станція' });
  });

  it('трамвай, тролейбус, автобус: по одній поїздці з карткою свого виду', () => {
    expect(kinds(split('tram').legs)).toEqual(['walk', 'ride:tram', 'walk']);
    expect(ridePhrase('Kyiv', rides(split('tram').legs)[0].step)).toBe('трамвай 12');
    expect(kinds(split('trolleybus').legs)).toEqual(['walk', 'ride:trolleybus', 'walk']);
    expect(kinds(split('bus').legs)).toEqual(['walk', 'ride:bus', 'walk']);
  });

  it('швидкісний трамвай — окремий вигляд: зупинки Google звуть «станція "…"»', () => {
    const legs = split('speed_tram', 540).legs;
    expect(kinds(legs)).toEqual(['walk', 'ride:speedTram', 'walk']);
    expect(ridePhrase('Kyiv', rides(legs)[0].step)).toMatch(/^швидкісний трамвай \d/);
    expect((legs[0] as Extract<StoryLeg, { kind: 'walk' }>).toLabel).not.toMatch(/станці|"/);
    expect(rideLook({ mode: 'TRAM', fromStop: 'вул. Ярославська', toStop: '6-а лінія' })).toBe('tram');
    expect(rideLook({ mode: 'LIGHT_RAIL' })).toBe('speedTram');
  });

  it('маршрутка + автобус: дві поїздки; «перевірено» й карта — лише в останній', () => {
    const legs = split('share_taxi').legs;
    expect(kinds(legs)).toEqual(['walk', 'ride:minibus', 'ride:bus', 'walk']);
    const [a, b] = rides(legs);
    expect([a.checkedAt, a.mapsUrl, b.checkedAt != null, b.mapsUrl]).toEqual([null, null, true, 'https://maps.example/x']);
    expect(b.depMins).toBe(a.arrMins);
  });

  it('кільцева з відповіді — наш рейс із розкладу (точний час), а не крок Google', () => {
    const { legs, minutes } = split('ring');
    expect(kinds(legs)).toEqual(['ring', 'walk']);
    const ring = legs[0] as Extract<StoryLeg, { kind: 'ring' }>;
    const own = nextRingRide('kyiv.e.vokzalna', 'kyiv.borshch', DATE, 720)!;
    expect([ring.ride.train, ring.depMins, ring.arrMins, ring.priceUah]).toEqual([own.train, own.depMins, own.arrMins, 30]);
    expect(minutes).toBe(own.arrMins + 20 - 720);
    // відповідь на 12:00, а людина питає о 13:27: найближчий поїзд за нашим розкладом — 14:11, чекати його чесно
    const later = splitCityRoute(legOf(answers.ring.route), 13 * 60 + 27, DATE)!.legs[0] as Extract<StoryLeg, { kind: 'ring' }>;
    expect(later.depMins).toBe(nextRingRide('kyiv.e.vokzalna', 'kyiv.borshch', DATE, 13 * 60 + 27)!.depMins);
    // пізно ввечері рейсів уже немає — лишається крок сервера
    expect(kinds(splitCityRoute(legOf(answers.ring.route), 23 * 60 + 55, DATE)!.legs)[0]).toBe('ride:rail');
  });

  it('приміська електричка (номер, не City Express) лишається поїздкою Google — вигляд «електричка»', () => {
    const legs = split('rail').legs;
    expect(kinds(legs)).toEqual(['walk', 'ride:bus', 'walk', 'ride:rail']);
    expect(ridePhrase('Kyiv', rides(legs)[1].step)).toBe('електричка 6809');
  });

  it('метро + трамвай Подолом: метро своє, трамвай — картка трамвая', () => {
    const legs = split('tram_podil', 540).legs;
    expect(kinds(legs)).toEqual(['walk', 'metro', 'walk', 'ride:tram', 'walk']);
    const m = legs[1] as Extract<StoryLeg, { kind: 'metro' }>;
    const own = metroTrip(m.segments[0].from.id, m.segments.at(-1)!.to.id, { mins: m.depMins, date: DATE })!;
    expect(m.minutes).toBe(own.minutes);
    expect(legs[0]).toMatchObject({ kind: 'walk', toLabel: m.segments[0].from.name });
  });
});

describe('cityTransit: межі', () => {
  const walk = (minutes: number): CityStep => ({ kind: 'walk', minutes, meters: minutes * 70 });
  const subway = (fromStop: string, toStop: string, minutes = 10): CityStep => ({ kind: 'transit', mode: 'SUBWAY', line: '2', fromStop, toStop, minutes, stops: 4 });
  const route = (steps: CityStep[]): CityRoute => ({ source: 'stored', fromLabel: 'А', toLabel: 'Б', steps, minutes: steps.reduce((n, s) => n + s.minutes, 0), fetchedAt: '2026-11-17T08:00:00.000Z' });

  it('два поїзди метро з короткою пішою між ними — одна поїздка з пересадкою', () => {
    const got = splitCityRoute(legOf(route([walk(4), subway('Академмістечко', 'Театральна', 25), walk(3), subway('Золоті ворота', 'Лукʼянівська', 4), walk(6)])), 540, DATE)!;
    expect(kinds(got.legs)).toEqual(['walk', 'metro', 'walk']);
    const m = got.legs[1] as Extract<StoryLeg, { kind: 'metro' }>;
    expect(m.transfers.map((t) => [t.from.name, t.to.name])).toEqual([['Театральна', 'Золоті ворота']]);
  });

  it('Житомир: метро й кільцевої своїх немає — усе поїздки сервера; невідома станція й зачинене метро — крок сервера', () => {
    expect(kinds(splitCityRoute(legOf(route([walk(3), subway('Палац "Україна"', 'Контрактова площа')]), 'Zhytomyr'), 540, DATE)!.legs)).toEqual(['walk', 'ride:subway']);
    expect(kinds(splitCityRoute(legOf(route([walk(3), subway('Невідома', 'Контрактова площа')])), 540, DATE)!.legs)).toEqual(['walk', 'ride:subway']);
    expect(kinds(splitCityRoute(legOf(route([walk(3), subway('Палац "Україна"', 'Контрактова площа')])), 23 * 60 + 50, DATE)!.legs)).toEqual(['walk', 'ride:subway']);
  });

  it('відповіді немає — null (крок лишається з кнопкою карти)', () => {
    expect(splitCityRoute({ ...legOf(route([walk(3)])), route: null }, 540, DATE)).toBeNull();
  });
});
