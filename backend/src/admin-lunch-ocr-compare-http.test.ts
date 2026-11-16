/**
 * Порівняння моделей розпізнавання на фото дня: POST ставить задачу слухачеві, GET читає її стан і звіт.
 * Слухача й Claude тут немає — лише черга LunchAdminJob на стабі.
 */
import { describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createAdminLunchRouter } from './routes/admin-lunch';
import { adminAuthToken, setAdminPassword } from './middleware/require-admin';
import { LUNCH_OCR_COMPARE_MODELS, parseOcrCompareRequest } from './lunch-reparse';
import { formatCashLine, formatOrderConfirmText } from './lunch';

const PASSWORD = 'ocr-compare-test';
const auth = { Authorization: adminAuthToken(PASSWORD) };

type JobRow = {
  id: number;
  type: string;
  status: string;
  paramsJson: string | null;
  resultJson: string | null;
  errorText: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

function setup(opts: { listener?: boolean; key?: string } = {}) {
  const jobs: JobRow[] = [];
  const prisma = {
    lunchAdminJob: {
      findFirst: async (args: { where: { type: string; status: { in: string[] } } }) =>
        jobs.find((j) => j.type === args.where.type && args.where.status.in.includes(j.status)) ?? null,
      create: async ({ data }: { data: { type: string; status: string; paramsJson: string } }) => {
        const row: JobRow = {
          id: jobs.length + 1,
          resultJson: null,
          errorText: null,
          createdAt: new Date('2026-11-16T10:00:00Z'),
          finishedAt: null,
          ...data,
        };
        jobs.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: number } }) => jobs.find((j) => j.id === where.id) ?? null,
    },
  } as unknown as PrismaClient;
  const app = express();
  setAdminPassword(app, PASSWORD);
  app.use(express.json());
  app.use(
    createAdminLunchRouter({
      prisma,
      listenerWanted: () => opts.listener ?? true,
      env: { ANTHROPIC_API_KEY: opts.key ?? 'sk-test' },
    }),
  );
  return { app, jobs };
}

describe('parseOcrCompareRequest', () => {
  test('за замовчуванням — сьогодні й усі три моделі, еталон перший', () => {
    expect(parseOcrCompareRequest({}, '2026-11-16')).toEqual({ date: '2026-11-16', models: [...LUNCH_OCR_COMPARE_MODELS] });
    expect(LUNCH_OCR_COMPARE_MODELS[0]).toBe('claude-opus-5-5');
  });

  test('моделі — підмножина дозволених у сталому порядку, щонайменше дві', () => {
    expect(
      parseOcrCompareRequest({ date: '2026-11-12', models: ['claude-haiku-5-5', 'claude-opus-5-5'] }, '2026-11-16'),
    ).toEqual({ date: '2026-11-12', models: ['claude-opus-5-5', 'claude-haiku-5-5'] });
    expect(() => parseOcrCompareRequest({ models: ['claude-haiku-5-5'] }, '2026-11-16')).toThrow(/дві моделі/);
    expect(() => parseOcrCompareRequest({ models: ['gpt-4o', 'claude-opus-5-5'] }, '2026-11-16')).toThrow(/Невідома модель: gpt-4o/);
    expect(() => parseOcrCompareRequest({ models: 'claude-opus-5-5' }, '2026-11-16')).toThrow(/список/);
  });

  test('дата: формат і не майбутня', () => {
    expect(() => parseOcrCompareRequest({ date: '16.11.2026' }, '2026-11-16')).toThrow(/YYYY-MM-DD/);
    expect(() => parseOcrCompareRequest({ date: '2026-11-17' }, '2026-11-16')).toThrow(/майбутньому/);
  });
});

