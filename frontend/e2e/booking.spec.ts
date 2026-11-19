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
    // у пошуку попереджень про «Зубастик» немає — лише в модалці бронювання (рішення власника 2026-11-19)
    await expect(page.getByText('Онлайн-бронювання поки не працює')).toHaveCount(0);
    await page.getByRole('button', { name: 'Забронювати' }).first().click();

    await expect(page.getByRole('heading', { name: 'Бронювання маршрутки' })).toBeVisible();
    await expect(page.locator('.mizh-modal').getByRole('note')).toContainText('лише за телефоном');
    await page.locator('.mizh-modal input[type="tel"]').fill('+380501112233');
    await page.locator('.mizh-modal input[type="text"]').fill('Іван Петренко');
    await page.locator('.mizh-modal button[type="submit"]').click();

    await expect(page.getByText('Заявку прийнято')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.mizh-modal').getByRole('note')).toContainText('Місце ще не заброньоване');
  });
});
