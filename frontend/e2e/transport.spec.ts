import { test, expect } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

test.describe('transport', () => {
  test.beforeEach(async ({ page }) => {
    await dismissCookieNotice(page);
    await mockBackendApi(page);
  });

  test('/transport loads planner and routes list', async ({ page }) => {
    await page.goto('/transport');
    await expect(page.getByRole('link', { name: 'Маршрути (З → До)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Маршрути Малина' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Знайти' })).toBeVisible();
  });
});
