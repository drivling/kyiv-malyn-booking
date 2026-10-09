/**
 * HTTP-даун-тести Express через supertest (без listen, без реальної БД для цих маршрутів).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp, CODE_VERSION } from './create-app';
import { createNoDbPrismaStub, examplePersonRow, exampleViberListingRow } from './http-test-prisma-stub';
import { adminAuthToken } from './middleware/require-admin';
import { stickerWallKey } from './sticker-wall';

const TEST_ADMIN_PASSWORD = 'http-test-admin-password-x7';

function smokeApp() {
  return createApp({
    prisma: createNoDbPrismaStub(),
    adminPassword: TEST_ADMIN_PASSWORD,
  });
}

test('GET /health', async () => {
  const res = await request(smokeApp()).get('/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.version, 3);
  assert.equal(res.body.viber, true);
  assert.equal(res.body.codeVersion, CODE_VERSION);
  assert.equal(res.headers['cache-control'], 'no-store, no-cache, must-revalidate');
});

test('GET /status', async () => {
  const res = await request(smokeApp()).get('/status').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.codeVersion, CODE_VERSION);
});

test('POST /admin/login: успіх з паролем з deps', async () => {
  const res = await request(smokeApp())
    .post('/admin/login')
    .send({ password: TEST_ADMIN_PASSWORD })
    .expect(200);
  assert.equal(res.body.success, true);
  assert.match(res.body.token, /^[0-9a-f]{64}$/);
  assert.equal(res.body.token, adminAuthToken(TEST_ADMIN_PASSWORD));
});

test('POST /admin/login: відмова при невірному паролі', async () => {
  const res = await request(smokeApp())
    .post('/admin/login')
    .send({ password: 'wrong-password' })
    .expect(401);
  assert.ok(res.body.error);
});

test('GET /admin/check: токен з login проходить requireAdmin', async () => {
  const app = smokeApp();
  const login = await request(app)
    .post('/admin/login')
    .send({ password: TEST_ADMIN_PASSWORD })
    .expect(200);
  const check = await request(app)
    .get('/admin/check')
    .set('Authorization', String(login.body.token))
    .expect(200);
  assert.equal(check.body.authenticated, true);
});

test('GET /admin/check: стара константа, токен іншого пароля і ключ віджета — 401', async () => {
  const app = smokeApp();
  for (const token of [
    'admin-authenticated',
    adminAuthToken('other-password'),
    stickerWallKey(TEST_ADMIN_PASSWORD),
    TEST_ADMIN_PASSWORD,
  ]) {
    await request(app).get('/admin/check').set('Authorization', token).expect(401);
  }
  await request(app).get('/admin/check').expect(401);
});

test('POST /admin/login: без тіла чи з паролем не-рядком — 401', async () => {
  await request(smokeApp()).post('/admin/login').expect(401);
  await request(smokeApp()).post('/admin/login').send({ password: ['x'] }).expect(401);
});

test('фікстури: формати як у живій БД (документація для моків)', () => {
  assert.match(examplePersonRow.phoneNormalized, /^380\d{9}$/);
  assert.equal(exampleViberListingRow.listingType, 'driver');
  assert.ok(String(exampleViberListingRow.route).length > 0);
});
