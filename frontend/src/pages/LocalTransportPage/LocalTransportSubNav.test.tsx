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

  it('board link carries the chosen «З» stop and d/h from the planner', () => {
    renderWithProviders(
      <LocalTransportSubNav searchDate="16.09.26" searchTime="09:12" fromStopId="st_a" />,
      { initialEntries: ['/transport/st_a/st_b?d=16.09.26&h=09%3A12'] }
    );
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    const board = within(nav).getByRole('link', { name: 'Зупинка (табло)' });
    expect(board.getAttribute('href')).toMatch(/^\/transport\/stop\/st_a\?d=16\.09\.26&h=09(%3A|:)12$/);
    // Активний таб «Маршрути» не додає from= — інакше клік по ньому скинув би «До».
    const routes = within(nav).getByRole('link', { name: 'Маршрути (З → До)' });
    expect(routes.getAttribute('href')).not.toContain('from=');
  });

  it('routes link carries ?from= when leaving the stop board', () => {
    renderWithProviders(<LocalTransportSubNav searchDate="16.09.26" searchTime="09:12" fromStopId="st_a" />, {
      initialEntries: ['/transport/stop/st_a'],
    });
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    const routes = within(nav).getByRole('link', { name: 'Маршрути (З → До)' });
    expect(routes.getAttribute('href')).toContain('from=st_a');
    expect(routes.getAttribute('href')).toContain('d=16.09.26');
  });

  it('without a stop the links stay plain', () => {
    renderWithProviders(<LocalTransportSubNav searchDate="" searchTime="" />, {
      initialEntries: ['/transport'],
    });
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    expect(within(nav).getByRole('link', { name: 'Зупинка (табло)' })).toHaveAttribute('href', '/transport/stop');
    expect(within(nav).getByRole('link', { name: 'Маршрути (З → До)' })).toHaveAttribute('href', '/transport');
  });
});
