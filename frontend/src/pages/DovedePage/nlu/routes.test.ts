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
    expect(out).toMatchObject({ kind: 'route_info', routeId: '5', no: '5', fromName: 'Лікарня', toName: 'Залізничний вокзал', atStopId: null });
    if (out.kind !== 'route_info') return;
    expect(out.boards).toEqual([
      { fromStopId: 'st_a', towardStopId: 'st_z', next: [14 * 60 + 30, 15 * 60, 19 * 60], first: 6 * 60, last: 19 * 60 },
      { fromStopId: 'st_z', towardStopId: 'st_a', next: [20 * 60], first: 6 * 60 + 30, last: 20 * 60 },
    ]);
  });

  it('напрямок, де сьогодні рейсів уже немає, не показуємо, поки є інші; якщо немає жодного — показуємо всі', () => {
    const evening = composeStories({ intent: parse('куди їде автобус №5'), now: { ...NOW, mins: 19 * 60 + 30 }, date: NOW.date, schedules: [], planner, routes: ROUTES });
    expect(evening.kind === 'route_info' && evening.boards.map((b) => b.towardStopId)).toEqual(['st_a']);
    const night = composeStories({ intent: parse('куди їде автобус №5'), now: { ...NOW, mins: 23 * 60 }, date: NOW.date, schedules: [], planner, routes: ROUTES });
    expect(night.kind === 'route_info' && night.boards.map((b) => [b.towardStopId, b.next.length])).toEqual([['st_z', 0], ['st_a', 0]]);
  });

  it('маршрут не ходить через названу зупинку — картка без рейсів, а не вигадані', () => {
    const out = ask('коли 5-ка з Царського села');
    expect(out).toMatchObject({ kind: 'route_info', routeId: '5', atStopId: 'st_0090', atStopLabel: 'Малин · Царське село', boards: [] });
  });

  it('номер для показу береться зі списку маршрутів: id 11 → «11/1»', () => {
    expect(ask('маршрут 11/1')).toMatchObject({ kind: 'route_info', routeId: '11', no: '11/1' });
  });
});
