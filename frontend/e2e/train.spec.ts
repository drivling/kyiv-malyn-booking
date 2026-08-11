import { test, expect } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

test.describe('elektrichka ticket CTA', () => {
  test.beforeEach(async ({ page }) => {
    await dismissCookieNotice(page);
    await mockBackendApi(page);
  });

  test('open train disclaimer and purchase link', async ({ page }) => {
    await page.goto('/mizhgorodski?from=Korosten&to=Malyn&date=2026-08-12&type=train');

    await expect(page.getByRole('button', { name: 'Купити квиток' }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Купити квиток' }).first().click();

    await expect(page.getByRole('heading', { name: 'Квиток на електричку' })).toBeVisible();
    const buy = page.getByRole('link', { name: 'Купити квиток' });
    await expect(buy).toBeVisible();
    await expect(buy).toHaveAttribute('href', 'https://tickets.example/buy');
  });
});
