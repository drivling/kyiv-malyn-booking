/**
 * Стаття «API та відкриті дані для розробників» (/support/api, Docs/transport-open-protocols-2026-10.md, фаза 2):
 * заголовок, посилання на OpenAPI, GTFS і живий датасет на домені API, розділ «Що ми обіцяємо», тема в навігації.
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { invalidateTransportDatasetCache } from '@/pages/LocalTransportPage/dataset/useTransportDataset';
import { SupportArticle } from './SupportArticle';
import { SupportLayout } from './SupportLayout';
import { SUPPORT_TOPICS, isSupportTopicId } from './supportContent';

function renderTopic(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/support" element={<SupportLayout />}>
          <Route path=":topicId" element={<SupportArticle />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('/support/api', () => {
  it('is a support topic with its own article, title and canonical', () => {
    expect(isSupportTopicId('api')).toBe(true);
    expect(SUPPORT_TOPICS.find((t) => t.id === 'api')?.shortTitle).toBe('API');
    renderTopic('/support/api');
    expect(screen.getByRole('heading', { level: 1, name: 'API та відкриті дані для розробників' })).toBeTruthy();
    expect(document.title).toBe('API та відкриті дані для розробників | malin.kiev.ua');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://malin.kiev.ua/support/api');
  });

  it('links the OpenAPI document, the GTFS feed and the live dataset on the API host', () => {
    renderTopic('/support/api');
    const article = screen.getByRole('article');
    expect(within(article).getByRole('link', { name: 'openapi.yaml' }).getAttribute('href')).toBe('/openapi.yaml');
    expect(within(article).getByRole('link', { name: 'GTFS Static' }).getAttribute('href')).toBe('/transport/gtfs.zip');
    expect(within(article).getByRole('link', { name: 'JSON наживо' }).getAttribute('href')).toBe('/transport/dataset');
    expect(within(article).getByRole('link', { name: 'знімок збірки' }).getAttribute('href')).toBe('/transport/dataset.json');
    expect(within(article).getByRole('link', { name: 'журнал ревізій' }).getAttribute('href')).toBe('/transport/revisions');
    expect(within(article).getByRole('link', { name: 'OwnNet Source License 1.1' }).getAttribute('rel')).toContain('license');
  });

  it('states the id contract: stable stop and route ids, redirects for merged stops, revision everywhere', () => {
    renderTopic('/support/api');
    const section = screen.getByRole('heading', { level: 2, name: 'Що ми обіцяємо: стабільні id' }).closest('section')!;
    expect(section.textContent).toContain('st_NNNN');
    expect(section.textContent).toContain('meta.stopRedirects');
    expect(section.textContent).toContain('trip_id');
  });
});

describe('/support/transport — тариф із датасету', () => {
  it('shows meta.fare from the dataset (amount + note), not a number from the article text', async () => {
    invalidateTransportDatasetCache();
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, () =>
        HttpResponse.json({
          stops: [],
          routes: [],
          routeStops: [],
          trips: [],
          segments: [],
          meta: { defaultSec: 120, center: [50.768, 29.242], fare: { amount: 25, currency: 'UAH', note: '25 грн з 21 жовтня 2026' } },
          revision: '2026-10-20T17:34:46.399Z',
        })
      )
    );
    renderTopic('/support/transport');
    const chip = await screen.findByLabelText('Тариф 25 гривень');
    expect(chip.textContent).toContain('25');
    expect(screen.getByText('25 грн з 21 жовтня 2026')).toBeTruthy();
    expect(screen.queryByLabelText('Тариф 20 гривень')).toBeNull();
    invalidateTransportDatasetCache();
  });

  it('renders a sentence instead of a number while the dataset has no fare', async () => {
    invalidateTransportDatasetCache();
    renderTopic('/support/transport');
    expect(await screen.findByText(/Тариф у сервісі — на сторінці маршруту/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Тариф \d+ гривень$/)).toBeNull();
    invalidateTransportDatasetCache();
  });
});
