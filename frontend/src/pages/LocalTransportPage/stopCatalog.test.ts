import { describe, it, expect } from 'vitest';
import {
  buildSortedStopIds,
  displayNameForStopKey,
  getStopKey,
  invertNameToId,
  resolveStopIdFromParam,
  resolveStopIdInList,
} from './stopCatalog';

describe('stopCatalog', () => {
  const catalog = {
    st_a: { name: 'Базар' },
    st_b: { name: 'Вокзал' },
  };

  it('getStopKey prefers id', () => {
    expect(getStopKey({ id: 'st_a', name: 'Базар' })).toBe('st_a');
    expect(getStopKey({ name: 'Базар' })).toBe('Базар');
  });

  it('displayNameForStopKey and invertNameToId', () => {
    expect(displayNameForStopKey('st_a', catalog)).toBe('Базар');
    expect(displayNameForStopKey('unknown', catalog)).toBe('unknown');
    expect(invertNameToId(catalog).get('Вокзал')).toBe('st_b');
  });

  it('resolveStopIdFromParam only exact catalog keys', () => {
    expect(resolveStopIdFromParam('st_a', catalog)).toBe('st_a');
    expect(resolveStopIdFromParam('Базар', catalog)).toBeNull();
    expect(resolveStopIdFromParam('st_missing', catalog)).toBeNull();
  });

  it('resolveStopIdInList', () => {
    expect(resolveStopIdInList('st_b', ['st_a', 'st_b'], catalog)).toBe('st_b');
    expect(resolveStopIdInList('st_x', ['st_a', 'st_b'], catalog)).toBe('');
  });

  it('buildSortedStopIds sorts by Ukrainian display names', () => {
    const ids = buildSortedStopIds(
      [{ from: 'Базар', to: 'Вокзал' }],
      undefined,
      catalog
    );
    expect(ids).toContain('st_a');
    expect(ids).toContain('st_b');
    expect(ids.indexOf('st_a')).toBeLessThan(ids.indexOf('st_b'));
  });
});
