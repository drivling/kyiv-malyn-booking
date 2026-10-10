/**
 * page_view на кожну зміну маршруту; службова заміна адреси зі станом gaSkip (зняли utm-мітку QR)
 * на тій самій сторінці — не новий перегляд, а повернення на неї «назад» — звичайний перегляд.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { GoogleAnalyticsTracker } from './GoogleAnalyticsTracker';

let nav: NavigateFunction;
function NavProbe() {
  nav = useNavigate();
  return null;
}

const pageViews = (gtag: ReturnType<typeof vi.fn>) =>
  gtag.mock.calls.filter((c) => c[1] === 'page_view').map((c) => (c[2] as { page_path: string }).page_path);

afterEach(() => {
  Reflect.deleteProperty(window, 'gtag');
});

describe('GoogleAnalyticsTracker', () => {
  it('skips the gaSkip replace on the same page, counts the page again after «back»', () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    render(
      <MemoryRouter initialEntries={['/transport/stop/st_a?utm_source=sticker&utm_campaign=st_a-a']}>
        <GoogleAnalyticsTracker />
        <NavProbe />
      </MemoryRouter>
    );
    expect(pageViews(gtag)).toEqual(['/transport/stop/st_a?utm_source=sticker&utm_campaign=st_a-a']);
    act(() => nav('/transport/stop/st_a', { replace: true, state: { gaSkip: true } }));
    expect(pageViews(gtag)).toHaveLength(1);
    act(() => nav('/transport/route/2'));
    act(() => nav(-1));
    expect(pageViews(gtag)).toEqual([
      '/transport/stop/st_a?utm_source=sticker&utm_campaign=st_a-a',
      '/transport/route/2',
      '/transport/stop/st_a',
    ]);
  });
});
