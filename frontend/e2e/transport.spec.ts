import { test, expect, devices, type Locator, type Page } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

test.describe('transport', () => {
  test.beforeEach(async ({ page }) => {
    await dismissCookieNotice(page);
    await mockBackendApi(page);
  });

  test('/transport loads planner and routes list', async ({ page }) => {
    await page.goto('/transport');
    await expect(page.getByRole('link', { name: 'Маршрути (Звідки → Куди)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Маршрути Малина' })).toBeVisible({
      timeout: 15_000,
    });
    // Без пари — швидкий старт: чіп вузла схеми ставить «Куди» (Поліклініка належить вузлу «Лікарня · Поліклініка»)
    await expect(page.getByText('Куди їдете?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Знайти', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Лікарня · Поліклініка' }).click();
    await expect(page.getByRole('combobox', { name: 'Куди' })).toHaveValue('Поліклініка');
    await expect(page.getByText('Тепер оберіть «Звідки»')).toBeVisible();
    await expect(page).toHaveURL(/\/transport\?to=st_0072&d=/);
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

    // Вузол бачить усі маршрути: Поліклініка (st_0072) — частина вузла «Лікарня · Поліклініка» (st_0035)
    await page.goto('/transport/stop/st_0072?d=16.09.26&h=07%3A00');
    await expect(page.locator('.lts-mini-note')).toHaveText(/^Вузол «Лікарня · Поліклініка» — підсвічено лінії всього вузла: №2\.$/);
    await expect(mini.locator('.lts-stop[data-stop="st_0035"]')).toHaveClass(/lts-stop--here/);
    await page.getByRole('link', { name: 'Відкрити схему маршрутів: зупинка «Поліклініка»' }).click();
    await expect(page).toHaveURL(/\/transport\/scheme\?stop=st_0072/);
    await expect(page.getByRole('heading', { level: 2, name: 'Ви тут: Лікарня · Поліклініка' })).toBeVisible();
    await expect(page.locator('.lts-canvas .lts-stop[data-stop="st_0035"]')).toHaveClass(/lts-stop--here/);
    await expect(page.locator('.lts-canvas .lts-route[data-route="2"]')).not.toHaveClass(/lts-route--dim/);
    await expect(page.locator('.lts-canvas .lts-route[data-route="3"]')).toHaveClass(/lts-route--dim/);
    await expect(page.getByRole('link', { name: 'Табло зупинки' })).toHaveAttribute('href', /\/transport\/stop\/st_0072/);
  });

  test('route page: two taps on the timeline pick «Звідки» and «Куди», the URL and the table follow', async ({ page }) => {
    await page.goto('/transport/route/2?d=16.09.26&h=08%3A00');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/№2/);
    await expect(page.getByRole('button', { name: 'Показати розклад' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Базар' }).click();
    await expect(page).toHaveURL(/stop=st_a&dir=there/);
    await expect(page.locator('.lt-stop-item--from')).toContainText('Базар');
    await page.getByRole('button', { name: 'Лікарня' }).click();
    await expect(page).toHaveURL(/stop=st_a&dir=there&to=st_c/);
    await expect(page.locator('.lt-stop-item--to')).toContainText('Лікарня');
    await expect(page.locator('thead th').nth(1)).toHaveText('Прибуття (Лікарня)');
    // «Табло» веде на табло зупинки з тією самою датою
    await expect(page.getByRole('link', { name: 'Табло зупинки «Вокзал»' })).toHaveAttribute('href', /\/transport\/stop\/st_b\?d=16\.09\.26&h=08(%3A|:)00/);
    await page.getByRole('button', { name: 'Скинути' }).click();
    await expect(page).toHaveURL(/\/transport\/route\/2\?d=16\.09\.26&h=08(%3A|:)00&dir=there$/);
    await expect(page.locator('.lt-stop-item--from')).toHaveCount(0);
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
    const board = page.locator('.lt-board-card__route-num').first();
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
    const swap = page.getByRole('button', { name: 'Поміняти місцями', exact: true });
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
    const from = page.getByRole('combobox', { name: 'Звідки' });
    const to = page.getByRole('combobox', { name: 'Куди' });
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

    await page.getByRole('button', { name: 'Поміняти місцями', exact: true }).click();
    await expect(page).toHaveURL(/\/transport\/st_b\/st_a\?/);
    await expect(from).toHaveValue('Вокзал');

    // Перемикання на табло переносить обране «З».
    await page.getByRole('link', { name: 'Зупинка (табло)' }).click();
    await expect(page).toHaveURL(/\/transport\/stop\/st_b\?/);
  });

  test('date is a native picker; «Завтра» chip updates d= in the URL', async ({ page }) => {
    // Дата навмисно далеко від сьогодні, щоб чіп не був натиснутий від початку.
    await page.goto('/transport/st_a/st_b?d=01.03.26&h=09%3A12');
    await page.getByRole('button', { name: '01.03.26 о 09:12', exact: true }).click();
    const date = page.getByLabel('Дата', { exact: true });
    await expect(date).toHaveAttribute('type', 'date');
    await expect(date).toHaveValue('2026-03-01');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const yy = String(tomorrow.getFullYear()).slice(-2);
    await page.getByRole('button', { name: 'Завтра', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`d=${dd}\\.${mm}\\.${yy}&h=`));
    await expect(page.getByRole('button', { name: 'Завтра', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Завтра о 09:12', exact: true })).toBeVisible();
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
    await page.getByRole('link', { name: 'Маршрути (Звідки → Куди)' }).click();
    await expect(page).toHaveURL(/\/transport\?.*from=st_b/);
    await expect(page.getByRole('combobox', { name: 'Звідки' })).toHaveValue('Вокзал');

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
      const fromBox = await page.getByRole('combobox', { name: 'Звідки' }).boundingBox();
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
      await page.getByRole('button', { name: 'Завтра', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/transport/stop/st_a\\?d=${dd}\\.${mm}\\.${yy}&h=`));
      await expect(page.getByRole('button', { name: 'Завтра о 07:00', exact: true })).toBeVisible();
    });
  });

  test('stop board: a line chip under the title filters the cards and lives in ?line=', async ({ page }) => {
    await page.goto('/transport/stop/st_c?d=16.09.26&h=07%3A00');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Зупинка «Лікарня»');
    const chips = page.getByRole('group', { name: 'Маршрути через зупинку' });
    await expect(chips.getByRole('button')).toHaveCount(2);
    await chips.getByRole('button', { name: '№3' }).click();
    await expect(page).toHaveURL(/\/transport\/stop\/st_c\?d=16\.09\.26&h=07(%3A|:)00&line=3$/);
    await expect(chips.getByRole('button', { name: '№3' })).toHaveAttribute('aria-pressed', 'true');
    const nums = page.locator('.lt-board-card__route-num');
    await expect(nums.first()).toHaveText('№3');
    await expect(page.locator('.lt-board-card__route-num', { hasText: '№2' })).toHaveCount(0);
    // Картки йдуть перед статтею й FAQ
    const cardsBox = await page.locator('.lt-board-cards').boundingBox();
    const faqBox = await page.getByRole('heading', { name: 'Часті питання' }).boundingBox();
    expect(cardsBox!.y).toBeLessThan(faqBox!.y);
  });

  test.describe('route page on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('departures strip, collapsed full timetable that still prints, «Карта» chip opens the map', async ({ page }) => {
      await page.goto('/transport/route/2?stop=st_a&to=st_c&d=16.09.26&h=08%3A00');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/№2/);
      const strip = page.getByRole('group', { name: 'Відправлення за день' });
      await expect(strip.getByRole('button', { pressed: true })).toHaveText(/08:30/);
      const toggle = page.getByRole('button', { name: 'Повний розклад' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#lt-timetable-full')).toBeHidden();
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('#lt-timetable-full')).toBeVisible();
      await page.emulateMedia({ media: 'screen' });
      await toggle.click();
      await expect(page.locator('#lt-timetable-full')).toBeVisible();
      await expect(page.locator('.lt-map-column')).toBeHidden();
      await page.getByRole('button', { name: 'Карта', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Карта' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Готово' }).click();
      await expect(dialog).toBeHidden();
    });
  });

  test.describe('map on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('«Карта» opens a full-screen map with the stops, «Готово» returns to the list', async ({ page }) => {
      await page.goto('/transport/st_a/st_b?d=16.09.26&h=09%3A12');
      await expect(page.locator('.lt-route-num--card').first()).toBeVisible();
      // На телефоні немає колонки карти й нижнього аркуша — лише кнопка «Карта»
      await expect(page.locator('.lt-map-column')).toHaveCount(0);
      await page.getByRole('button', { name: 'Карта' }).click();
      const dialog = page.getByRole('dialog', { name: 'Карта' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Звідки: Базар · Куди: Вокзал')).toBeVisible();
      await expect(dialog.locator('.leaflet-container')).toBeVisible();
      await expect(dialog.locator('.lt-map-marker')).toHaveCount(6);
      // Тап по маркеру (першому, що в кадрі) → картка зупинки з «Звідси / Сюди / Табло», без попапів і радіального пікера
      const markers = dialog.locator('.lt-map-marker');
      const boxes = await markers.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      const vp = page.viewportSize()!;
      const visibleIdx = boxes.findIndex((b) => b.left > 0 && b.top > 60 && b.right < vp.width && b.bottom < vp.height);
      expect(visibleIdx).toBeGreaterThanOrEqual(0);
      await markers.nth(visibleIdx).click();
      const card = dialog.getByRole('dialog', { name: /^Зупинка / });
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: 'Звідси' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Сюди' })).toBeVisible();
      await expect(card.getByRole('link', { name: 'Табло' })).toHaveAttribute('href', /^\/transport\/stop\/st_/);
      await expect(page.locator('.leaflet-popup, .lt-radial-picker')).toHaveCount(0);
      await page.getByRole('button', { name: 'Готово' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.lt-route-num--card').first()).toBeVisible();
    });
  });

  test.describe('long press with a finger on an Android phone', () => {
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, timezoneId: 'Europe/Kyiv' });

    /** Утримання пальцем (CDP touch): після touchend Chrome на Android ще й «клацає» в те саме місце */
    async function hold(page: Page, target: Locator, ms = 900) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error('target is not visible');
      const cdp = await page.context().newCDPSession(page);
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
    }

    test('the sheet stays open after the finger is lifted and nothing is sent by itself', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-09-16T05:33:00Z')); // 08:33 за Києвом
      const reports: unknown[] = [];
      page.on('request', (r) => {
        if (r.url().endsWith('/transport/arrival-reports') && r.method() === 'POST') reports.push(r.postDataJSON());
      });
      await page.goto('/transport/route/2?stop=st_a&dir=there&d=16.09.26&h=08%3A00');
      const chip = page.getByRole('group', { name: 'Відправлення за день' }).getByRole('button').first();
      await expect(chip).toContainText('08:30');
      await hold(page, chip, 150);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await hold(page, chip);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('№2 · 08:30 за розкладом');

      await page.goto('/transport/stop/st_a?d=16.09.26&h=08%3A00');
      await hold(page, page.locator('.lt-board-card').first());
      await expect(dialog).toContainText('08:30 за розкладом');
      expect(reports).toEqual([]);
      await dialog.getByRole('button', { name: 'Автобус тут — зараз 08:33' }).tap();
      await expect(dialog).toContainText('Дякуємо!');
      expect(reports).toHaveLength(1);
    });
  });

  test('QR sticker: counted once, then the utm mark leaves the address; GA counts no extra page_view', async ({ page }) => {
    const scans: unknown[] = [];
    await page.route(/\/transport\/sticker-scans$/, async (route) => {
      scans.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"counted":true}' });
    });
    await page.goto('/transport/stop/st_a?utm_source=sticker&utm_medium=qr&utm_campaign=st_a-a');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Базар');
    await expect(page).toHaveURL(/\/transport\/stop\/st_a$/);
    expect(scans).toEqual([{ stopId: 'st_a', side: 'a' }]);
    const views = await page.evaluate(() =>
      ((window as unknown as { dataLayer: unknown[] }).dataLayer ?? [])
        .map((x) => Array.from(x as ArrayLike<unknown>))
        .filter((a) => a[0] === 'event' && a[1] === 'page_view')
        .map((a) => (a[2] as { page_location: string }).page_location)
    );
    // dev-сервер у StrictMode шле page_view двічі; головне — немає перегляду без мітки після її зняття
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((v) => v.includes('utm_campaign=st_a-a'))).toBe(true);
    // відновлена вкладка відкриває вже чисту адресу — новий скан не рахується
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Базар');
    expect(scans).toHaveLength(1);
  });

  test.describe('today by the Kyiv clock', () => {
    test.use({ timezoneId: 'Europe/Kyiv' });

    test('result card counts down from now', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-09-16T05:18:00Z')); // 08:18 за Києвом
      await page.goto('/transport/st_a/st_b?d=16.09.26&h=08%3A00');
      await expect(page.getByRole('button', { name: /Маршрут №2/ })).toContainText('через 12 хв');
    });

    test('long press on a departure chip records the actual arrival', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime(new Date('2026-09-16T05:33:00Z')); // 08:33 за Києвом
      await page.goto('/transport/route/2?stop=st_a&dir=there&d=16.09.26&h=08%3A00');
      const strip = page.getByRole('group', { name: 'Відправлення за день' });
      const chip = strip.getByRole('button').first();
      await expect(chip).toContainText('08:30');
      const url = page.url();
      const box = await chip.boundingBox();
      if (!box) throw new Error('chip is not visible');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('№2 · 08:30 за розкладом');
      expect(page.url()).toBe(url);
      const posted = page.waitForRequest((r) => r.url().endsWith('/transport/arrival-reports') && r.method() === 'POST');
      await dialog.getByRole('button', { name: 'Автобус тут — зараз 08:33' }).click();
      expect((await posted).postDataJSON()).toMatchObject({ kind: 'arrived', tripId: expect.any(String), stopId: 'st_a', scheduledTime: '08:30', source: 'route' });
      await expect(dialog).toContainText('Записали: автобус приїхав о 08:33 — запізнення 3 хв.');
    });
  });
});
