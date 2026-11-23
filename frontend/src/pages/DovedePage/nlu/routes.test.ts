import { describe, expect, it } from 'vitest';
import { classify, composeStories } from '../compose/composeStories';
import type { LocalPlanner } from '../compose/types';
import { parseLocal } from './parseLocal';
import { setStopPlaces } from './places';
import { findRouteMentions, type RouteLike } from './routes';
import { buildStopPlaces } from './stopPlaces';
import malynStops from '../eval/malyn-stops.json';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };
/** Маршрути Малина, які показує сайт (2026-11-13) */
const ROUTES: RouteLike[] = [
  { id: '10', no: '10', fromName: 'Поліклініка', toName: 'Залізничний вокзал' },
  { id: '11', no: '11/1', fromName: 'Паперова фабрика', toName: 'Залізничний вокзал' },
  { id: '5', no: '5', fromName: 'Лікарня', toName: 'Залізничний вокзал' },
  { id: '7', no: '7', fromName: 'Лікарня', toName: 'Залізничний вокзал' },
  { id: '9', no: '9', fromName: 'Базарна площа (ТЦ «Промінь»)', toName: 'вул. Олекси Тихого' },
];
const STOPS = buildStopPlaces(malynStops.stops);
setStopPlaces(STOPS);
const ids = (text: string) => findRouteMentions(text, ROUTES).map((m) => m.routeId);
const parse = (text: string) => parseLocal(text, NOW, STOPS, ROUTES).intent;

describe('«Доведе» — маршрути міських автобусів у питанні', () => {
  it('знаходить номер у різних формах; у намір іде id маршруту, а не номер з борту', () => {
    expect(ids('куди їде автобус №5')).toEqual(['5']);
    expect(ids('автобус 5 куди їде')).toEqual(['5']);
    expect(ids('коли 9-ка з Царського села')).toEqual(['9']);
    expect(ids('сімкою до вокзалу')).toEqual(['7']);
    expect(ids("дев'яткою чи п'ятіркою")).toEqual(['9', '5']);
    expect(ids('маршрут 11/1')).toEqual(['11']);
    expect(ids('номер 10 до поліклініки')).toEqual(['10']);
    expect(ids('маршрутка 7 від лікарні')).toEqual(['7']);
  });

  it('число без ознаки маршруту — час, а не маршрут; маршруту з таким номером немає — не маршрут', () => {
    expect(ids('з центру на вокзал о 5')).toEqual([]);
    expect(ids('до 9 ранку')).toEqual([]);
    expect(ids('о 15:00')).toEqual([]);
    expect(ids('автобус №4')).toEqual([]);
    expect(ids('Чорновола 10')).toEqual([]);
  });

  it('«№N» після назви закладу — номер закладу, а не маршрут; «маршрут №5», «автобус №5» — маршрут', () => {
    expect(ids('до Дитячого садка №5')).toEqual([]);
    expect(ids('від ЗОШ №7')).toEqual([]);
    expect(ids('до гімназії №7')).toEqual([]);
    expect(ids('Нова пошта №10')).toEqual([]);
    expect(ids('школа номер 5')).toEqual([]);
    expect(ids('до школи №9 автобусом №5')).toEqual(['5']);
    expect(ids('від лікарні №5')).toEqual([]);
    // слово перед номером не заклад — як і було, маршрут
    expect(ids('від лікарні №5 до вокзалу №7')).toEqual(['7']);
    expect(ids('з центру №5')).toEqual(['5']);
  });

  it('«куди їде автобус №5» — питання про маршрут, упевнено й без Claude', () => {
    const i = parse('куди їде автобус №5');
    expect(i).toMatchObject({ intent: 'route', routes: ['5'], from: null, to: null, modes: ['city_bus'], confidence: 'high' });
  });

  it('номер маршруту не стає часом, а «маршрутка 7» — маршруткою на Київ', () => {
    const i = parse('коли 9-ка з Царського села після 17');
    expect(i).toMatchObject({ intent: 'route', routes: ['9'], from: { id: 'malyn.tsarske' }, when: { time: '17:00' } });
    expect(parse('маршрутка 7 від лікарні до вокзалу').modes).toEqual(['city_bus']);
  });

  it('маршрут + «звідки — куди» — звичайна поїздка цим маршрутом', () => {
    const i = parse('сімкою від лікарні до вокзалу');
    expect(i).toMatchObject({ intent: 'trip', routes: ['7'], from: { id: 'malyn.likarnia' }, to: { id: 'malyn.vokzal' } });
    expect(classify(i).kind).toBe('intra');
  });

  it('без списку маршрутів розбір такий самий, як раніше', () => {
    expect(parseLocal('куди їде автобус №5', NOW).intent.routes).toBeUndefined();
  });
});

