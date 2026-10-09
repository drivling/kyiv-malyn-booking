import { afterEach, describe, expect, it } from 'vitest';
import { isPrerendering } from './prerender';

describe('isPrerendering', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__MALIN_PRERENDER__');
  });

  it('false у браузері, true лише під прапорцем prerender-entry', () => {
    expect(isPrerendering()).toBe(false);
    (window as Window & { __MALIN_PRERENDER__?: boolean }).__MALIN_PRERENDER__ = true;
    expect(isPrerendering()).toBe(true);
  });
});
