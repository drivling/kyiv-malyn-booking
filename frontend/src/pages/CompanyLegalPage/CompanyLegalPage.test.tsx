import { describe, expect, test, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompanyLegalPage } from './CompanyLegalPage';

function renderOn(hostname: string) {
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    hostname,
    protocol: 'https:',
    port: '',
    search: '',
    pathname: '/about',
    hash: '',
  } as Location);
  return render(
    <MemoryRouter initialEntries={['/about']}>
      <CompanyLegalPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/about на різних доменах', () => {
  test('на malin.kiev.ua заголовок і текст називають цей домен', () => {
    renderOn('malin.kiev.ua');
    expect(document.title).toBe('Про нас | malin.kiev.ua');
    expect(screen.getAllByText('malin.kiev.ua').length).toBeGreaterThan(0);
  });

  test('на korosten.kiev.ua сторінка працює і показує свій домен', () => {
    renderOn('korosten.kiev.ua');
    expect(document.title).toBe('Про нас | korosten.kiev.ua');
    // реквізити компанії лишаються тими самими на будь-якому домені
    expect(screen.getByText('46288273')).toBeTruthy();
    expect(screen.getAllByText('korosten.kiev.ua').length).toBeGreaterThan(0);
    // юридичні формулювання перелічують усі домени сервісу
    expect(screen.getAllByText('malin.kiev.ua і korosten.kiev.ua').length).toBeGreaterThan(0);
  });

  test('канонікал завжди веде на головний домен', () => {
    renderOn('korosten.kiev.ua');
    const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    expect(canonical?.href).toBe('https://malin.kiev.ua/about');
  });

  test('посилання на дошку — відносне, тож працює на будь-якому домені', () => {
    const { container } = renderOn('korosten.kiev.ua');
    // блок умов акції згорнутий (aria-hidden), тому шукаємо у DOM, а не через роль
    const link = Array.from(container.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('/mizhgorodski'),
    );
    expect(link?.getAttribute('href')).toBe('/mizhgorodski');
    expect(link?.textContent).toBe('korosten.kiev.ua/mizhgorodski');
    // жодних абсолютних посилань на чужий домен зі сторінки
    const crossDomain = Array.from(container.querySelectorAll('a')).filter((a) =>
      (a.getAttribute('href') || '').startsWith('https://malin.kiev.ua'),
    );
    expect(crossDomain).toHaveLength(0);
  });
});
