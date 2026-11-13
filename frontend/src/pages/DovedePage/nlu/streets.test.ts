import { describe, expect, it } from 'vitest';
import malynStops from '../eval/malyn-stops.json';
import { classify, composeStories } from '../compose/composeStories';
import type { LocalPlanner } from '../compose/types';
import { intentToParams, paramsToIntent } from '../ui/url';
import { pickIntent } from './merge';
import { parseLocal } from './parseLocal';
import { resolvePlace, setStopPlaces } from './places';
import { buildStopPlaces } from './stopPlaces';
import { STREETS, parseStreetId, streetIsApprox, streetSpot, withHouseFromText } from './streets';
import type { TripIntent } from './types';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };
const STOPS = buildStopPlaces(malynStops.stops);
setStopPlaces(STOPS);
const parse = (text: string) => parseLocal(text, NOW, STOPS).intent;
const street = (id: string) => STREETS.find((s) => s.id === id)!;

describe('«Доведе» — вулиці без зупинок і адреси', () => {
  it('вулиця з будинком після прийменника — адреса; будинок іде в id', () => {
    const i = parse('з Городищанської 20 до вокзалу');
    expect(i.from).toEqual({ id: 'street.horodyshchanska:20', text: 'Городищанської 20' });
    expect(i.to?.id).toBe('malyn.vokzal');
    expect(i.confidence).toBe('high');
    expect(resolvePlace('street.horodyshchanska:20')).toMatchObject({ city: 'Malyn', label: 'вул. Городищанська, 20' });
  });

  it('відмінки, «вул.», будинок з літерою, колишня назва', () => {
    expect(parse('від вокзалу на Городищанську').to?.id).toBe('street.horodyshchanska');
    expect(parse('до вулиці Городищанської, будинок 54').to?.id).toBe('street.horodyshchanska:54');
    expect(parse('з Городищанської 22а до центру').from?.id).toBe('street.horodyshchanska:22а');
    // вул. Українських Повстанців — колишня Чапаєва
    expect(parse('з центру до вулиці Чапаєва').to?.id).toBe('street.ukrainskykh-povstantsiv');
  });

  it('прізвище без імені: «на Коновальця 45» — вул. Євгена Коновальця', () => {
    expect(parse('з вокзалу на Коновальця 45').to?.id).toBe('street.ievhena-konovaltsia:45');
  });

  it('те саме слово, що в кураторському словнику чи зупинці: без будинку — вони, з будинком — адреса', () => {
    expect(parse('з Грушевського на вокзал').from?.id).toBe('malyn.hrushevskoho');
    expect(parse('з Грушевського 12 на вокзал').from?.id).toBe('street.mykhaila-hrushevskoho:12');
    expect(parse('з Грушевського 48 на вокзал').from?.id).toBe('st_0012'); // зупинка «Грушевського 48» — точніше за будинок
    expect(parse('з повороту на Коновальця до вокзалу').from?.id).toBe('st_0071');
  });

  it('провулок — лише коли сказано «провулок»', () => {
    expect(parse('до Коновальця').to?.id).toBe('street.ievhena-konovaltsia');
    expect(parse('до провулку Коновальця').to?.id).toBe('street.ievhena-konovaltsia-provulok');
  });

  it('не плутає: час не стає будинком, прикметник без прийменника — не вулиця', () => {
    const i = parse('з Городищанської до вокзалу о 9');
    expect(i.from?.id).toBe('street.horodyshchanska');
    expect(i.when.time).toBe('09:00');
    expect(parse('нова маршрутка Малин Київ').from?.id).toBe('city.Malyn');
    expect(parse('зелена').to).toBeNull();
  });

  it('точка: будинок з вулицею в OSM — точно; привʼязаний за геометрією, сусідній номер чи середина вулиці — приблизно', () => {
    const s = street('street.horodyshchanska');
    expect(streetSpot(s, '20')).toMatchObject({ how: 'exact', exact: true, lat: s.houses['20'][0] });
    // №21 в OSM без вулиці — привʼязано до Городищанської за розташуванням
    expect(streetSpot(s, '21')).toMatchObject({ how: 'near', exact: false, lat: s.near['21'][0] });
    // №28 немає взагалі — найближчий номер того самого (парного) боку: 26 або 30
    const n28 = streetSpot(s, '28');
    expect(n28.how).toBe('neighbour');
    expect([s.near['26'][0], s.near['30'][0]]).toContain(n28.lat);
    expect(streetSpot(s, '900')).toMatchObject({ how: 'street', exact: false, lat: s.lat });
    expect(streetSpot(s, null)).toMatchObject({ how: 'street', exact: false, lat: s.lat });
    expect(streetIsApprox('street.horodyshchanska:20')).toBe(false);
    expect(streetIsApprox('street.horodyshchanska:21')).toBe(true);
    expect(streetIsApprox('street.horodyshchanska')).toBe(true);
    expect(parseStreetId('street.nema-takoi:5')).toBeNull();
  });

  it('будинків після привʼязки за геометрією — тисячі, і жоден номер не лежить в обох списках', () => {
    const tagged = STREETS.reduce((n, x) => n + Object.keys(x.houses).length, 0);
    const near = STREETS.reduce((n, x) => n + Object.keys(x.near).length, 0);
    expect(tagged).toBeGreaterThan(300);
    expect(near).toBeGreaterThan(2000);
    for (const x of STREETS) for (const num of Object.keys(x.near)) expect(x.houses[num], `${x.id}:${num}`).toBeUndefined();
  });

  it('в адресі сторінки — вулиця без номера будинку', () => {
    const i = parse('з Городищанської 20 до вокзалу');
    const q = intentToParams(i, NOW.date);
    expect(q.get('f')).toBe('street.horodyshchanska');
    expect(q.toString()).not.toContain('20&');
    expect(paramsToIntent(q, NOW)?.from?.id).toBe('street.horodyshchanska');
  });

  it('Claude повертає id вулиці, а будинок лишає в словах — переносимо його в id', () => {
    expect(withHouseFromText('street.horodyshchanska', 'з Городищанської 22а')).toBe('street.horodyshchanska:22а');
    expect(withHouseFromText('street.horodyshchanska', 'Городищанської')).toBe('street.horodyshchanska');
    expect(withHouseFromText('malyn.vokzal', 'вокзал 5')).toBe('malyn.vokzal');
    const local = parse('городищенская 20 вокзал');
    const ai: TripIntent = { intent: 'trip', from: { id: 'street.horodyshchanska', text: 'городищенская 20' }, to: { id: 'malyn.vokzal', text: 'вокзал' }, when: { day: 'today', kind: 'depart' }, modes: [], unknown: [], confidence: 'high' };
    expect(pickIntent(local, ai).from?.id).toBe('street.horodyshchanska:20');
  });

  it('усі id вулиць унікальні; у бекенд-копії ті самі id', async () => {
    expect(new Set(STREETS.map((s) => s.id)).size).toBe(STREETS.length);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const back = fs.readFileSync(path.resolve(__dirname, '../../../../../backend/src/dovede/streets.ts'), 'utf8');
    const ids = [...back.matchAll(/"id": "(street\.[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(STREETS.map((s) => s.id));
  });
});

describe('«Доведе» — поїздка від адреси', () => {
  const calls: unknown[] = [];
  const planner: LocalPlanner = {
    plan: (from, to) => {
      calls.push([from, to]);
      return {
        journeys: [
          {
            departMins: 15 * 60,
            arriveMins: 15 * 60 + 25,
            transfers: 0,
            legs: [
              { kind: 'walk', from: { lat: 1, lng: 2 }, to: { stopId: 'st_a' }, depMins: 15 * 60, arrMins: 15 * 60 + 6, meters: 420 },
              { kind: 'transit', routeId: '5', tripId: 't', direction: 'there', variantId: null, boardStopId: 'st_a', alightStopId: 'st_0019', depMins: 15 * 60 + 6, arrMins: 15 * 60 + 25, stopIds: ['st_a', 'st_0019'], times: [] },
            ],
          },
        ],
        directWalk: null,
      } as never;
    },
    stopName: (id) => ({ st_a: 'Городищанська 1', st_0019: 'Залізничний вокзал' })[id] ?? id,
    stopCoords: () => null,
  };

  it('адреса — точка для планувальника; відповідь чесно каже, якщо точка приблизна', () => {
    const exact = parse('з Городищанської 20 до вокзалу');
    expect(classify(exact).kind).toBe('intra');
    const out = composeStories({ intent: exact, now: NOW, date: NOW.date, schedules: [], planner });
    const s = street('street.horodyshchanska');
    expect(calls[0]).toEqual([{ kind: 'point', lat: s.houses['20'][0], lng: s.houses['20'][1] }, { kind: 'stop', stopId: 'st_0019' }]);
    expect(out.kind === 'stories' && out.stories[0].legs.map((l) => l.kind)).toEqual(['walk', 'bus']);
    expect(out.kind === 'stories' && out.stories[0].endNote).toBeNull();

    const rough = composeStories({ intent: parse('з Городищанської до вокзалу'), now: NOW, date: NOW.date, schedules: [], planner });
    expect(rough.kind === 'stories' && rough.stories[0].endNote).toMatch(/Номер будинку не названо — рахую від середини вулиці/);

    const guessed = composeStories({ intent: parse('з Городищанської 21 до вокзалу'), now: NOW, date: NOW.date, schedules: [], planner });
    expect(guessed.kind === 'stories' && guessed.stories[0].endNote).toMatch(/знайшов за розташуванням біля вулиці/);
  });
});
