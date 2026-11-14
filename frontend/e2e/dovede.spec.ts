import { test, expect, type Page } from '@playwright/test';
import { dismissCookieNotice, mockBackendApi } from './helpers';

const TRAIN = {
  id: 2,
  route: 'Kyiv-Malyn',
  departureTime: '14:51',
  arrivalTime: '17:11',
  durationMinutes: 140,
  vehicleType: 'elektrichka',
  boardingPlace: 'Київ-Пас. (Приміський)',
  alightingPlace: 'Малин',
  tripNumber: '6613',
  priceUah: 60,
  ticketPurchaseUrl: 'https://example.com/ticket',
  activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  maxSeats: 20,
  supportPhone: null,
  createdAt: '',
  updatedAt: '',
};

/**
 * Доступ уже є (пароль запрошених чи адмін): GET /dovede/access відповідає allowed; розклад коридору й
 * відповідь Claude — заглушки. `calls` — тіла запитів до Claude, `tokens` — їхній X-Dovede-Token.
 */
async function openWithAccess(page: Page, understand: { status: number; body: unknown } = { status: 503, body: { fallback: 'local', reason: 'no_key' } }) {
  await dismissCookieNotice(page);
  await mockBackendApi(page);
  const calls: string[] = [];
  const tokens: (string | undefined)[] = [];
  await page.route(/(localhost|127\.0\.0\.1):3000\/poputky\/search/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ from: null, to: null, date: '', listings: [], schedules: [TRAIN], availability: {} }) }),
  );
  await page.route(/(localhost|127\.0\.0\.1):3000\/dovede\/access/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ open: false, allowed: true }) }),
  );
  await page.route(/(localhost|127\.0\.0\.1):3000\/dovede\/understand/, (route) => {
    calls.push(route.request().postData() ?? '');
    tokens.push(route.request().headers()['x-dovede-token']);
    return route.fulfill({ status: understand.status, contentType: 'application/json', body: JSON.stringify(understand.body) });
  });
  // пʼятниця 13.11.2026, 14:20 за Києвом — як у еталонах
  await page.clock.setFixedTime(new Date('2026-11-13T12:20:00Z'));
  return { calls, tokens };
}

