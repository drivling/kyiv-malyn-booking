import { describe, expect, it } from 'vitest';
import golden from '../eval/golden.json';
import { METRO_STATIONS } from './kyivMetroData';
import malynRoutes from '../eval/malyn-routes.json';
import malynStops from '../eval/malyn-stops.json';
import { buildStopPlaces } from './stopPlaces';
import { LANDMARKS } from './landmarks';
import { STREETS } from './streets';
import { parseLocal } from './parseLocal';
import { PLACES } from './gazetteer';
import type { KyivNow, TripIntent } from './types';

/** п'ятниця 13.11.2026, 14:20 за Києвом — як `defaultNow` у golden.json */
const NOW: KyivNow = { date: '2026-11-13', mins: 14 * 60 + 20 };

interface GoldenCase {
  id: string;
  text: string;
  expect: Partial<Omit<TripIntent, 'from' | 'to' | 'when'>> & {
    from?: string | null;
    to?: string | null;
    when?: Partial<TripIntent['when']>;
  };
  scope: 'mvp' | 'stops' | 'routes' | 'streets' | 'landmarks' | 'kyiv' | 'later';
}

/** Порівнюємо лише поля з expect; повертаємо [збіглося, усього, що не так] */
/** Зупинки Малина зі знімка датасету — як на сторінці після завантаження розкладу */
const STOP_INDEX = buildStopPlaces(malynStops.stops);

