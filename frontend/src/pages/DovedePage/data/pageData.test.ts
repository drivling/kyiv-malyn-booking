/**
 * Дані сторінки з адмінки (крок 11 плану адмінки): метро-замінник і години / тариф метро міняються без деплою —
 * `applyMetroData` бере лише зрозуміле, `null` вимикає замінник, решта лишається з коду; читання — один раз.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { metroTrip } from './kyiv';
import { METRO_SERVICE, METRO_SHUTTLE_DEFAULT, applyMetroData, metroOpenAt, metroShuttle, resetMetroData } from './kyivMetroService';
import { applyPageData, loadPageData, pageDataReady, resetPageDataLoad } from './pageData';
import { RING_TRAINS, resetRingData, ringTrainRuns, ringTrainWindow } from './kyivRing';
import { EXAMPLES_DEFAULT, KOROSTEN_EXAMPLES_DEFAULT, pageExamples, resetExamplesData } from './examples';

afterEach(() => {
  resetExamplesData();
  resetRingData();
  resetMetroData();
  resetPageDataLoad();
});

describe('дані метро з адмінки', () => {
  it('типово — автобус №318 замість метро за «Видубичами»', () => {
    expect(metroShuttle()).toBe(METRO_SHUTTLE_DEFAULT);
    const trip = metroTrip('kyiv.m.vydubychi', 'kyiv.m.pozniaky')!;
    expect(trip.segments.some((s) => s.bus === '318')).toBe(true);
  });

  it('null — метро знову їздить усюди; інший автобус і дільниця — з адмінки', () => {
    applyMetroData({ 'metro.shuttle': null });
    expect(metroShuttle()).toBeNull();
    expect(metroTrip('kyiv.m.vydubychi', 'kyiv.m.pozniaky')!.segments.every((s) => !s.bus)).toBe(true);

    applyMetroData({ 'metro.shuttle': { line: 'M3', after: 'kyiv.m.vydubychi', stations: ['kyiv.m.slavutych'], bus: '999', hopSeconds: 240, waitSeconds: 600 } });
    const trip = metroTrip('kyiv.m.vydubychi', 'kyiv.m.pozniaky')!;
    expect(trip.segments.map((s) => s.bus)).toEqual(['999', null]);
  });

  it('години й тариф; незрозуміле пропускаємо — лишається з коду', () => {
    applyMetroData({ 'metro.service': { openMins: 6 * 60, closeMins: 22 * 60, fareUah: 35 } });
    expect([METRO_SERVICE.openMins, METRO_SERVICE.closeMins, METRO_SERVICE.fareUah]).toEqual([360, 1320, 35]);
    expect(metroOpenAt(5 * 60 + 45)).toBe(false);
    expect(metroTrip('kyiv.akadem', 'kyiv.pas')!.priceUah).toBe(35);

    applyMetroData({ 'metro.service': { openMins: 600, closeMins: 500, fareUah: 1 }, 'metro.shuttle': { line: 'M3' } });
    expect(METRO_SERVICE.fareUah).toBe(35);
    expect(metroShuttle()).toBe(METRO_SHUTTLE_DEFAULT);
    resetMetroData();
    expect(METRO_SERVICE.fareUah).toBe(30);
  });

  it('читаємо один раз на сторінку; збій — типові з коду; відповідь чекає не довше заданого', async () => {
    const fetch = vi.fn(async () => ({ 'metro.shuttle': null }));
    await loadPageData(fetch);
    await loadPageData(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(metroShuttle()).toBeNull();

    resetMetroData();
    resetPageDataLoad();
    await loadPageData(async () => {
      throw new Error('мережа');
    });
    expect(metroShuttle()).toBe(METRO_SHUTTLE_DEFAULT);

    resetPageDataLoad();
    void loadPageData(() => new Promise(() => undefined));
    const t0 = Date.now();
    await pageDataReady(30);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('додаткові рейси міської електрички з адмінки', () => {
  const extra = RING_TRAINS.find((t) => t.extra)!;
  const regular = RING_TRAINS.find((t) => !t.extra)!;
  const dep = 18 * 60;

  it('типово — дні з розкладу (17–20 листопада, першого дня з 12:00)', () => {
    expect(ringTrainWindow(extra)).toEqual({ from: '2026-11-17', fromMins: 720, to: '2026-11-20' });
    expect(ringTrainRuns(extra, '2026-11-18', dep)).toBe(true);
    expect(ringTrainRuns(extra, '2026-11-24', dep)).toBe(false);
  });

  it('продовжили — їдуть і далі; скасували (null) — не їдуть; звичайні рейси не чіпаємо', () => {
    applyPageData({ 'ring.extra': { from: '2026-11-17', fromTime: '12:00', to: '2026-11-30' } });
    expect(ringTrainRuns(extra, '2026-11-24', dep)).toBe(true);
    expect(ringTrainRuns(extra, '2026-11-17', 11 * 60)).toBe(false);
    expect(ringTrainWindow(extra)?.to).toBe('2026-11-30');

    applyPageData({ 'ring.extra': null });
    expect(ringTrainRuns(extra, '2026-11-18', dep)).toBe(false);
    expect(ringTrainWindow(regular)).toEqual({ from: regular.from, fromMins: regular.fromMins, to: regular.to });
    expect(ringTrainRuns(regular, '2026-11-18', 9 * 60)).toBe(true);

    // незрозуміле — без змін
    applyPageData({ 'ring.extra': { from: '2026-11-30', to: '2026-11-01' } });
    expect(ringTrainRuns(extra, '2026-11-18', dep)).toBe(false);
    resetRingData();
    expect(ringTrainRuns(extra, '2026-11-18', dep)).toBe(true);
  });
});
describe('приклади питань з адмінки', () => {
  it('типові з коду; змінено один список — інший лишається; порожнє й закоротке — пропускаємо', () => {
    expect(pageExamples()).toBe(EXAMPLES_DEFAULT);
    expect(pageExamples(true)).toBe(KOROSTEN_EXAMPLES_DEFAULT);
    applyPageData({ examples: { korosten: ['  З   Пашин на вокзал ', 'ок', 7] } });
    expect(pageExamples(true)).toEqual(['З Пашин на вокзал']);
    expect(pageExamples()).toBe(EXAMPLES_DEFAULT);
    applyPageData({ examples: { malyn: [] } });
    expect(pageExamples()).toBe(EXAMPLES_DEFAULT);
    applyPageData({ examples: { malyn: Array.from({ length: 12 }, (_, i) => `питання ${i}`) } });
    expect(pageExamples()).toHaveLength(10);
  });
});