test.describe('«Доведе» (/dovede, за паролем запрошених)', () => {
  test('без доступу рядок питання просить пароль («Hasło»); вірний пароль відкриває пошук; шапки сайту немає', async ({ page }) => {
    const { tokens } = await openWithAccess(page);
    let logins = 0;
    await page.route(/(localhost|127\.0\.0\.1):3000\/dovede\/access/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ open: false, allowed: false }) }),
    );
    await page.route(/(localhost|127\.0\.0\.1):3000\/dovede\/login/, (route) => {
      logins++;
      const { password } = JSON.parse(route.request().postData() ?? '{}');
      return password === 'гість'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'guest-token' }) })
        : route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Невірний пароль' }) });
    });
    await page.goto('/dovede');

    await expect(page.getByRole('navigation', { name: 'Головне меню' })).toHaveCount(0);
    const password = page.getByLabel('Пароль');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(page.getByLabel('Куди вам потрібно доїхати?')).toHaveCount(0);
    await expect(page.getByText(/Таємна сторінка/)).toHaveCount(0);

    await password.fill('не той');
    await page.getByRole('button', { name: 'Hasło' }).click();
    await expect(page.getByRole('alert')).toHaveText('Невірний пароль');

    await password.fill('гість');
    await password.press('Enter');
    const field = page.getByLabel('Куди вам потрібно доїхати?');
    await expect(field).toBeVisible();
    expect(logins).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem('dovede-token:v1'))).toBe('guest-token');

    // токен гостя йде в X-Dovede-Token запиту до Claude
    await field.fill('хочу потягом зі святошина до залізки');
    await page.getByRole('button', { name: 'Знайти' }).click();
    await expect.poll(() => tokens.length).toBe(1);
    expect(tokens[0]).toBe('guest-token');
  });

  test('питання → підказка місця → історія; адреса з id і словами питання, перезавантаження лишає фразу', async ({ page }) => {
    await openWithAccess(page);
    await page.goto('/dovede');
    const field = page.getByLabel('Куди вам потрібно доїхати?');
    await field.pressSequentially('електричкою з Києва до вокз');

    // підказка доповнює слово під курсором, відмінок — за прийменником «до»
    await expect(page.getByRole('option', { name: 'Малин · вокзал' })).toBeVisible();
    await page.getByRole('option', { name: 'Малин · вокзал' }).click();
    await expect(field).toHaveValue('електричкою з Києва до вокзалу ');
    await expect(page.getByLabel('Як зрозуміло питання')).toContainText('Малин · вокзал');

    await field.press('Enter');
    await expect(page.getByText('Електричка 6613 · Київ — Малин')).toBeVisible();
    await expect(page).toHaveURL(/\/dovede\?f=city\.Kyiv&t=malyn\.vokzal&d=2026-11-13&m=elektrichka&q=/);
    expect(new URL(page.url()).searchParams.get('q')).toBe('електричкою з Києва до вокзалу');

    // перезавантаження: та сама відповідь і та сама фраза з підсвіткою
    await page.reload();
    await expect(page.getByText('Електричка 6613 · Київ — Малин')).toBeVisible();
    await expect(page.getByLabel('Куди вам потрібно доїхати?')).toHaveValue('електричкою з Києва до вокзалу');
  });

  test('слот «Розумію…» виправляється в панелі, Esc її закриває', async ({ page }) => {
    await openWithAccess(page);
    await page.goto('/dovede?t=malyn.vokzal&d=2026-11-13');
    await expect(page.getByText('Звідки вирушаєте?')).toBeVisible();

    // після відповіді рядок «Розумію…» згорнутий «під кат» — слоти відкриває рядок-підсумок
    const summary = page.getByRole('button', { name: /змінити/ });
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: /Змінити, звідки/ })).toBeHidden();
    await summary.click();
    await page.getByRole('button', { name: /Змінити, звідки/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Звідки вирушаєте?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: /Змінити, звідки/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Святошин' }).click();
    // нова відповідь — слоти знову згорнуті, у підсумку нове місце
    await expect(page.getByRole('button', { name: /Київ · Святошин → Малин · вокзал.*змінити/ })).toBeVisible();
    await expect(page.getByText('Електричка 6613 · Київ — Малин')).toBeVisible();
    await expect(page).toHaveURL(/f=kyiv\.sviatoshyn&t=malyn\.vokzal/);
  });

  test('Claude розуміє те, чого не знає словник; текст питання йде лише в тіло запиту', async ({ page }) => {
    const { calls } = await openWithAccess(page, {
      status: 200,
      body: {
        intent: { intent: 'trip', from: { id: 'kyiv.sviatoshyn', text: 'святошина' }, to: { id: 'malyn.vokzal', text: 'залізки' }, when: { day: 'today', kind: 'depart' }, modes: ['elektrichka'], unknown: [], confidence: 'high' },
        agree: false,
        model: 'claude-opus-5-5',
        latencyMs: 900,
      },
    });
    await page.goto('/dovede');
    await page.getByLabel('Куди вам потрібно доїхати?').fill('хочу потягом зі святошина до залізки');
    await page.getByRole('button', { name: 'Знайти' }).click();

    await expect(page.getByText('Електричка 6613 · Київ — Малин')).toBeVisible();
    await expect(page.getByLabel('Як зрозуміло питання')).toContainText('Київ · Святошин');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]).text).toBe('хочу потягом зі святошина до залізки');
  });
  test('питання про маршрут: картка з найближчими відправленнями й посиланням на сторінку маршруту', async ({ page }) => {
    const { calls } = await openWithAccess(page);
    await page.goto('/dovede');
    await page.getByLabel('Куди вам потрібно доїхати?').fill('куди їде автобус №2');
    await page.getByRole('button', { name: 'Знайти' }).click();

    await expect(page.getByText('Міський автобус №2')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Розклад і зупинки маршруту →' })).toHaveAttribute('href', /^\/transport\/route\/2\?d=/);
    await expect(page).toHaveURL(/[?&]r=2(&|$)/);
    // номер маршруту словник розуміє сам — Claude лише перевіряє у фоні
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});
