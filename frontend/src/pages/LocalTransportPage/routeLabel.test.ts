import { describe, expect, it } from 'vitest';
import { configureRouteNames } from '@/utils/routeNames';
import { hasNamedLine, routeLine, routeTitle } from './routeLabel';

describe('routeLabel (rule D1: no "? — ?")', () => {
  it('formats a named line and its reverse', () => {
    const r = { id: '5', from: 'Лікарня', to: 'Залізничний вокзал' };
    expect(routeLine(r)).toBe('Лікарня — Залізничний вокзал');
    expect(routeLine(r, true)).toBe('Залізничний вокзал — Лікарня');
    expect(routeTitle(r)).toBe('№5 Лікарня — Залізничний вокзал');
    expect(hasNamedLine(r)).toBe(true);
  });

  it('falls back to the number alone when a terminus is missing or blank', () => {
    expect(routeTitle({ id: '1' })).toBe('№1');
    expect(routeTitle({ id: '10', from: ' ', to: 'Вокзал' })).toBe('№10');
    expect(routeLine({ id: '1', from: null, to: undefined })).toBe('');
    expect(hasNamedLine({ id: '1', from: 'A' })).toBe(false);
  });

  it('the title shows the display number, not the id', () => {
    configureRouteNames([{ id: '11', shortName: '11/1' }]);
    try {
      expect(routeTitle({ id: '11', from: 'Паперова фабрика', to: 'Залізничний вокзал' })).toBe(
        '№11/1 Паперова фабрика — Залізничний вокзал'
      );
      expect(routeTitle({ id: '11' })).toBe('№11/1');
    } finally {
      configureRouteNames([]);
    }
  });
});
