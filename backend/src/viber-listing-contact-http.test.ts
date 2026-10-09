/**
 * HTTP: GET /viber-listings/:id/contact — контакт автора оголошення окремим запитом.
 * На сторінках сайту контакт не рендериться, тож у DOM і в статичному HTML його немає.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';

const TEST_ADMIN_PASSWORD = 'http-test-admin-password-x7';

function appWith(row: { phone: string; isActive: boolean } | null) {
  const prisma = {
    viberListing: { findUnique: async () => row },
  } as unknown as PrismaClient;
  return createApp({ prisma, adminPassword: TEST_ADMIN_PASSWORD });
}

test('віддає контакт активного оголошення без авторизації', async () => {
  const res = await request(appWith({ phone: '380679551952', isActive: true }))
    .get('/viber-listings/42/contact')
    .expect(200);
  assert.equal(res.body.contact, '380679551952');
});

test('віддає @username так само, як телефон', async () => {
  const res = await request(appWith({ phone: '@driver_ua', isActive: true }))
    .get('/viber-listings/42/contact')
    .expect(200);
  assert.equal(res.body.contact, '@driver_ua');
});

test('404 для неактивного оголошення — знятий або заблокований автор', async () => {
  await request(appWith({ phone: '380679551952', isActive: false }))
    .get('/viber-listings/42/contact')
    .expect(404);
});

test('404, якщо оголошення немає', async () => {
  await request(appWith(null)).get('/viber-listings/999/contact').expect(404);
});

test('404, якщо контакт порожній', async () => {
  await request(appWith({ phone: '   ', isActive: true }))
    .get('/viber-listings/42/contact')
    .expect(404);
});

test('400 на нечисловий id', async () => {
  await request(appWith(null)).get('/viber-listings/abc/contact').expect(400);
});
