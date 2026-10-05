import { describe, it, expect } from 'vitest';
import { routeColor, routeColorStyle } from './routeColors';
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
    expect(routeColorStyle('1')).toBeUndefined();
  });
});
