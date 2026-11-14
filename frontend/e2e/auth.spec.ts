import { test, expect } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';
import { ADMIN_TOKEN_STORAGE_KEY } from '../src/utils/adminTokenStorage';

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
    await page.addInitScript((key) => {
      localStorage.setItem(key, 'stale-token');
    }, ADMIN_TOKEN_STORAGE_KEY);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Увійти' })).toBeVisible();
  });

  test('a token saved under the old key name no longer opens the admin and is wiped', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('adminToken', 'admin-authenticated');
    });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Увійти' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('adminToken'))).toBeNull();
  });
});
