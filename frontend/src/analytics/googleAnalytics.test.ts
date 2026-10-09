import { afterEach, describe, expect, it, vi } from 'vitest';
import { gaShouldTrackPath, gaTrackEvent } from './googleAnalytics';

afterEach(() => {
  Reflect.deleteProperty(window, 'gtag');
  window.history.pushState({}, '', '/');
});

describe('gaTrackEvent', () => {
  it('без gtag — тихий no-op', () => {
    expect(() => gaTrackEvent('transport_search', { from: 'st_a' })).not.toThrow();
  });

  it('надсилає подію з параметрами через gtag', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    gaTrackEvent('transport_search', { from: 'st_a', to: 'st_b', direct_routes: 2 });
    expect(gtag).toHaveBeenCalledWith('event', 'transport_search', { from: 'st_a', to: 'st_b', direct_routes: 2 });
  });

  it('параметри необов’язкові', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    gaTrackEvent('transport_swap');
    expect(gtag).toHaveBeenCalledWith('event', 'transport_swap', {});
  });

  it('в адмінці події не збираються (як і page_view)', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.history.pushState({}, '', '/admin/route-schedule');
    expect(gaShouldTrackPath(window.location.pathname)).toBe(false);
    gaTrackEvent('transport_search', { from: 'st_a' });
    expect(gtag).not.toHaveBeenCalled();
  });
});
