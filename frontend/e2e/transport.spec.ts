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
    // exact: поруч є «Знайти найближчі зупинки за геолокацією» (aria-label геокнопки)
    await expect(page.getByRole('button', { name: 'Знайти', exact: true })).toBeVisible();
  });

  test('«Схема»: tab opens the metro-style scheme, a chip highlights the line and links to its schedule', async ({ page }) => {
    await page.goto('/transport?d=16.09.26&h=09%3A12');
    await page.getByRole('link', { name: 'Схема' }).click();
    await expect(page).toHaveURL(/\/transport\/scheme\?d=16\.09\.26&h=09(%3A|:)12$/);
    await expect(page.getByRole('heading', { name: 'Схема маршрутів' })).toBeVisible();
    await expect(page.locator('svg.lts-svg')).toBeVisible();
    await expect(page.locator('.lts-route')).toHaveCount(9);

    await page.locator('.lts-chip[aria-label^="Маршрут №3:"]').click();
    await expect(page).toHaveURL(/route=3/);
    await expect(page.getByRole('heading', { level: 2, name: /Лісотехнікум — Залізничний вокзал/ })).toBeVisible();
    await expect(page.locator('.lts-route[data-route="2"]')).toHaveClass(/lts-route--dim/);
    await expect(page.locator('.lts-route[data-route="3"]')).not.toHaveClass(/lts-route--dim/);
    await expect(page.getByRole('link', { name: 'Розклад №3' })).toHaveAttribute('href', /^\/transport\/route\/3\?d=16\.09\.26/);

    // Зупинка на схемі веде на табло
    await page.locator('.lts-stop[data-stop="st_0019"] circle').first().click();
    await expect(page).toHaveURL(/\/transport\/stop\/st_0019/);
  });

  test('mini-scheme: the route page crops to its line, the stop board lights the lines through the stop', async ({ page }) => {
    await page.goto('/transport/route/2?d=16.09.26&h=09%3A12');
    const mini = page.locator('.lts-mini');
    await expect(mini.getByRole('heading', { name: 'На схемі міста' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Відкрити схему маршрутів: маршрут №2' })).toHaveAttribute(
      'href',
      /^\/transport\/scheme\?route=2&d=16\.09\.26&h=09(%3A|:)12$/
    );
    await expect(mini.locator('.lts-route[data-route="3"]')).toHaveClass(/lts-route--dim/);
    await expect(mini.locator('.lts-route[data-route="2"]')).not.toHaveClass(/lts-route--dim/);
    // Кадр обрізано до лінії (getBBox працює лише в браузері, у jsdom кадр лишається повним)
    await expect(mini.locator('svg.lts-svg')).not.toHaveAttribute('viewBox', '0 176 1400 566');

    // Табло: «Базар» (st_a) не є вузлом схеми — нотатка, яскрава лише її лінія №2
    await page.goto('/transport/stop/st_a?d=16.09.26&h=07%3A00');
    await expect(page.locator('.lts-mini-note')).toHaveText(/^Зупинка між вузлами схеми.*№2\.$/);
    await expect(mini.locator('.lts-route[data-route="2"]')).not.toHaveClass(/lts-route--dim/);
    await expect(mini.locator('.lts-route[data-route="3"]')).toHaveClass(/lts-route--dim/);
    await expect(mini.locator('.lts-stop--here')).toHaveCount(0);
    await page.getByRole('link', { name: 'Відкрити схему маршрутів: зупинка «Базар»' }).click();
    await expect(page).toHaveURL(/\/transport\/scheme\?stop=st_a&d=16\.09\.26&h=07(%3A|:)00$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Ви тут: Базар' })).toBeVisible();
    await expect(page.locator('.lts-canvas .lts-route[data-route="2"]')).not.toHaveClass(/lts-route--dim/);
    await expect(page.locator('.lts-canvas .lts-route[data-route="3"]')).toHaveClass(/lts-route--dim/);

    // Вузол схеми: маркер «ви тут» ставиться навіть до приходу датасету
    await page.goto('/transport/scheme?stop=st_0019');
    await expect(page.locator('.lts-canvas .lts-stop[data-stop="st_0019"]')).toHaveClass(/lts-stop--here/);
  });

  test('route badges carry the scheme colour in the planner, the catalogue and on the stop board', async ({ page }) => {
    // Планувальник: картка результату №2 → колір лінії зі схеми (червоний), каталог ліній теж
    await page.goto('/transport/st_a/st_b?d=16.09.26&h=09%3A12');
    const card = page.locator('.lt-route-num--card').first();
    await expect(card).toHaveText('№2');
    await expect(card).toHaveCSS('background-color', 'rgb(215, 38, 61)');
    await page.goto('/transport');
    const catalogue = page.locator('.lt-aeo-route-num', { hasText: /^3$/ });
    await expect(catalogue).toHaveCSS('background-color', 'rgb(27, 158, 75)');
    await expect(page.getByRole('link', { name: /^№3 / })).toBeVisible();

    // Табло: плашка номера теж у кольорі лінії (перевірений маршрут — суцільна)
    await page.goto('/transport/stop/st_a?d=16.09.26&h=07%3A00');
    const board = page.locator('.lt-jd-card__route-num').first();
    await expect(board).toHaveText(/№[23]/);
    await expect(board).toHaveCSS('border-color', /rgb\((215, 38, 61|27, 158, 75)\)/);
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
    await expect(page.getByText(/Прямі маршрути: Базар → Вокзал/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Базар → Вокзал');
    await expect(page).toHaveTitle(/^Базар → Вокзал — як доїхати у Малині/);

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

  test('date is a native picker; «Завтра» chip updates d= in the URL', async ({ page }) => {
    // Дата навмисно далеко від сьогодні, щоб чіп не був натиснутий від початку.
    await page.goto('/transport/st_a/st_b?d=01.03.26&h=09%3A12');
    await expect(page.getByText('01.03.26, 09:12')).toBeVisible();
    await page.getByRole('button', { name: 'Змінити' }).click();
    const date = page.getByLabel('Дата');
    await expect(date).toHaveAttribute('type', 'date');
    await expect(date).toHaveValue('2026-03-01');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const yy = String(tomorrow.getFullYear()).slice(-2);
    await page.getByRole('button', { name: 'Завтра' }).click();
    await expect(page).toHaveURL(new RegExp(`d=${dd}\\.${mm}\\.${yy}&h=`));
    await expect(page.getByRole('button', { name: 'Завтра' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Завтра, 09:12')).toBeVisible();
  });

  test('result card: departure → arrival · duration, destination, no jargon; next-day wrap', async ({ page }) => {
    await page.goto('/transport/st_a/st_b?d=01.03.26&h=08%3A00');
    const card = page.getByRole('button', { name: /Маршрут №2 до Лікарня/ });
    await expect(card).toContainText('08:30 → 08:34 · 4 хв');
    await expect(card).toContainText('→ Лікарня');
    await expect(card).not.toContainText(/лінія|перевірено/);

    await page.goto('/transport/st_a/st_b?d=01.03.26&h=23%3A50');
    await expect(page.getByRole('button', { name: /Маршрут №2/ })).toContainText('перший наступного дня');
  });

  test('no direct route: suggests the neighbouring stop with a direct route', async ({ page }) => {
    await page.goto('/transport/st_a/st_d?d=01.03.26&h=09%3A12');
    await expect(page.getByText(/немає прямого маршруту/)).toBeVisible();
    const suggestion = page.getByRole('button', { name: /Ринок → Парк/ });
    await expect(suggestion).toContainText(/\d+ м від «Базар» · №3/);
    await suggestion.click();
    await expect(page).toHaveURL(/\/transport\/st_e\/st_d\?/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ринок → Парк');
    await expect(page.getByRole('button', { name: /Маршрут №3 до Парк/ })).toBeVisible();
  });

  test('stop board: typing keeps the URL; pick → planner hand-off; route «Назад» returns to the board', async ({ page }) => {
    await page.goto('/transport/stop/st_a?d=01.03.26&h=07%3A00');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Зупинка «Базар»');
    const field = page.getByRole('combobox', { name: 'Зупинка' });
    await field.fill('Вок');
    await expect(page).toHaveURL(/\/transport\/stop\/st_a\?/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Зупинка «Базар»');
    await expect(page.getByText('Оберіть зупинку зі списку.')).toBeVisible();
    await page.getByRole('option', { name: 'Вокзал' }).click();
    await expect(page).toHaveURL(/\/transport\/stop\/st_b\?d=01\.03\.26&h=07(%3A|:)00/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Зупинка «Вокзал»');

    // Табло → планувальник: обрана зупинка стає «З»
    await page.getByRole('link', { name: 'Маршрути (З → До)' }).click();
    await expect(page).toHaveURL(/\/transport\?.*from=st_b/);
    await expect(page.getByRole('combobox', { name: 'З' })).toHaveValue('Вокзал');

    // Назад на табло → картка → сторінка маршруту → «Назад» → знову табло цієї зупинки
    await page.goBack();
    await expect(page).toHaveURL(/\/transport\/stop\/st_b\?/);
    await page.getByRole('link', { name: /Маршрут 2, відправлення 08:34/ }).click();
    await expect(page).toHaveURL(/\/transport\/route\/2\?/);
    await page.getByRole('button', { name: 'Назад до пошуку' }).click();
    await expect(page).toHaveURL(/\/transport\/stop\/st_b\?/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Зупинка «Вокзал»');
  });

  test.describe('stop board on a phone', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      geolocation: { latitude: 50.7701, longitude: 29.2401 },
      permissions: ['geolocation'],
    });

    test('site header is one row: under 60px, left links scroll, auth is an icon with a name', async ({ page }) => {
      await page.goto('/transport');
      const nav = page.getByRole('navigation', { name: 'Головне меню' });
      const box = await nav.boundingBox();
      expect(box!.height).toBeLessThan(60);
      // Місто сховане ≤480px, «Логін» — іконка з доступною назвою
      await expect(nav.locator('.nav-link-city')).toBeHidden();
      await expect(nav.getByRole('link', { name: /^Транспорт/ })).toHaveText(/^Транспорт$/, { useInnerText: true });
      await expect(nav.getByRole('link', { name: 'Логін' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Логін' }).locator('.nav-link-text')).toBeHidden();
      // Останнє посилання досяжне прокруткою рядка, а не другим рядком
      const help = nav.getByRole('link', { name: 'Допомога' });
      await help.scrollIntoViewIfNeeded();
      await expect(help).toBeVisible();
      const helpBox = await help.boundingBox();
      expect(helpBox!.y + helpBox!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
      // Форма планувальника починається вище, ніж раніше з двома рядками меню (було ≈260px)
      const fromBox = await page.getByRole('combobox', { name: 'З' }).boundingBox();
      expect(fromBox!.y).toBeLessThan(230);
    });

    test('no map strip; «Поруч зі мною» opens the nearest stop; «Завтра» applies without a button', async ({ page }) => {
      await page.goto('/transport/stop?d=01.03.26&h=07%3A00');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Табло зупинок');
      await expect(page.locator('.lt-map-column')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Застосувати' })).toHaveCount(0);

      await page.getByRole('button', { name: 'Знайти найближчі зупинки за геолокацією' }).click();
      await page.getByRole('button', { name: /^Базар — \d+ м$/ }).click();
      await expect(page).toHaveURL(/\/transport\/stop\/st_a\?d=01\.03\.26&h=07(%3A|:)00/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Зупинка «Базар»');

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dd = String(tomorrow.getDate()).padStart(2, '0');
      const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const yy = String(tomorrow.getFullYear()).slice(-2);
      await page.getByRole('button', { name: 'Змінити' }).click();
      await page.getByRole('button', { name: 'Завтра' }).click();
      await expect(page).toHaveURL(new RegExp(`/transport/stop/st_a\\?d=${dd}\\.${mm}\\.${yy}&h=`));
      await expect(page.getByText('Завтра, 07:00')).toBeVisible();
    });
  });

  test.describe('today by the Kyiv clock', () => {
    test.use({ timezoneId: 'Europe/Kyiv' });

    test('result card counts down from now', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-09-16T05:18:00Z')); // 08:18 за Києвом
      await page.goto('/transport/st_a/st_b?d=16.09.26&h=08%3A00');
      await expect(page.getByRole('button', { name: /Маршрут №2/ })).toContainText('через 12 хв');
    });
  });
});
