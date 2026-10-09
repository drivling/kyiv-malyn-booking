import { test, expect, type Page } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

/**
 * Бюджет запитів одного пошуку на головній (Docs/poputky-search-performance-plan.md, Фаза 1):
 * оголошення — лише серверний /viber-listings/search, розклад — з датою, вільні місця —
 * один раз на маршрутку, каталоги — один раз на вкладку (далі з кешу модуля).
 */
const API_HOST = /localhost:3000|127\.0\.0\.1:3000/;

function recordApiRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (API_HOST.test(u.host)) seen.push(u.pathname + u.search);
  });
  return seen;
}

const count = (seen: string[], re: RegExp) => seen.filter((p) => re.test(p)).length;

test.describe('home search request budget', () => {
  test.beforeEach(async ({ page }) => {
    await dismissCookieNotice(page);
    await mockBackendApi(page);
  });

  test('one search = one GET /poputky/search; catalogs once per tab; modal reuses availability', async ({ page }) => {
    const seen = recordApiRequests(page);
    await page.goto('/mizhgorodski?from=Kyiv&to=Malyn&date=2026-12-01');
    await expect(page.getByRole('button', { name: 'Забронювати' }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    // Ніякого bulk-завантаження всіх оголошень і жодних окремих запитів розкладу/місць
    expect(count(seen, /^\/viber-listings/)).toBe(0);
    expect(count(seen, /^\/schedules/)).toBe(0);
    expect(count(seen, /\/availability\?/)).toBe(0);
    // Dev-сервер під React.StrictMode монтує сторінку двічі → перший пошук може піти двічі;
    // у продакшн-збірці — один.
    const firstSearches = count(seen, /^\/poputky\/search\?/);
    expect(firstSearches).toBeGreaterThanOrEqual(1);
    expect(firstSearches).toBeLessThanOrEqual(2);
    expect(seen.find((p) => p.startsWith('/poputky/search?'))).toContain('date=2026-12-01');
    // Каталоги — по одному разу (кеш модуля дедуплікує навіть подвійне монтування)
    expect(count(seen, /^\/trip-routes/)).toBe(1);
    expect(count(seen, /^\/od-pairs/)).toBe(1);
    expect(count(seen, /^\/trip-points\?appearInPoputky/)).toBe(1);

    // Другий пошук (інша дата): каталоги з кешу, рівно один запит до API
    seen.length = 0;
    await page.getByRole('button', { name: 'Завтра' }).click();
    await expect(page.getByRole('button', { name: 'Забронювати' }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^\/poputky\/search\?/);

    // Модалка бронювання бере вільні місця з головної — без третього запиту
    seen.length = 0;
    await page.getByRole('button', { name: 'Забронювати' }).first().click();
    await expect(page.getByRole('heading', { name: 'Бронювання маршрутки' })).toBeVisible();
    expect(count(seen, /\/availability\?/)).toBe(0);
  });
});