describe('«Доведе» — відповідь про маршрут', () => {
  const planner: LocalPlanner = {
    plan: () => ({ journeys: [], directWalk: null }) as never,
    stopName: (id) => ({ st_a: 'Лікарня', st_z: 'Залізничний вокзал', st_0090: 'Царське село' })[id] ?? id,
    stopCoords: () => null,
    routeDepartures: (routeId, stopId) => {
      if (routeId !== '5') return [];
      if (stopId === 'st_0090') return [];
      return [
        { fromStopId: 'st_a', towardStopId: 'st_z', mins: [6 * 60, 14 * 60, 14 * 60 + 30, 15 * 60, 19 * 60] },
        { fromStopId: 'st_z', towardStopId: 'st_a', mins: [6 * 60 + 30, 20 * 60] },
      ];
    },
  };
  const ask = (text: string) => composeStories({ intent: parse(text), now: NOW, date: NOW.date, schedules: [], planner, routes: ROUTES });

  it('«куди їде №5»: кінцеві й найближчі відправлення з обох кінцевих, минулі рейси не показуємо', () => {
    const out = ask('куди їде автобус №5');
    expect(out).toMatchObject({ kind: 'route_info', atStopId: null, items: [{ routeId: '5', no: '5', fromName: 'Лікарня', toName: 'Залізничний вокзал' }] });
    if (out.kind !== 'route_info') return;
    expect(out.items[0].boards).toEqual([
      { fromStopId: 'st_a', towardStopId: 'st_z', next: [14 * 60 + 30, 15 * 60, 19 * 60], first: 6 * 60, last: 19 * 60 },
      { fromStopId: 'st_z', towardStopId: 'st_a', next: [20 * 60], first: 6 * 60 + 30, last: 20 * 60 },
    ]);
  });

  it('напрямок, де сьогодні рейсів уже немає, не показуємо, поки є інші; якщо немає жодного — показуємо всі', () => {
    const evening = composeStories({ intent: parse('куди їде автобус №5'), now: { ...NOW, mins: 19 * 60 + 30 }, date: NOW.date, schedules: [], planner, routes: ROUTES });
    expect(evening.kind === 'route_info' && evening.items[0].boards.map((b) => b.towardStopId)).toEqual(['st_a']);
    const night = composeStories({ intent: parse('куди їде автобус №5'), now: { ...NOW, mins: 23 * 60 }, date: NOW.date, schedules: [], planner, routes: ROUTES });
    expect(night.kind === 'route_info' && night.items[0].boards.map((b) => [b.towardStopId, b.next.length])).toEqual([['st_z', 0], ['st_a', 0]]);
  });

  it('маршрут не ходить через названу зупинку — картка без рейсів, а не вигадані', () => {
    const out = ask('коли 5-ка з Царського села');
    expect(out).toMatchObject({ kind: 'route_info', atStopId: 'st_0090', atStopLabel: 'Малин · Царське село', items: [{ routeId: '5', boards: [] }] });
  });

  it('кілька маршрутів — одна відповідь з розділом на кожен; першим той, що їде раніше', () => {
    const two: LocalPlanner = {
      ...planner,
      routeDepartures: (routeId) =>
        routeId === '5'
          ? [{ fromStopId: 'st_a', towardStopId: 'st_z', mins: [15 * 60] }]
          : routeId === '7'
            ? [{ fromStopId: 'st_a', towardStopId: 'st_q', mins: [14 * 60 + 25] }]
            : [],
    };
    const i = parse('коли їдуть 5-ка і сімка');
    expect(i).toMatchObject({ intent: 'route', routes: ['5', '7'] });
    const out = composeStories({ intent: i, now: NOW, date: NOW.date, schedules: [], planner: two, routes: ROUTES });
    expect(out.kind === 'route_info' && out.items.map((x) => [x.routeId, x.boards[0].next[0]])).toEqual([
      ['7', 14 * 60 + 25],
      ['5', 15 * 60],
    ]);
  });

  it('номер для показу береться зі списку маршрутів: id 11 → «11/1»', () => {
    expect(ask('маршрут 11/1')).toMatchObject({ kind: 'route_info', items: [{ routeId: '11', no: '11/1' }] });
  });
});

