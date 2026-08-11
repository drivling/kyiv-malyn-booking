import { test, expect } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

test.describe('admin auth', () => {
  test.beforeEach(async ({ page }) => {
    await dismissCookieNotice(page);
    await mockBackendApi(page);
  });

  test('login from /admin shows admin panel', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Увійти' })).toBeVisible();

    await page.getByRole('button', { name: 'Адмін' }).click();
    await page.getByLabel('Пароль адміністратора').fill('test-password');
    await page.getByRole('button', { name: 'Увійти як адмін' }).click();

    await expect(page.getByRole('heading', { name: 'Адмін панель' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Розділи' })).toBeVisible();
  });

  test('invalid stored token returns to login', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('adminToken', 'stale-token');
    });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Увійти' })).toBeVisible();
  });
});
