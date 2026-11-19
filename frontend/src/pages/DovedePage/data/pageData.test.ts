/**
 * Дані сторінки з адмінки (крок 11 плану адмінки): метро-замінник і години / тариф метро міняються без деплою —
 * `applyMetroData` бере лише зрозуміле, `null` вимикає замінник, решта лишається з коду; читання — один раз.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { metroTrip } from './kyiv';
import { METRO_SERVICE, METRO_SHUTTLE_DEFAULT, applyMetroData, metroOpenAt, metroShuttle, resetMetroData } from './kyivMetroService';
import { loadPageData, pageDataReady, resetPageDataLoad } from './pageData';

afterEach(() => {
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
