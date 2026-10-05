import { describe, it, expect } from 'vitest';
import { MINI_SVG, buildSchemeUrl, cropViewBox, isSchemeStop } from './schemeMini';

describe('schemeMini helpers', () => {
  it('strips interactive roles and tabindex from the SVG groups, keeping data-route/data-stop', () => {
    expect(MINI_SVG).not.toMatch(/role="(button|link)"/);
    expect(MINI_SVG).not.toMatch(/tabindex=/);
    expect(MINI_SVG).toContain('data-route="3"');
    expect(MINI_SVG).toContain('data-stop="st_0019"');
  });

  it('knows which stops are drawn on the scheme', () => {
    expect(isSchemeStop('st_0019')).toBe(true); // Залізничний вокзал (вузол)
    expect(isSchemeStop('st_0013')).toBe(true); // Грушевського (орієнтир)
    expect(isSchemeStop('st_a')).toBe(false);
    expect(isSchemeStop('')).toBe(false);
  });

  it('builds the scheme URL with route/stop and the search date-time', () => {
    expect(buildSchemeUrl({})).toBe('/transport/scheme');
    expect(buildSchemeUrl({ route: '3' })).toBe('/transport/scheme?route=3');
    expect(buildSchemeUrl({ stop: 'st_0019', date: '16.09.26', time: '09:12' })).toBe(
      '/transport/scheme?stop=st_0019&d=16.09.26&h=09%3A12'
    );
  });

  describe('cropViewBox', () => {
    const BASE = { x: 0, y: 176, w: 1400, h: 566 };

    it('falls back to the whole scheme without boxes', () => {
      expect(cropViewBox([])).toEqual(BASE);
    });

    it('keeps the scheme aspect ratio, pads the union and never leaves the base viewBox', () => {
      const v = cropViewBox([{ x: 500, y: 290, w: 700, h: 110 }]);
      expect(v.w / v.h).toBeCloseTo(BASE.w / BASE.h, 1);
      expect(v.x).toBeLessThanOrEqual(500 - 70);
      expect(v.x + v.w).toBeGreaterThanOrEqual(1200 + 70);
      expect(v.y).toBeGreaterThanOrEqual(BASE.y);
      expect(v.y + v.h).toBeLessThanOrEqual(BASE.y + BASE.h);
      expect(v.x).toBeGreaterThanOrEqual(BASE.x);
      expect(v.x + v.w).toBeLessThanOrEqual(BASE.x + BASE.w);
    });

    it('does not zoom closer than the minimum width on a tiny box', () => {
      const v = cropViewBox([{ x: 1180, y: 400, w: 1, h: 1 }]);
      expect(v.w).toBe(640);
      expect(v.x + v.w).toBeLessThanOrEqual(BASE.x + BASE.w);
    });

    it('a box spanning the whole scheme yields the base viewBox', () => {
      expect(cropViewBox([{ x: 0, y: 176, w: 1400, h: 566 }])).toEqual(BASE);
    });
  });
});
