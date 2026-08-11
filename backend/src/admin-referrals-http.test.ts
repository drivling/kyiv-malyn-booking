/**
 * HTTP: GET /admin/referrals/report (auth + empty-report stub).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';

const TEST_ADMIN_PASSWORD = 'http-test-admin-password-x7';

function emptyAggregate() {
  return Promise.resolve({ _sum: { amountUah: 0 }, _count: { _all: 0 } });
}

function app() {
  return createApp({
    prisma: createReferralReportPrismaStub(),
    adminPassword: TEST_ADMIN_PASSWORD,
  });
}

/** Minimal Prisma surface for buildAdminReferralReport with empty data. */
function createReferralReportPrismaStub(): PrismaClient {
  return {
    referralProgramSettings: {
      findFirst: async () => ({ id: 1, budgetUah: 10_000 }),
      create: async () => ({ id: 1, budgetUah: 10_000 }),
    },
    referralReward: {
      aggregate: emptyAggregate,
      groupBy: async () => [],
      findMany: async () => [],
    },
    person: {
      count: async () => 0,
      findMany: async () => [],
      findUnique: async () => null,
      findFirst: async () => null,
    },
    referralInvite: {
      findMany: async () => [],
      count: async () => 0,
    },
    rideCompletionProof: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
}

test('GET /admin/referrals/report: 401 without token', async () => {
  await request(app()).get('/admin/referrals/report').expect(401);
});

test('GET /admin/referrals/report: 200 empty report with admin token', async () => {
  const a = app();
  const login = await request(a)
    .post('/admin/login')
    .send({ password: TEST_ADMIN_PASSWORD })
    .expect(200);

  const res = await request(a)
    .get('/admin/referrals/report')
    .set('Authorization', String(login.body.token))
    .expect(200);

  assert.equal(res.body.summary.totalRewards, 0);
  assert.equal(res.body.summary.referredPersonsCount, 0);
  assert.equal(res.body.budget.budgetUah, 10_000);
  assert.ok(Array.isArray(res.body.flagged));
  assert.ok(Array.isArray(res.body.payoutBalances));
  assert.equal(res.body.invites.total, 0);
});