function grade(c: GoldenCase): [number, number, string[]] {
  const got = parseLocal(c.text, NOW, STOP_INDEX, malynRoutes.routes).intent;
  const e = c.expect;
  let ok = 0;
  let total = 0;
  const why: string[] = [];
  const check = (name: string, actual: unknown, expected: unknown) => {
    total++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) ok++;
    else why.push(`${name}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  };
  if (e.intent !== undefined) check('intent', got.intent, e.intent);
  // номер будинку в id («street.x:20») — справа браузера; еталон звіряє саму вулицю
  const bare = (id: string | undefined) => (id?.startsWith('street.') ? id.split(':')[0] : id) ?? null;
  if (e.from !== undefined) check('from', bare(got.from?.id), e.from);
  if (e.to !== undefined) check('to', bare(got.to?.id), e.to);
  for (const k of ['day', 'time', 'kind', 'part'] as const) {
    if (e.when?.[k] !== undefined) check(`when.${k}`, got.when[k], e.when[k]);
  }
  if (e.modes !== undefined) check('modes', got.modes, e.modes);
  if (e.routes !== undefined) check('routes', [...(got.routes ?? [])].sort(), [...e.routes].sort());
  if (e.avoidRoutes !== undefined) check('avoidRoutes', [...(got.avoidRoutes ?? [])].sort(), [...e.avoidRoutes].sort());
  if (e.confidence !== undefined) check('confidence', got.confidence, e.confidence);
  if (e.unknown !== undefined) check('unknown', got.unknown.length > 0, e.unknown.length > 0);
  return [ok, total, why];
}

const cases = (golden as { cases: GoldenCase[] }).cases;

describe('parseLocal на еталонах (Docs/dovede-roadmap.md)', () => {
  it('розуміє ≥ 80% слотів у питаннях зони MVP', () => {
    let ok = 0;
    let total = 0;
    const misses: string[] = [];
    for (const c of cases.filter((x) => x.scope === 'mvp')) {
      const [o, t, why] = grade(c);
      ok += o;
      total += t;
      if (why.length) misses.push(`${c.id} «${c.text}»: ${why.join('; ')}`);
    }
    const accuracy = ok / total;
    if (misses.length) console.info(`parseLocal: ${ok}/${total}\n  ${misses.join('\n  ')}`);
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it('розуміє ≥ 80% слотів у питаннях про зупинки з розкладу (без ШІ)', () => {
    let ok = 0;
    let total = 0;
    const misses: string[] = [];
    for (const c of cases.filter((x) => x.scope === 'stops')) {
      const [o, t, why] = grade(c);
      ok += o;
      total += t;
      if (why.length) misses.push(`${c.id} «${c.text}»: ${why.join('; ')}`);
    }
    if (misses.length) console.info(`parseLocal, зупинки: ${ok}/${total}\n  ${misses.join('\n  ')}`);
    expect(ok / total).toBeGreaterThanOrEqual(0.8);
  });

  it('розуміє ≥ 70% слотів у питаннях про маршрути (без ШІ; решту добирає Claude)', () => {
    let ok = 0;
    let total = 0;
    const misses: string[] = [];
    for (const c of cases.filter((x) => x.scope === 'routes')) {
      const [o, t, why] = grade(c);
      ok += o;
      total += t;
      if (why.length) misses.push(`${c.id} «${c.text}»: ${why.join('; ')}`);
    }
    expect(ok / total, misses.join(' | ')).toBeGreaterThanOrEqual(0.7);
  });

  it('розуміє ≥ 80% слотів у питаннях про вулиці, адреси й орієнтири (без ШІ)', () => {
    let ok = 0;
    let total = 0;
    const misses: string[] = [];
    for (const c of cases.filter((x) => x.scope === 'streets' || x.scope === 'landmarks')) {
      const [o, t, why] = grade(c);
      ok += o;
      total += t;
      if (why.length) misses.push(`${c.id} «${c.text}»: ${why.join('; ')}`);
    }
    expect(ok / total, misses.join(' | ')).toBeGreaterThanOrEqual(0.8);
  });

  it('метро Києва (scope kyiv): словник у браузері розуміє ті самі 40 питань, що й Claude', () => {
    const misses: string[] = [];
    for (const c of cases.filter((x) => x.scope === 'kyiv')) {
      const intent = parseLocal(c.text, NOW, STOP_INDEX).intent;
      for (const role of ['from', 'to'] as const) {
        if (c.expect[role] !== undefined && (intent[role]?.id ?? null) !== c.expect[role]) misses.push(`${c.id} «${c.text}» ${role}: ${intent[role]?.id ?? null} ≠ ${c.expect[role]}`);
      }
    }
    // «я на Майдані, як доїхати…» — «звідки» без прийменника руху: це розуміє лише Claude
    expect(misses).toEqual(['kv-40 «я на майдані, як доїхати в малин до лікарні» from: null ≠ kyiv.m.maidan']);
  });

  it('усі id у еталонах є в словнику', () => {
    const ids = new Set([...PLACES.map((p) => p.id), ...STOP_INDEX.map((e) => e.place.id), ...STREETS.map((x) => x.id), ...LANDMARKS.map((x) => x.id), ...METRO_STATIONS.map((x) => x.id)]);
    for (const c of cases) {
      for (const id of [c.expect.from, c.expect.to]) {
        if (typeof id === 'string') expect(ids.has(id), `${c.id}: ${id}`).toBe(true);
      }
    }
  });
});

describe('parseLocal — окремі правила', () => {
  it('«з Києва (Святошин) до Малина на вокзал» — уточнення без прийменника і вокзал Малина', () => {
    const r = parseLocal('Як доїхати з Києва (Святошин) до Малина на вокзал', NOW);
    expect(r.intent.from?.id).toBe('kyiv.sviatoshyn');
    expect(r.intent.to?.id).toBe('malyn.vokzal');
    expect(r.intent.confidence).toBe('high');
    expect(r.spans.map((s) => s.kind)).toEqual(['from', 'from', 'to', 'to']);
  });

  it('вокзал після Києва — київський', () => {
    expect(parseLocal('з Малинівки до Києва на вокзал', NOW).intent.to?.id).toBe('kyiv.pas');
    expect(parseLocal('з вокзалу в Києві до Малина', NOW).intent.from?.id).toBe('kyiv.pas');
  });

  it('час, що вже минув сьогодні, — завтра; «до 9» — прибуття', () => {
    const r = parseLocal('щоб бути в Малині до 9 ранку з Києва', NOW).intent;
    expect(r.when).toEqual({ day: 'tomorrow', time: '09:00', kind: 'arrive' });
    expect(parseLocal('з Києва до Малина о 7 вечора', NOW).intent.when).toEqual({ day: 'today', time: '19:00', kind: 'depart' });
  });

  it('«автобусом» між місцями Малина — міський, між містами — маршрутка', () => {
    expect(parseLocal('автобусом з Царського села на вокзал', NOW).intent.modes).toEqual(['city_bus']);
    expect(parseLocal('автобусом з Києва до Малина', NOW).intent.modes).toEqual(['marshrutka']);
  });

  it('незнайоме місце з великої літери після прийменника', () => {
    const r = parseLocal('з Ковалівки до Малина', NOW);
    expect(r.intent.unknown).toEqual(['Ковалівки']);
    expect(r.unknownRole).toBe('from');
    expect(r.intent.from).toBeNull();
  });

  it('«Малин-Київ» через дефіс — два місця', () => {
    const r = parseLocal('маршрутка Малин-Київ завтра', NOW).intent;
    expect([r.from?.id, r.to?.id]).toEqual(['city.Malyn', 'city.Kyiv']);
  });
});
