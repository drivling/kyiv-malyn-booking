import { describe, expect, it, vi } from 'vitest';
import { createNotificationWorker, enqueueListingMatch, retryDelayMs, type NotificationJobRow } from './notification-queue';

/** Мінімальна in-memory модель NotificationJob для воркера. */
function memoryQueue(seed: Partial<NotificationJobRow>[] = []) {
  let nextId = 1;
  const rows: NotificationJobRow[] = seed.map((r) => ({
    id: nextId++,
    kind: 'listing_match',
    payload: {},
    status: 'pending',
    attempts: 0,
    runAfter: new Date(0),
    lockedAt: null,
    ...r,
  }));
  const matches = (row: NotificationJobRow, where: any): boolean => {
    if (where.OR) return where.OR.some((w: any) => matches(row, w));
    if (where.id != null && row.id !== where.id) return false;
    if (where.status != null && row.status !== where.status) return false;
    if (where.attempts != null && row.attempts !== where.attempts) return false;
    if (where.runAfter?.lte && !(row.runAfter <= where.runAfter.lte)) return false;
    if (where.lockedAt?.lt && !(row.lockedAt && row.lockedAt < where.lockedAt.lt)) return false;
    return true;
  };
  const apply = (row: NotificationJobRow, data: any) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as object)) (row as any)[k] += (v as any).increment;
      else (row as any)[k] = v;
    }
  };
  const notificationJob = {
    create: vi.fn(async ({ data }: any) => {
      const row = { id: nextId++, status: 'pending', attempts: 0, runAfter: new Date(0), lockedAt: null, ...data };
      rows.push(row);
      return row;
    }),
    // Як Prisma: повертаємо знімок, а не живий рядок
    findFirst: vi.fn(async ({ where }: any) => {
      const row = rows.filter((r) => matches(r, where)).sort((a, b) => a.id - b.id)[0];
      return row ? { ...row } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      apply(row, data);
      return row;
    }),
  };
  return { prisma: { notificationJob }, rows };
}

describe('enqueueListingMatch', () => {
  it('створює job з listingId і authorChatId; без моделі — null і без падіння', async () => {
    const { prisma, rows } = memoryQueue();
    const job = await enqueueListingMatch(prisma, 42, '777');
    expect(job?.id).toBe(1);
    expect(rows[0]).toMatchObject({ kind: 'listing_match', payload: { listingId: 42, authorChatId: '777' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await enqueueListingMatch({}, 1)).toBeNull();
    warn.mockRestore();
  });
});

describe('createNotificationWorker', () => {
  it('забирає pending по черзі, виконує обробник і позначає done', async () => {
    const { prisma, rows } = memoryQueue([{ payload: { listingId: 1 } }, { payload: { listingId: 2 } }]);
    const handled: number[] = [];
    const worker = createNotificationWorker(
      prisma,
      { listing_match: async (job) => void handled.push((job.payload as { listingId: number }).listingId) },
      { log: () => {} },
    );
    expect(await worker.tick()).toBe(2);
    expect(handled).toEqual([1, 2]);
    expect(rows.map((r) => r.status)).toEqual(['done', 'done']);
    expect(rows[0].attempts).toBe(1);
    expect(await worker.tick()).toBe(0);
  });

  it('помилка → pending з бекофом; після maxAttempts → failed; невідомий kind теж fail', async () => {
    const t0 = new Date('2026-12-01T10:00:00.000Z');
    let now = t0;
    const { prisma, rows } = memoryQueue([{ payload: {} }, { kind: 'unknown' }]);
    const worker = createNotificationWorker(
      prisma,
      { listing_match: async () => { throw new Error('boom'); } },
      { maxAttempts: 2, now: () => now, log: () => {} },
    );
    expect(await worker.tick()).toBe(2);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'boom' });
    expect(rows[0].runAfter.getTime()).toBe(t0.getTime() + retryDelayMs(1));
    expect(rows[1]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(rows[1].lastError).toContain('no handler');
    // ще не час — не беремо
    expect(await worker.tick()).toBe(0);
    now = new Date(t0.getTime() + retryDelayMs(1) + 1);
    expect(await worker.tick()).toBe(2);
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('завислий running (краш процесу) забирається знову після staleMs', async () => {
    const t0 = new Date('2026-12-01T10:00:00.000Z');
    const { prisma, rows } = memoryQueue([
      { status: 'running', attempts: 1, lockedAt: new Date(t0.getTime() - 20 * 60_000) },
      { status: 'running', attempts: 1, lockedAt: new Date(t0.getTime() - 1 * 60_000) },
    ]);
    const worker = createNotificationWorker(prisma, { listing_match: async () => {} }, { now: () => t0, log: () => {} });
    expect(await worker.tick()).toBe(1);
    expect(rows[0].status).toBe('done');
    expect(rows[1].status).toBe('running');
  });

  it('retryDelayMs: 1, 2, 4 хв… до 60', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(retryDelayMs(20)).toBe(60 * 60_000);
  });
});
