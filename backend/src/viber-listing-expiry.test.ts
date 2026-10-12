import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  LISTING_GRACE_MS,
  deactivateExpiredListings,
  getListingEndsAt,
  isListingExpired,
  kyivWallToUtc,
  notExpiredWhere,
} from './viber-listing-expiry';

describe('kyivWallToUtc', () => {
  it('літо UTC+3, зима UTC+2', () => {
    expect(kyivWallToUtc(2026, 6, 15, 14, 30).toISOString()).toBe('2026-07-15T11:30:00.000Z');
    expect(kyivWallToUtc(2026, 0, 15, 14, 30).toISOString()).toBe('2026-01-15T12:30:00.000Z');
  });
  it('перехід на зимовий час 2026-10-25 (03:00→04:00 → 00:00 UTC зсув 3→2)', () => {
    expect(kyivWallToUtc(2026, 9, 24, 23, 59).toISOString()).toBe('2026-10-24T20:59:00.000Z');
    expect(kyivWallToUtc(2026, 9, 25, 12, 0).toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });
  it('перехід на літній час 2026-03-29', () => {
    expect(kyivWallToUtc(2026, 2, 29, 12, 0).toISOString()).toBe('2026-03-29T09:00:00.000Z');
    expect(kyivWallToUtc(2026, 2, 28, 12, 0).toISOString()).toBe('2026-03-28T10:00:00.000Z');
  });
});

describe('getListingEndsAt', () => {
  const day = new Date(2026, 9, 12); // доба поїздки в локальному часі процесу
  it('один час / діапазон / без часу', () => {
    expect(getListingEndsAt(day, '15:00').toISOString()).toBe('2026-10-12T12:00:00.000Z');
    expect(getListingEndsAt(day, '9:05-16:40').toISOString()).toBe('2026-10-12T13:40:00.000Z');
    expect(getListingEndsAt(day, null).toISOString()).toBe('2026-10-12T20:59:00.000Z');
    expect(getListingEndsAt(day, 'вранці').toISOString()).toBe('2026-10-12T20:59:00.000Z');
  });
});

describe('notExpiredWhere / isListingExpired', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  it('межа = endsAt ≥ now − 1 год або endsAt null', () => {
    expect(notExpiredWhere(now)).toEqual({
      OR: [{ endsAt: { gte: new Date(now.getTime() - LISTING_GRACE_MS) } }, { endsAt: null }],
    });
  });
  it('рівно 1 год після кінця ще видно, далі — ні', () => {
    expect(isListingExpired(new Date(now.getTime() - LISTING_GRACE_MS), now)).toBe(false);
    expect(isListingExpired(new Date(now.getTime() - LISTING_GRACE_MS - 1), now)).toBe(true);
    expect(isListingExpired(null, now)).toBe(false);
  });
});

describe('deactivateExpiredListings', () => {
  it('деактивує за endsAt, добирає рядки без endsAt і закриває прострочені запити', async () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const updateMany = vi.fn(async (_a: unknown) => ({ count: 2 }));
    const findMany = vi.fn(async () => [
      { id: 7, date: new Date(2026, 9, 12), departureTime: '10:00' }, // 07:00Z + 1h < 12:00Z → протерміновано
      { id: 8, date: new Date(2026, 9, 12), departureTime: '20:00' }, // ще попереду
    ]);
    const reqUpdate = vi.fn(async (_a: unknown) => ({ count: 3 }));
    const prisma = {
      viberListing: { updateMany, findMany },
      rideShareRequest: { updateMany: reqUpdate },
    } as unknown as PrismaClient;

    const r = await deactivateExpiredListings(prisma, now);

    expect(r).toEqual({ deactivated: 3, expiredRequests: 3 });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { isActive: true, endsAt: { lt: new Date(now.getTime() - LISTING_GRACE_MS) } },
      data: { isActive: false },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, { where: { id: { in: [7] } }, data: { isActive: false } });
    expect(reqUpdate).toHaveBeenCalledWith({
      where: { status: 'pending', expiresAt: { lt: now } },
      data: { status: 'expired' },
    });
  });
});
