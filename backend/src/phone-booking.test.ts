import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { isPhoneOnlyBooking, phoneOnlyNoticeHtml, phoneOnlyNoticeText, phoneOnlySms, phoneOnlyToast, zubastykPhones } from './phone-booking';
import { ZUBASTYK_PHONES_DEFAULT, createZubastykPhonesStore, parseZubastykPhones, phoneDigits, phoneLabel, resetZubastykPhonesForTests } from './zubastyk-phones';
import { createSiteSettingsRouter } from './routes/site-settings';
import { adminAuthToken, setAdminPassword } from './middleware/require-admin';

afterEach(() => resetZubastykPhonesForTests());

test('isPhoneOnlyBooking: лише маршрутки Київ ↔ Малин («Зубастик»)', () => {
  for (const route of ['Kyiv-Malyn-Irpin', 'Malyn-Kyiv-Irpin', 'Kyiv-Malyn-Bucha', 'Malyn-Kyiv-Bucha']) {
    assert.equal(isPhoneOnlyBooking({ route, vehicleType: 'marshrutka' }), true, route);
    assert.equal(isPhoneOnlyBooking({ route, source: 'schedule' }), true, route);
  }
  // електрички мають ті самі slug-и коридору
  assert.equal(isPhoneOnlyBooking({ route: 'Kyiv-Malyn', vehicleType: 'elektrichka' }), false);
  // попутка на тому ж напрямку — не «Зубастик»
  assert.equal(isPhoneOnlyBooking({ route: 'Kyiv-Malyn', source: 'viber_match' }), false);
  for (const route of ['Malyn-Zhytomyr-Potiivka', 'Korosten-Malyn', 'Kyiv-Korosten', 'Kyiv-Malynivka', '', null]) {
    assert.equal(isPhoneOnlyBooking({ route, vehicleType: 'marshrutka' }), false, String(route));
  }
});

test('тексти «лише за телефоном» несуть номери «Зубастика»', () => {
  assert.equal(zubastykPhones(), ZUBASTYK_PHONES_DEFAULT);
  assert.equal(zubastykPhones().length, 4);
  for (const p of zubastykPhones()) {
    assert.match(p.digits, /^380\d{9}$/);
    assert.ok(phoneOnlyNoticeText().includes(p.label), p.label);
    assert.ok(phoneOnlyNoticeHtml().includes(`href="tel:+${p.digits}"`), p.digits);
  }
  assert.match(phoneOnlyNoticeText(), /поки не працює/);
  assert.match(phoneOnlyNoticeText(), /лише за телефоном/);
  assert.match(phoneOnlyNoticeHtml(), /093 170 18 35<\/a> \(резервний\)/);
  assert.equal(phoneOnlySms(), 'Онлайн-бронь поки не працює — лише за тел. 0931920008, 0961420008.');
  // answerCallbackQuery приймає до 200 символів
  assert.ok(phoneOnlyToast().length <= 200);
});

test('номер як пишуть люди → цифри й підпис; список з адмінки перевіряємо', () => {
  assert.equal(phoneDigits('093 192 00 08'), '380931920008');
  assert.equal(phoneDigits('+38 (096) 142-00-08'), '380961420008');
  assert.equal(phoneDigits('12345'), null);
  assert.equal(phoneLabel('380661620008'), '066 162 00 08');
  assert.deepEqual(parseZubastykPhones([{ phone: '0671112233' }, { phone: '+380931701835', note: ' резервний ' }]), [
    { digits: '380671112233', label: '067 111 22 33' },
    { digits: '380931701835', label: '093 170 18 35', note: 'резервний' },
  ]);
  assert.throws(() => parseZubastykPhones([]), /від 1 до 6/);
  assert.throws(() => parseZubastykPhones([{ phone: '123' }]), /номер 1/);
  assert.throws(() => parseZubastykPhones([{ phone: '0671112233' }, { phone: '+380671112233' }]), /двічі/);
});

/** `SiteSetting` у памʼяті */
function fakePrisma() {
  const rows = new Map<string, { key: string; value: unknown; updatedAt: Date }>();
  const prisma = {
    siteSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      upsert: async ({ where, create, update }: { where: { key: string }; create: { key: string; value: unknown }; update: { value: unknown } }) => {
        const row = { key: where.key, value: (rows.has(where.key) ? update : create).value, updatedAt: new Date('2026-11-19T10:00:00.000Z') };
        rows.set(where.key, row);
        return row;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

test('номери з адмінки — одразу в текстах бота, SMS і API; «типові» — назад до коду', async () => {
  const db = fakePrisma();
  const store = createZubastykPhonesStore(db.prisma);
  await store.refresh();
  assert.equal(store.view().changed, false);
  const v = await store.set([{ phone: '067 111 22 33' }, { phone: '050 222 33 44' }, { phone: '093 170 18 35', note: 'резервний' }]);
  assert.equal(v.changed, true);
  assert.deepEqual(db.rows.get('zubastyk.phones')?.value, { phones: v.phones });
  assert.match(phoneOnlyNoticeText(), /067 111 22 33, 050 222 33 44, 093 170 18 35 \(резервний\)/);
  assert.equal(phoneOnlySms(), 'Онлайн-бронь поки не працює — лише за тел. 0671112233, 0502223344.');
  assert.match(phoneOnlyToast(), /зателефонуйте 067 111 22 33/);
  await store.set(null);
  assert.equal(zubastykPhones(), ZUBASTYK_PHONES_DEFAULT);
  assert.deepEqual(db.rows.get('zubastyk.phones')?.value, {});
});

test('HTTP: номери бачать усі; міняє лише адмін', async () => {
  const db = fakePrisma();
  const app = express();
  app.use(express.json());
  setAdminPassword(app, 'phones-test');
  const AUTH = adminAuthToken('phones-test');
  app.use(createSiteSettingsRouter({ prisma: db.prisma }));
  const pub = await request(app).get('/site/zubastyk-phones');
  assert.equal(pub.status, 200);
  assert.equal(pub.headers['cache-control'], 'public, max-age=300');
  assert.equal(pub.body.phones.length, 4);
  assert.equal((await request(app).put('/admin/site/zubastyk-phones').send({ reset: true })).status, 401);
  assert.equal((await request(app).put('/admin/site/zubastyk-phones').set('Authorization', AUTH).send({})).status, 400);
  const bad = await request(app).put('/admin/site/zubastyk-phones').set('Authorization', AUTH).send({ phones: [{ phone: '1' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /номер 1/);
  const ok = await request(app).put('/admin/site/zubastyk-phones').set('Authorization', AUTH).send({ phones: [{ phone: '0671112233' }] });
  assert.equal(ok.body.changed, true);
  assert.deepEqual((await request(app).get('/site/zubastyk-phones')).body.phones, [{ digits: '380671112233', label: '067 111 22 33' }]);
  const admin = await request(app).get('/admin/site/zubastyk-phones').set('Authorization', AUTH);
  assert.equal(admin.body.defaults.length, 4);
});
