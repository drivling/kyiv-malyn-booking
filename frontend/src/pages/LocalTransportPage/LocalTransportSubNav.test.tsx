import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, within } from '@/test/utils';
import { LocalTransportSubNav } from './LocalTransportSubNav';

describe('LocalTransportSubNav', () => {
  it('marks routes mode active on /transport', () => {
    renderWithProviders(<LocalTransportSubNav searchDate="2026-08-12" searchTime="08:00" />, {
      initialEntries: ['/transport'],
    });
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    const routesLink = within(nav).getByRole('link', { name: 'Маршрути (З → До)' });
    expect(routesLink).toHaveAttribute('aria-current', 'page');
    expect(routesLink.getAttribute('href')).toContain('d=2026-08-12');
    expect(routesLink.getAttribute('href')).toMatch(/h=08(%3A|:)00/);
  });

  it('marks stop board active on /transport/stop', () => {
    renderWithProviders(<LocalTransportSubNav searchDate="" searchTime="" />, {
      initialEntries: ['/transport/stop'],
    });
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    expect(within(nav).getByRole('link', { name: 'Зупинка (табло)' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
