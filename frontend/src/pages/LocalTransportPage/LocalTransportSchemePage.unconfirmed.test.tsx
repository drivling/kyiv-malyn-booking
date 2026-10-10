import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders, screen } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { LocalTransportSchemePage } from './LocalTransportSchemePage';

// Зараз на схемі немає «непідтверджених» ліній (№10 перемальовано 2026-10); прапорець лишається в генераторі
// для майбутніх маршрутів, тож перевіряємо його на підміненій легенді: лінію 9 позначено непідтвердженою.
vi.mock('./scheme/malyn-scheme-routes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./scheme/malyn-scheme-routes')>();
  return { ...mod, SCHEME_ROUTES: mod.SCHEME_ROUTES.map((r) => (r.id === '9' ? { ...r, unconfirmed: true } : r)) };
});

const dataset = {
  stops: [{ id: 'st_0019', name: 'Залізничний вокзал', lat: 50.774, lng: 29.295 }],
  routes: [{ id: '9', fromName: 'Центр', toName: 'вул. Олекси Тихого' }],
  routeStops: [{ routeId: '9', stopId: 'st_0019', orderThere: 9, orderBack: 1 }],
  trips: [{ id: '9-01', routeId: '9', directionId: '1', departureTime: '06:45:00' }],
  segments: [],
  meta: { defaultSec: 120, center: [50.768, 29.242] },
};

describe('LocalTransportSchemePage: unconfirmed line', () => {
  it('says the schedule is being clarified and has no schedule link', async () => {
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(dataset)));
    renderWithProviders(
      <Routes>
        <Route path="/transport/scheme" element={<LocalTransportSchemePage />} />
      </Routes>,
      { initialEntries: ['/transport/scheme?route=9'] }
    );
    expect(await screen.findByText('Розклад уточнюється')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Розклад №/ })).toBeNull();
  });
});
