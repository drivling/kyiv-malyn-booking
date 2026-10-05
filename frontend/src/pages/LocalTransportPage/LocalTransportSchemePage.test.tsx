import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen, within, fireEvent } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { LocalTransportSchemePage } from './LocalTransportSchemePage';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';

const dataset = {
  stops: [{ id: 'st_0019', name: 'Залізничний вокзал', lat: 50.774, lng: 29.295 }],
  routes: [
    { id: '3', fromName: 'Лісотехнікум', toName: 'Залізничний вокзал' },
    { id: '10', fromName: '', toName: '', unreliable: true },
  ],
  routeStops: [
    { routeId: '3', stopId: 'st_0019', orderThere: 9, orderBack: 1 },
    { routeId: '10', stopId: 'st_0019', orderThere: 9, orderBack: 1 },
    { routeId: '5', stopId: 'st_0019', orderThere: 9, orderBack: 1 },
  ],
  trips: [
    { id: '3-01', routeId: '3', directionId: '1', departureTime: '06:40:00' },
    { id: '3-02', routeId: '3', directionId: '1', departureTime: '09:20:00' },
    { id: '3-03', routeId: '3', directionId: '0', departureTime: '18:30:00' },
  ],
  segments: [],
  meta: { defaultSec: 120, center: [50.768, 29.242] },
};

function renderPage(path = '/transport/scheme') {
  server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(dataset)));
  return renderWithProviders(
    <Routes>
      <Route path="/transport/scheme" element={<LocalTransportSchemePage />} />
      <Route path="/transport/stop/:stopSlug" element={<p>Табло зупинки</p>} />
    </Routes>,
    { initialEntries: [path] }
  );
}

function chip(id: string) {
  return within(screen.getByRole('group', { name: 'Маршрути' })).getByRole('button', {
    name: new RegExp(`^Маршрут №${id}:`),
  });
}

describe('LocalTransportSchemePage', () => {
  it('renders the scheme with every route line and marks the «Схема» tab active', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Схема маршрутів' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    expect(within(nav).getByRole('link', { name: 'Схема' })).toHaveAttribute('aria-current', 'page');

    const svg = container.querySelector('svg.lts-svg');
    expect(svg).not.toBeNull();
    for (const r of SCHEME_ROUTES) {
      expect(container.querySelector(`.lts-route[data-route="${r.id}"]`)).not.toBeNull();
    }
    expect(container.querySelector('.lts-route--dim')).toBeNull();
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute(
      'href',
      '/transport/scheme/malyn-transit-scheme-poster.pdf'
    );
  });

  it('a route chip highlights the line, shows the card with dataset stats and a schedule link', async () => {
    const { container } = renderPage('/transport/scheme?d=16.09.26&h=09%3A12');
    fireEvent.click(chip('3'));

    expect(screen.getByRole('heading', { level: 2, name: /Лісотехнікум — Залізничний вокзал/ })).toBeInTheDocument();
    expect(container.querySelector('.lts-route[data-route="2"]')).toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-route[data-route="3"]')).not.toHaveClass('lts-route--dim');
    expect(chip('3')).toHaveAttribute('aria-pressed', 'true');

    expect(await screen.findByText('1–2 рейсів у кожен бік · 6:40–18:30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Розклад №3' })).toHaveAttribute(
      'href',
      '/transport/route/3?d=16.09.26&h=09%3A12'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Показати всі' }));
    expect(container.querySelector('.lts-route--dim')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('clicking a line inside the SVG toggles the same highlight', () => {
    const { container } = renderPage();
    const line = container.querySelector('.lts-route[data-route="7"] path') as Element;
    fireEvent.click(line);
    expect(container.querySelector('.lts-route[data-route="7"]')).toHaveClass('lts-route--active');
    expect(container.querySelector('.lts-route[data-route="3"]')).toHaveClass('lts-route--dim');
    fireEvent.click(line);
    expect(container.querySelector('.lts-route--dim')).toBeNull();
  });

  it('deep link ?route=10 opens the unconfirmed route without a schedule link', async () => {
    renderPage('/transport/scheme?route=10');
    expect(screen.getByRole('heading', { level: 2, name: /Лікарня — Залізничний вокзал/ })).toBeInTheDocument();
    expect(await screen.findByText('Розклад уточнюється')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Розклад №/ })).toBeNull();
  });

  it('a stop on the scheme opens its board', async () => {
    const { container } = renderPage('/transport/scheme?d=16.09.26');
    const hub = container.querySelector('.lts-stop[data-stop="st_0019"] circle') as Element;
    fireEvent.click(hub);
    expect(await screen.findByText('Табло зупинки')).toBeInTheDocument();
  });

  it('?stop= marks «ви тут», lights the lines through the stop and links to its board', async () => {
    const { container } = renderPage('/transport/scheme?stop=st_0019&d=16.09.26');
    expect(container.querySelector('.lts-stop[data-stop="st_0019"]')).toHaveClass('lts-stop--here');
    expect(container.querySelector('.lts-stop[data-stop="st_0070"]')).not.toHaveClass('lts-stop--here');

    // Датасет прийшов: лінії 3 і 5 через Вокзал яскраві (10 — ненадійний, прихований), решта тьмяніє
    expect(await screen.findByRole('heading', { level: 2, name: 'Ви тут: Залізничний вокзал' })).toBeInTheDocument();
    expect(screen.getByText('Лінії через зупинку: №3, №5')).toBeInTheDocument();
    expect(container.querySelector('.lts-route[data-route="3"]')).not.toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-route[data-route="5"]')).not.toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-route[data-route="10"]')).toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-route[data-route="2"]')).toHaveClass('lts-route--dim');
    expect(screen.getByRole('link', { name: 'Табло зупинки' })).toHaveAttribute('href', '/transport/stop/st_0019?d=16.09.26');

    // Чіп маршруту має пріоритет над лініями зупинки; маркер лишається
    fireEvent.click(chip('2'));
    expect(container.querySelector('.lts-route[data-route="2"]')).not.toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-route[data-route="3"]')).toHaveClass('lts-route--dim');
    expect(container.querySelector('.lts-stop[data-stop="st_0019"]')).toHaveClass('lts-stop--here');

    // «Показати всі» на картці зупинки прибирає ?stop=
    fireEvent.click(chip('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Показати всі' }));
    expect(container.querySelector('.lts-stop--here')).toBeNull();
    expect(container.querySelector('.lts-route--dim')).toBeNull();
  });

  it('Enter on a focused stop works like a click', async () => {
    const { container } = renderPage();
    const hub = container.querySelector('.lts-stop[data-stop="st_0054"]') as Element;
    fireEvent.keyDown(hub, { key: 'Enter' });
    expect(await screen.findByText('Табло зупинки')).toBeInTheDocument();
  });
});
