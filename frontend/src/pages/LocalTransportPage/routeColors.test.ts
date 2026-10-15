import { describe, it, expect } from 'vitest';
import { SCHEME_COLOR_VARS, contrastRatio, routeColor, routeColorStyle, textColorOn } from './routeColors';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';

describe('routeColors', () => {
  it('every route on the scheme has a distinct hex colour', () => {
    const colors = SCHEME_ROUTES.map((r) => r.color);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(new Set(colors.map((c) => c.toLowerCase())).size).toBe(colors.length);
  });

  it('returns the scheme colour for a known route and null for an unknown one', () => {
    expect(routeColor('3')).toBe(SCHEME_ROUTES.find((r) => r.id === '3')!.color);
    expect(routeColor('1')).toBeNull();
    expect(routeColor('')).toBeNull();
  });

  it('builds CSS variables for the badge and leaves unknown routes to the CSS fallback', () => {
    expect(routeColorStyle('2')).toEqual({ '--lt-route-color': routeColor('2'), '--lt-route-fg': '#ffffff' });
    expect(routeColorStyle('7')).toEqual({ '--lt-route-color': routeColor('7'), '--lt-route-fg': '#000000' });
    expect(routeColorStyle('1')).toBeUndefined();
  });

  it('every route number reads on its line colour: WCAG AA 4.5:1, same rule as the scheme generator', () => {
    for (const r of SCHEME_ROUTES) {
      expect(r.fg, `№${r.id}`).toBe(textColorOn(r.color));
      expect(contrastRatio(r.fg, r.color), `№${r.id} ${r.fg} на ${r.color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives the scheme SVG both the line colour and the number colour', () => {
    const vars = SCHEME_COLOR_VARS as Record<string, string>;
    expect(vars['--lts-r9']).toBe('#E3368C');
    expect(vars['--lts-r9-fg']).toBe('#000000');
    expect(vars['--lts-r8-fg']).toBe('#ffffff');
  });

  it('computes WCAG contrast and picks white or black text, whichever reads better', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#F08A1C', '#ffffff')).toBeCloseTo(2.51, 2); // №7 з білими цифрами — було
    expect(contrastRatio('#E3368C', '#ffffff')).toBeCloseTo(4.06, 2); // №9: білий не проходить…
    expect(contrastRatio('#E3368C', '#000000')).toBeCloseTo(5.17, 2); // …чорний проходить
    expect(textColorOn('#1b1f2a')).toBe('#ffffff');
    expect(textColorOn('#C99700')).toBe('#000000');
    expect(textColorOn('not a colour')).toBe('#ffffff');
  });
});
