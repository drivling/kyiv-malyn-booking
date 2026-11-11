/**
 * Фаза 6 плану Коростеня: перемикач міста над транспортними вкладками адмінки (?transportCity=), вкладки
 * пишуть і читають датасет обраного міста, адмінські запити клієнта несуть місто, наклейки ведуть на домен міста.
 * Для Малина — ті самі адреси й тіла, що й раніше.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { apiClient } from '@/api/client';
import type { TransportDataset } from '@/api/transportDataset';
import { ScheduleEditorTab } from './ScheduleEditorTab';
import { TransportCityBar } from './TransportCityBar';
import { transportCitySearch, useAdminTransportCity } from './useAdminTransportCity';
import { stickerFooter, stickerQrCaption, stickerQrUrl } from './stopSticker/stickerSheets';
import { wallUrl } from '@/pages/StickerWallPage/stickerWall';

const dataset: TransportDataset = {
  stops: [
    { id: 'st_0001', name: 'Залізничний вокзал', lat: 50.95, lng: 28.64 },
    { id: 'st_0002', name: 'Міський центральний ринок', lat: 50.951, lng: 28.65 },
  ],
  routes: [{ id: '1', fromName: 'Залізничний вокзал', toName: 'Міський центральний ринок' }],
  routeStops: [
    { routeId: '1', stopId: 'st_0001', orderThere: 1, orderBack: 2 },
    { routeId: '1', stopId: 'st_0002', orderThere: 2, orderBack: 1 },
  ],
  trips: [{ id: '1-01', routeId: '1', serviceId: 'everyday', headsign: '', directionId: '1', departureTime: '06:20:00', blockId: null }],
  segments: [],
  meta: { defaultSec: 120 },
  revision: '2026-11-11T08:00:00.000Z',
};

function Harness() {
  const { city, setCity } = useAdminTransportCity();
  const location = useLocation();
  return (
    <>
      <TransportCityBar city={city} onChange={setCity} />
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="city">{city}</output>
    </>
  );
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Harness />
    </MemoryRouter>,
  );

describe('перемикач міста в адмінці', () => {
  it('без параметра — Малин, без банера; невідоме місто — теж Малин', () => {
    renderAt('/admin/route-schedule');
    expect(screen.getByTestId('city').textContent).toBe('Malyn');
    expect(screen.getByRole('combobox')).toHaveValue('Malyn');
    expect(screen.queryByText(/Редагуєте:/)).toBeNull();
    renderAt('/admin/route-schedule?transportCity=Atlantis');
    expect(screen.getAllByTestId('city')[1].textContent).toBe('Malyn');
  });

  it('Коростень: банер, посилання на перегляд; зміна міста прибирає обрану зупинку', async () => {
    const user = userEvent.setup();
    renderAt('/admin/stickers?stop=st_0015');
    await user.selectOptions(screen.getByRole('combobox'), 'Korosten');
    expect(screen.getByTestId('location').textContent).toBe('/admin/stickers?transportCity=Korosten');
    expect(screen.getByText('Редагуєте: КОРОСТЕНЬ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Переглянути сторінки міста/ })).toHaveAttribute('href', '/transport?transportCity=Korosten');
    await user.selectOptions(screen.getByRole('combobox'), 'Malyn');
    expect(screen.getByTestId('location').textContent).toBe('/admin/stickers');
  });

  it('перехід між вкладками зберігає місто', () => {
    expect(transportCitySearch('Malyn')).toBe('');
    expect(transportCitySearch('Korosten')).toBe('?transportCity=Korosten');
  });
});

describe('вкладка «Графік транспорту» для Коростеня', () => {
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('читає й зберігає датасет із ?city=Korosten; Малин — без параметра', async () => {
    const user = userEvent.setup();
    const gets: string[] = [];
    const puts: string[] = [];
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, ({ request }) => {
        gets.push(new URL(request.url).search);
        return HttpResponse.json(dataset);
      }),
      http.put(`${TEST_API_URL}/transport/dataset`, ({ request }) => {
        puts.push(new URL(request.url).search);
        return HttpResponse.json({ ok: true, counts: { routes: 1, trips: 1 }, revision: 'rev-2' });
      }),
    );
    const { unmount } = render(<ScheduleEditorTab city="Korosten" />);
    await screen.findByRole('heading', { name: /Маршрут №1/ }, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Зберегти в базу' }));
    await waitFor(() => expect(puts).toEqual(['?city=Korosten']));
    expect(gets).toContain('?city=Korosten');
    unmount();

    render(<ScheduleEditorTab />);
    await screen.findByRole('heading', { name: /Маршрут №1/ }, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Зберегти в базу' }));
    await waitFor(() => expect(puts).toEqual(['?city=Korosten', '']));
    expect(gets[gets.length - 1]).toBe('');
  });
});

describe('адмінські запити з містом', () => {
  it('Малин — ті самі адреси й тіла; інше місто — з city', async () => {
    const seen: string[] = [];
    const bodies: unknown[] = [];
    const record = async ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.method === 'POST') bodies.push(await request.json());
      return HttpResponse.json({ ok: true });
    };
    server.use(
      http.all(`${TEST_API_URL}/admin/transport/*`, record),
      http.get(`${TEST_API_URL}/transport/sticker-wall`, record),
    );
    await apiClient.getArrivalReports(7);
    await apiClient.getArrivalReports(7, 'Korosten');
    await apiClient.deleteArrivalReport(5, 'Korosten');
    await apiClient.getStickerScanStats(30, 'Korosten');
    await apiClient.getStickerWall('k', 3, 'Korosten');
    await apiClient.recordStickerPrint({ stopId: 'st_0001', sides: ['a'], size: 'A5' });
    await apiClient.recordStickerPrint({ stopId: 'st_0001', sides: ['a'], size: 'A5' }, 'Korosten');
    await apiClient.recalculateTransportSegments('1', 'Korosten');
    expect(seen).toEqual([
      'GET /admin/transport/arrival-reports?days=7',
      'GET /admin/transport/arrival-reports?days=7&city=Korosten',
      'DELETE /admin/transport/arrival-reports/5?city=Korosten',
      'GET /admin/transport/sticker-scans?days=30&city=Korosten',
      'GET /transport/sticker-wall?key=k&after=3&city=Korosten',
      'POST /admin/transport/sticker-prints',
      'POST /admin/transport/sticker-prints',
      'POST /admin/transport/recalculate-segments?city=Korosten',
    ]);
    expect(bodies.slice(0, 2)).toEqual([
      { stopId: 'st_0001', sides: ['a'], size: 'A5' },
      { stopId: 'st_0001', sides: ['a'], size: 'A5', city: 'Korosten' },
    ]);
  });
});

describe('наклейки й віджет на стіну', () => {
  it('QR і підписи — на домен міста; без домену — головний', () => {
    expect(stickerQrUrl('st_0001', 'a')).toMatch(/^https:\/\/malin\.kiev\.ua\/transport\/stop\/st_0001\?/);
    expect(stickerQrUrl('st_0001', 'a', 'korosten.kiev.ua')).toMatch(/^https:\/\/korosten\.kiev\.ua\/transport\/stop\/st_0001\?utm_source=sticker/);
    expect(stickerQrCaption('st_0001', 'korosten.kiev.ua')).toBe('korosten.kiev.ua/transport/stop/st_0001');
    expect(stickerFooter(15, 'korosten.kiev.ua')).toBe('Проїзд 15 ₴ · Схема маршрутів і розклад: korosten.kiev.ua/transport');
  });

  it('посилання на стіну несе місто, у Малина — як було', () => {
    expect(wallUrl('https://malin.kiev.ua', 'abc')).toBe('https://malin.kiev.ua/admin/wall?key=abc');
    expect(wallUrl('https://malin.kiev.ua', 'abc', 'Korosten')).toBe('https://malin.kiev.ua/admin/wall?key=abc&transportCity=Korosten');
  });
});
