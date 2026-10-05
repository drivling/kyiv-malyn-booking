import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/utils';
import { LocalTransportSchemeMini } from './LocalTransportSchemeMini';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';

describe('LocalTransportSchemeMini', () => {
  it('dims every line but the given ones and links the whole scheme to the scheme page', () => {
    const { container } = renderWithProviders(
      <LocalTransportSchemeMini
        routeIds={['3']}
        href="/transport/scheme?route=3&d=16.09.26"
        label="Відкрити схему маршрутів: маршрут №3"
      />
    );
    expect(screen.getByRole('heading', { level: 2, name: 'На схемі міста' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Відкрити схему маршрутів: маршрут №3' });
    expect(link).toHaveAttribute('href', '/transport/scheme?route=3&d=16.09.26');
    expect(link.querySelector('svg.lts-svg')).not.toBeNull();

    for (const r of SCHEME_ROUTES) {
      const g = container.querySelector(`.lts-route[data-route="${r.id}"]`);
      expect(g, r.id).not.toBeNull();
      if (r.id === '3') expect(g).not.toHaveClass('lts-route--dim');
      else expect(g).toHaveClass('lts-route--dim');
    }
    expect(container.querySelector('.lts-badge[data-route="3"]')).not.toHaveClass('lts-badge--dim');
    expect(container.querySelector('.lts-badge[data-route="2"]')).toHaveClass('lts-badge--dim');
    expect(container.querySelector('.lts-stop--here')).toBeNull();
    // Без інтерактивних ролей усередині посилання; текст SVG схований від читалок
    expect(container.querySelector('[role="button"], [tabindex]')).toBeNull();
    expect(container.querySelector('.lts-mini-svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the stop with «ви тут», lights the lines through it and shows the note', () => {
    const { container } = renderWithProviders(
      <LocalTransportSchemeMini
        routeIds={['3', '5']}
        stopIds={['st_0019']}
        href="/transport/scheme?stop=st_0019"
        label="Відкрити схему маршрутів: зупинка «Залізничний вокзал»"
        note="Ваша зупинка позначена на схемі, підсвічено її лінії: №3, №5."
      />
    );
    expect(container.querySelector('.lts-stop[data-stop="st_0019"]')).toHaveClass('lts-stop--here');
    expect(container.querySelector('.lts-stop[data-stop="st_0070"]')).not.toHaveClass('lts-stop--here');
    expect(container.querySelector('.lts-route[data-route="5"]')).not.toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-route[data-route="7"]')).toHaveClass('lts-route--dim');
    expect(screen.getByText('Ваша зупинка позначена на схемі, підсвічено її лінії: №3, №5.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити схему маршрутів: зупинка «Залізничний вокзал»' })).toHaveAttribute(
      'href',
      '/transport/scheme?stop=st_0019'
    );
  });

  it('re-applies the highlight when the lines change', () => {
    const { container, rerender } = renderWithProviders(
      <LocalTransportSchemeMini routeIds={['2']} href="/transport/scheme?route=2" label="Схема №2" />
    );
    expect(container.querySelector('.lts-route[data-route="2"]')).not.toHaveClass('lts-route--dim');
    rerender(<LocalTransportSchemeMini routeIds={['9']} href="/transport/scheme?route=9" label="Схема №9" />);
    expect(container.querySelector('.lts-route[data-route="2"]')).toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-route[data-route="9"]')).not.toHaveClass('lts-route--dim');
  });
});
