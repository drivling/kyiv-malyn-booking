import { describe, expect, it } from 'vitest';
import { sanitizeStopRedirects, stopRedirectTarget } from './stopRedirects';

const LIVE = ['st_0001', 'st_0002'];
const meta = { stopRedirects: { st_0042: 'st_0001', st_0043: 'st_0042', st_0001: 'st_0002', st_0050: 'st_0099', st_0051: 'st_0052', st_0052: 'st_0051' } };

describe('stopRedirectTarget', () => {
  it('follows old → live and squashes chains', () => {
    expect(stopRedirectTarget(meta, 'st_0042', LIVE)).toBe('st_0001');
    expect(stopRedirectTarget(meta, 'st_0043', LIVE)).toBe('st_0001');
  });

  it('ignores live stops, unknown targets, cycles, junk and a missing map', () => {
    expect(stopRedirectTarget(meta, 'st_0001', LIVE)).toBeNull();
    expect(stopRedirectTarget(meta, 'st_0050', LIVE)).toBeNull();
    expect(stopRedirectTarget(meta, 'st_0051', LIVE)).toBeNull();
    expect(stopRedirectTarget(meta, 'bogus', LIVE)).toBeNull();
    expect(stopRedirectTarget({}, 'st_0042', LIVE)).toBeNull();
    expect(stopRedirectTarget({ stopRedirects: ['st_0042'] }, 'st_0042', LIVE)).toBeNull();
    expect(stopRedirectTarget(undefined, 'st_0042', LIVE)).toBeNull();
  });

  it('sanitizeStopRedirects keeps only valid pairs', () => {
    expect(sanitizeStopRedirects(meta, LIVE)).toEqual({ st_0042: 'st_0001', st_0043: 'st_0001' });
    expect(sanitizeStopRedirects({ defaultSec: 120 }, LIVE)).toEqual({});
  });
});
