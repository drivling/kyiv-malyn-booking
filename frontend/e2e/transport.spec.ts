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

  test('planner form: «З» above «До», selected stop names fully visible', async ({ page }) => {
    await page.goto('/transport/st_a/st_b?d=16.09.26&h=09%3A12');
    const from = page.locator('.lt-from-to-cell--from input');
    const to = page.locator('.lt-from-to-cell--to input');
    await expect(from).toHaveValue('Базар');
    await expect(to).toHaveValue('Вокзал');

    // «З» стоїть над «До», по одній лінії зліва; ⇅ праворуч.
    const fromBox = await from.boundingBox();
    const toBox = await to.boundingBox();
    expect(fromBox && toBox).toBeTruthy();
    expect(toBox!.y).toBeGreaterThan(fromBox!.y + fromBox!.height - 1);
    expect(Math.abs(toBox!.x - fromBox!.x)).toBeLessThan(2);
    const swap = page.getByRole('button', { name: 'Поміняти З та До' });
    await expect(swap).toBeVisible();
    const swapBox = await swap.boundingBox();
    expect(swapBox!.x).toBeGreaterThan(fromBox!.x + fromBox!.width - 1);

    // Довга назва зупинки читається повністю: текст вужчий за видиму частину поля.
    const fits = await from.evaluate((el) => {
      const input = el as HTMLInputElement;
      const cs = getComputedStyle(input);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = cs.font;
      const textWidth = ctx.measureText('з-д "Прожектор"').width;
      const visible = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { textWidth, visible };
    });
    expect(fits.visible).toBeGreaterThan(fits.textWidth);
  });

  test('planner URL follows the form: pick stops, swap, switch to the stop board', async ({ page }) => {
    await page.goto('/transport?d=16.09.26&h=09%3A12');
    const from = page.getByRole('combobox', { name: 'З' });
    const to = page.getByRole('combobox', { name: 'До' });
    await from.click();
    await from.pressSequentially('Ба');
    await page.getByRole('option', { name: 'Базар' }).click();
    await to.click();
    await to.pressSequentially('Вок');
    await page.getByRole('option', { name: 'Вокзал' }).click();

    // Без «Знайти»: адресний рядок оновився сам.
    await expect(page).toHaveURL(/\/transport\/st_a\/st_b\?d=16\.09\.26&h=09(%3A|:)12$/);
    await expect(page.getByText(/З’єднання: Базар → Вокзал/)).toBeVisible();

    // Набір тексту у «З» не дає хибного «немає прямого маршруту», результати лишаються.
    await from.fill('Ба');
    await expect(page.getByText(/Оберіть зупинку зі списку/)).toBeVisible();
    await expect(page.getByText(/немає прямого маршруту/)).toHaveCount(0);
    await expect(page).toHaveURL(/\/transport\/st_a\/st_b\?/);
    await page.getByRole('option', { name: 'Базар' }).click();

    await page.getByRole('button', { name: 'Поміняти З та До' }).click();
    await expect(page).toHaveURL(/\/transport\/st_b\/st_a\?/);
    await expect(from).toHaveValue('Вокзал');

    // Перемикання на табло переносить обране «З».
    await page.getByRole('link', { name: 'Зупинка (табло)' }).click();
    await expect(page).toHaveURL(/\/transport\/stop\/st_b\?/);
  });
});
