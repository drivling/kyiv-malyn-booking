/**
 * Імпорт датасету з файлу (фаза 8 плану Коростеня): лише для не-Малина, файл перевіряється до запиту,
 * PUT іде на ?city=<місто> з baseRevision, meta з бази лишається під meta з файлу.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { TransportDataset } from '@/api/transportDataset';
import { DatasetImportButton } from './DatasetImportButton';
import { importConfirmText, parseImportedDataset } from './datasetImport';

const file: TransportDataset = {
  stops: [{ id: 'st_1001', name: 'Залізничний вокзал', lat: 50.9566, lng: 28.6342 }],
  routes: [{ id: '1', fromName: 'Залізничний вокзал', toName: 'Залізничний вокзал' }],
  routeStops: [],
  trips: [],
  segments: [],
  meta: { defaultSec: 120, routeColors: { '1': '#E40C1C' } },
} as unknown as TransportDataset;

const current = { stops: [], routes: [], routeStops: [], trips: [], segments: [], meta: { stopRedirects: { st_1099: 'st_1001' } }, revision: 'rev-1' } as unknown as TransportDataset;

afterEach(() => vi.restoreAllMocks());

describe('parseImportedDataset', () => {
  it('приймає датасет і відкидає не-JSON, чужий JSON і зупинки без координат', () => {
    expect(parseImportedDataset(JSON.stringify(file)).stops).toHaveLength(1);
    expect(() => parseImportedDataset('{')).toThrow('Файл — не JSON');
    expect(() => parseImportedDataset('{"stops": []}')).toThrow('«routes»');
    expect(() => parseImportedDataset(JSON.stringify({ ...file, stops: [] }))).toThrow('жодної зупинки');
    expect(() => parseImportedDataset(JSON.stringify({ ...file, stops: [{ id: 'st_1', name: 'x' }] }))).toThrow('координат');
  });

  it('підтвердження каже, що було і що стане', () => {
    expect(importConfirmText('Коростень', current, file)).toContain('Зупинок: 0 → 1, маршрутів: 0 → 1, рейсів: 0 → 0');
  });
});

describe('DatasetImportButton', () => {
  it('для Малина кнопки нема', () => {
    const { container } = render(<DatasetImportButton city="Malyn" current={current} onImported={vi.fn()} onError={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Коростень: файл → підтвердження → PUT ?city=Korosten з baseRevision і meta бази', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const seen: Array<{ search: string; body: Record<string, unknown> }> = [];
    server.use(
      http.put(`${TEST_API_URL}/transport/dataset`, async ({ request }) => {
        seen.push({ search: new URL(request.url).search, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({ ok: true, counts: { stops: 1, routes: 1, routeStops: 0, trips: 0, segments: 0 }, revision: 'rev-2' });
      }),
    );
    const onImported = vi.fn();
    render(<DatasetImportButton city="Korosten" current={current} onImported={onImported} onError={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Імпорт датасету з файлу…' })).toBeInTheDocument();
    await user.upload(screen.getByTestId('dataset-import-file'), new File([JSON.stringify(file)], 'korosten-dataset.json', { type: 'application/json' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('Імпортовано: 1 зупинок, 1 маршрутів, 0 рейсів'));
    expect(seen).toHaveLength(1);
    expect(seen[0].search).toBe('?city=Korosten');
    expect(seen[0].body.baseRevision).toBe('rev-1');
    expect(seen[0].body.meta).toEqual({ stopRedirects: { st_1099: 'st_1001' }, defaultSec: 120, routeColors: { '1': '#E40C1C' } });
  });

  it('скасоване підтвердження чи поганий файл — запиту нема', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const put = vi.fn(() => HttpResponse.json({}));
    server.use(http.put(`${TEST_API_URL}/transport/dataset`, put));
    const onError = vi.fn();
    render(<DatasetImportButton city="Korosten" current={current} onImported={vi.fn()} onError={onError} />);
    const input = screen.getByTestId('dataset-import-file');
    await user.upload(input, new File([JSON.stringify(file)], 'a.json', { type: 'application/json' }));
    await user.upload(input, new File(['не json'], 'b.json', { type: 'application/json' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Файл — не JSON'));
    expect(put).not.toHaveBeenCalled();
  });
});