describe('«Доведе» — «крім сімки»', () => {
  it('маршрут після «крім / без / тільки не» — той, якого уникати; заперечення тягнеться через «і»', () => {
    expect(parse('від лікарні до вокзалу крім сімки')).toMatchObject({ intent: 'trip', avoidRoutes: ['7'], from: { id: 'malyn.likarnia' }, to: { id: 'malyn.vokzal' } });
    expect(parse('від лікарні до вокзалу крім сімки').routes).toBeUndefined();
    expect(parse('з лікарні на вокзал тільки не автобусом №5').avoidRoutes).toEqual(['5']);
    expect(parse('від лікарні до вокзалу без 5-ки і 7-ки').avoidRoutes).toEqual(['5', '7']);
    expect(parse('кроме девятки, от больницы до вокзала').avoidRoutes).toEqual(['9']);
    // названий і водночас заборонений — заборона сильніша
    expect(parse('від лікарні до вокзалу сімкою, крім сімки')).toMatchObject({ avoidRoutes: ['7'] });
    // «не» далеко від номера — не заперечення
    expect(parse('не знаю, сімкою від лікарні до вокзалу')).toMatchObject({ routes: ['7'] });
  });

  it('сам по собі «крім сімки» не робить питання питанням про маршрут', () => {
    const i = parse('до вокзалу крім сімки');
    expect(i.intent).toBe('trip');
    expect(classify(i).kind).toBe('ask_from');
  });

  const leg = (routeId: string, dep: number) => ({ kind: 'transit', routeId, tripId: `t${routeId}${dep}`, direction: 'there', variantId: null, boardStopId: 'st_a', alightStopId: 'st_0019', depMins: dep, arrMins: dep + 10, stopIds: ['st_a', 'st_0019'], times: [] });
  const journey = (routeId: string, dep: number) => ({ departMins: dep, arriveMins: dep + 10, transfers: 0, legs: [leg(routeId, dep)] });
  const plannerWith = (journeys: unknown[]): LocalPlanner =>
    ({ plan: () => ({ journeys, directWalk: null }), stopName: (id: string) => id, stopCoords: () => null }) as unknown as LocalPlanner;

  it('поїздки без названого автобуса; якщо без нього ніяк — показує з ним і каже про це', () => {
    const i = parse('від лікарні до вокзалу крім сімки');
    const mixed = composeStories({ intent: i, now: NOW, date: NOW.date, schedules: [], planner: plannerWith([journey('7', 14 * 60 + 30), journey('5', 14 * 60 + 40), journey('7', 15 * 60)]), routes: ROUTES });
    expect(mixed.kind === 'stories' && mixed.stories.map((s) => s.leaveMins)).toEqual([14 * 60 + 40]);
    expect(mixed.kind === 'stories' && mixed.notice).toBeNull();
    const only7 = composeStories({ intent: i, now: NOW, date: NOW.date, schedules: [], planner: plannerWith([journey('7', 14 * 60 + 30)]), routes: ROUTES });
    expect(only7.kind === 'stories' && only7.stories.length).toBe(1);
    expect(only7.kind === 'stories' && only7.notice).toBe('Без автобуса №7 туди не доїхати — показую варіанти з ним.');
  });
});
