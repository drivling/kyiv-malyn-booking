import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ingestRawListing, normalizeRawForHash, rawMessageHash } from './viber-ingest';
import { setTelegramPrismaForTests } from './telegram';

const RAW = '[ 9 лютого 2026 р. 12:55 ] ⁨Іван⁩: Київ - Малин завтра о 18:00, 3 місця, 0501112233';

/** In-memory Prisma: листинги, джерела, черга; Person — findUnique/upsert. */
function memoryPrisma() {
  let nextId = 1;
  const listings: any[] = [];
  const sources: any[] = [];
  const jobs: any[] = [];
  const prisma = {
    viberListing: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async ({ where }: any) => listings.find((l) => l.id === where.id) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...data };
        listings.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(listings.find((l) => l.id === where.id), data)),
    },
    viberListingSource: {
      findUnique: vi.fn(async ({ where }: any) => sources.find((s) => s.hash === where.hash) ?? null),
      create: vi.fn(async ({ data }: any) => {
        sources.push(data);
        return data;
      }),
    },
    notificationJob: { create: vi.fn(async ({ data }: any) => { jobs.push(data); return { id: jobs.length }; }) },
    person: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: any) => ({ id: 42, ...create })),
    },
    booking: { findMany: vi.fn(async () => []) },
    tripPoint: { findMany: vi.fn(async () => []) },
    tripRoute: { findUnique: vi.fn(async () => null) },
  };
  return { prisma: prisma as unknown as PrismaClient, listings, sources, jobs, raw: prisma };
}

describe('rawMessageHash', () => {
  it('ігнорує різницю в пробілах/переносах, але не в тексті чи джерелі', () => {
    expect(normalizeRawForHash('a  b\r\n\n c ')).toBe('a b\nc');
    expect(rawMessageHash('Viber1', 'a  b')).toBe(rawMessageHash('Viber1', 'a b'));
    expect(rawMessageHash('Viber1', 'a b')).not.toBe(rawMessageHash('telegram1', 'a b'));
    expect(rawMessageHash('Viber1', 'a b')).not.toBe(rawMessageHash('Viber1', 'a c'));
  });
});

describe('ingestRawListing', () => {
  beforeEach(() => {
    setTelegramPrismaForTests(null as unknown as PrismaClient);
  });

  it("перший POST створює оголошення, рядок-джерело і job-и (ім'я, перетини); повтор — той самий листинг без мержу", async () => {
    const m = memoryPrisma();
    setTelegramPrismaForTests(m.prisma);
    const parse = () => ({
      listingType: 'driver' as const,
      route: 'Kyiv-Malyn',
      date: new Date(Date.now() + 86_400_000),
      departureTime: '18:00',
      seats: 3,
      phone: '0501112233',
      notes: null,
      senderName: null,
    });
    const first = await ingestRawListing(m.prisma, { rawMessage: RAW }, { parse, notify: true });
    expect(first.ok && first.isNew && !first.duplicate).toBe(true);
    expect(m.sources).toHaveLength(1);
    expect(m.jobs.map((j) => j.kind)).toEqual(['resolve_sender_name', 'listing_match']);

    const again = await ingestRawListing(m.prisma, { rawMessage: RAW + '  ' }, { parse, notify: true });
    expect(again.ok && again.duplicate).toBe(true);
    expect(again.ok && again.listing.id).toBe(first.ok ? first.listing.id : -1);
    expect(m.raw.viberListing.create).toHaveBeenCalledTimes(1);
    expect(m.raw.viberListing.findMany).toHaveBeenCalledTimes(1); // мерж-кандидати шукали лише вперше
    expect(m.jobs).toHaveLength(2);
  });

  it('нерозібране повідомлення → unparsable, нічого не пишемо', async () => {
    const m = memoryPrisma();
    const r = await ingestRawListing(m.prisma, { rawMessage: 'x' }, { parse: () => null, notify: false });
    expect(r).toEqual({ ok: false, reason: 'unparsable' });
    expect(m.sources).toHaveLength(0);
  });

  it("з іменем із парсера job на ім'я не ставиться; без Telegram job-ів немає взагалі", async () => {
    const m = memoryPrisma();
    setTelegramPrismaForTests(m.prisma);
    const parse = () => ({ listingType: 'passenger' as const, route: 'Kyiv-Malyn', date: new Date(Date.now() + 86_400_000), departureTime: null, seats: null, phone: '0501112233', notes: null, senderName: 'Оля' });
    await ingestRawListing(m.prisma, { rawMessage: RAW }, { parse, notify: true });
    expect(m.jobs.map((j) => j.kind)).toEqual(['listing_match']);
    await ingestRawListing(m.prisma, { rawMessage: RAW + ' інше' }, { parse, notify: false });
    expect(m.jobs).toHaveLength(1);
  });
});