describe('/admin/lunch/ocr-compare', () => {
  test('401 без токена', async () => {
    const { app } = setup();
    await request(app).post('/admin/lunch/ocr-compare').send({}).expect(401);
    await request(app).get('/admin/lunch/ocr-compare/1').expect(401);
  });

  test('POST ставить задачу; друга, поки перша в роботі, — 409; GET віддає звіт лише готової', async () => {
    const { app, jobs } = setup();
    const created = await request(app)
      .post('/admin/lunch/ocr-compare')
      .set(auth)
      .send({ date: '2026-11-12', models: ['claude-opus-5-5', 'claude-haiku-5-5'] })
      .expect(201);
    expect(created.body.job).toMatchObject({ id: 1, status: 'pending', result: null, error: null });
    expect(JSON.parse(jobs[0].paramsJson as string)).toEqual({ date: '2026-11-12', models: ['claude-opus-5-5', 'claude-haiku-5-5'] });
    expect(jobs[0].type).toBe('ocr_compare');

    const busy = await request(app).post('/admin/lunch/ocr-compare').set(auth).send({ date: '2026-11-12' }).expect(409);
    expect(busy.body.error).toMatch(/№1/);

    jobs[0].status = 'running';
    expect((await request(app).get('/admin/lunch/ocr-compare/1').set(auth).expect(200)).body.job.status).toBe('running');

    jobs[0].status = 'done';
    jobs[0].resultJson = JSON.stringify({ date: '2026-11-12', baseline: 'claude-opus-5-5', media: [], summary: [] });
    jobs[0].finishedAt = new Date('2026-11-16T10:01:00Z');
    const done = await request(app).get('/admin/lunch/ocr-compare/1').set(auth).expect(200);
    expect(done.body.job).toMatchObject({ status: 'done', result: { baseline: 'claude-opus-5-5' }, finishedAt: '2026-11-16T10:01:00.000Z' });

    // після завершення можна запускати знову; невдала задача віддає причину
    await request(app).post('/admin/lunch/ocr-compare').set(auth).send({ date: '2026-11-13' }).expect(201);
    jobs[1].status = 'failed';
    jobs[1].errorText = 'слухача перезапущено — запустіть ще раз';
    const failed = await request(app).get('/admin/lunch/ocr-compare/2').set(auth).expect(200);
    expect(failed.body.job).toMatchObject({ status: 'failed', result: null, error: 'слухача перезапущено — запустіть ще раз' });
  });

  test('некоректні запити й чужі задачі', async () => {
    const { app, jobs } = setup();
    await request(app).post('/admin/lunch/ocr-compare').set(auth).send({ date: 'вчора' }).expect(400);
    await request(app).post('/admin/lunch/ocr-compare').set(auth).send({ models: ['claude-opus-5-5'] }).expect(400);
    await request(app).get('/admin/lunch/ocr-compare/abc').set(auth).expect(400);
    await request(app).get('/admin/lunch/ocr-compare/7').set(auth).expect(404);
    jobs.push({ id: 1, type: 'reparse_today', status: 'done', paramsJson: null, resultJson: '{}', errorText: null, createdAt: new Date(), finishedAt: null });
    await request(app).get('/admin/lunch/ocr-compare/1').set(auth).expect(404); // розбір дня — не порівняння
  });

  test('без слухача або без ключа Claude — 409 і задачі немає', async () => {
    const off = setup({ listener: false });
    expect((await request(off.app).post('/admin/lunch/ocr-compare').set(auth).send({}).expect(409)).body.error).toMatch(/Слухач/);
    const noKey = setup({ key: ' ' });
    expect((await request(noKey.app).post('/admin/lunch/ocr-compare').set(auth).send({}).expect(409)).body.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(off.jobs).toEqual([]);
    expect(noKey.jobs).toEqual([]);
  });
});

describe('formatCashLine', () => {
  test('«💵 Готівкою», поки людина не розрахувалась', () => {
    expect(formatCashLine(155, 0, true)).toBe('💵 Готівкою');
    expect(formatCashLine(155, 100, true)).toBe('💵 Готівкою');
    expect(formatCashLine(155, 155, true)).toBeNull();
    expect(formatCashLine(155, 0, false)).toBeNull();
  });

  test('у відповіді на замовлення — після «Разом» і рядка про часткову оплату', () => {
    const base = {
      displayName: 'Аліна',
      lines: [{ menuItemName: 'Пюре', qty: 1, unitPriceUah: 45, lineTotalUah: 45 }],
      foodTotal: 45,
      trayCount: 1,
      trayPriceUah: 5,
      trayTotalUah: 5,
      totalUah: 50,
    };
    expect(formatOrderConfirmText({ ...base, cashPromised: true })).toBe(
      'Аліна, заказ:\n• Пюре — 45 грн (45/шт)\nЛотки: 1 × 5 = 5 грн\nРазом: 50 грн\n💵 Готівкою',
    );
    expect(formatOrderConfirmText({ ...base, cashPromised: true, paidUah: 20 })).toMatch(
      /Оплатив 20 грн, залишок 30 грн\n💵 Готівкою$/,
    );
    expect(formatOrderConfirmText({ ...base, cashPromised: true, paidUah: 50 })).toMatch(/Разом: 50 грн\n✅ Оплатив$/);
  });
});
