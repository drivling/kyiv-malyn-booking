import { describe, expect, it } from 'vitest';
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
});
