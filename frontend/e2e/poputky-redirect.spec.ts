import { test, expect } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

/**
 * /poputky is the retired rideshare page. The static host answers it with a 301 (scripts/serve-dist-rules.mjs, covered by
 * serve-dist-rules.test.ts); this spec covers the SPA side — a client-side visit — which must end up on the same place:
 * the intercity board with the «Попутки» filter already chosen.
 */
test.describe('/poputky redirect', () => {
  test.beforeEach(async ({ page }) => {
    await dismissCookieNotice(page);
    await mockBackendApi(page);
  });

  test('opens /mizhgorodski with type=carpool and the «Попутки» tab selected', async ({ page }) => {
    await page.goto('/poputky');

    await expect(page).toHaveURL(/\/mizhgorodski\?(?:.*&)?type=carpool(?:&|$)/);
    await expect(page.getByRole('tab', { name: /^Попутки/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /^Усі/ })).toHaveAttribute('aria-selected', 'false');
  });

  test('plain /mizhgorodski still starts on «Усі»', async ({ page }) => {
    await page.goto('/mizhgorodski');

    await expect(page.getByRole('tab', { name: /^Усі/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /^Попутки/ })).toHaveAttribute('aria-selected', 'false');
  });
});
