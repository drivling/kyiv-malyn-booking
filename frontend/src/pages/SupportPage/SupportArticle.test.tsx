/**
 * Стаття «API та відкриті дані для розробників» (/support/api, Docs/transport-open-protocols-2026-10.md, фаза 2):
 * заголовок, посилання на OpenAPI, GTFS і живий датасет на домені API, розділ «Що ми обіцяємо», тема в навігації.
 */
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
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
