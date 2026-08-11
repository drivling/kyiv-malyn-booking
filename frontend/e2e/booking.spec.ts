import { test, expect } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

test.describe('booking happy path', () => {
  test.beforeEach(async ({ page }) => {
    await dismissCookieNotice(page);
    await mockBackendApi(page);
  });

  test('search bus and complete booking modal', async ({ page }) => {
    await page.goto('/mizhgorodski?from=Kyiv&to=Malyn&date=2026-12-01&type=bus');

    await expect(page.getByRole('button', { name: 'Забронювати' }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Забронювати' }).first().click();

    await expect(page.getByRole('heading', { name: 'Бронювання маршрутки' })).toBeVisible();
    await page.locator('.mizh-modal input[type="tel"]').fill('+380501112233');
    await page.locator('.mizh-modal input[type="text"]').fill('Іван Петренко');
    await page.locator('.mizh-modal button[type="submit"]').click();

    await expect(page.getByText('Заявку прийнято')).toBeVisible({ timeout: 10_000 });
  });
});
