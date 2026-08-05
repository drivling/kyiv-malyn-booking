/**
 * Пошук активних попуток для inline-режиму (спільна логіка з /allrides, без PM-фільтрів).
 */
import type { PrismaClient } from '@prisma/client';

export type InlineListingRow = {
  id: number;
  listingType: string;
  route: string;
  date: Date;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  senderName: string | null;
  notes: string | null;
  priceUah: number | null;
  personId: number | null;
};

export type InlineListingSearchOpts = {
  /** Початок дня (gte) */
  dateFrom?: Date;
  /** Кінець дня exclusive (lt) */
  dateTo?: Date;
  /** Лише майбутні від сьогодні */
  futureFromToday?: boolean;
  /** Підрядок у route (Kyiv, Malyn…) */
  routeHint?: string;
  listingType?: 'driver' | 'passenger';
  take?: number;
};

/** Початок календарного дня (локальний Date, як у /allrides). */
export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addLocalDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export async function searchListingsForInline(
  prisma: PrismaClient,
  opts: InlineListingSearchOpts = {}
): Promise<InlineListingRow[]> {
  const today = startOfLocalDay(new Date());
  const where: {
    isActive: boolean;
    listingType?: string;
    route?: { contains: string; mode: 'insensitive' };
    date?: { gte?: Date; lt?: Date };
  } = { isActive: true };

  if (opts.listingType) where.listingType = opts.listingType;
  if (opts.routeHint) where.route = { contains: opts.routeHint, mode: 'insensitive' };

  if (opts.dateFrom && opts.dateTo) {
    where.date = { gte: opts.dateFrom, lt: opts.dateTo };
  } else if (opts.futureFromToday || !opts.dateFrom) {
    where.date = { gte: today };
  } else if (opts.dateFrom) {
    where.date = { gte: opts.dateFrom };
  }

  return prisma.viberListing.findMany({
    where,
    orderBy: [{ date: 'asc' }, { departureTime: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(Math.max(opts.take ?? 20, 1), 50),
    select: {
      id: true,
      listingType: true,
      route: true,
      date: true,
      departureTime: true,
      seats: true,
      phone: true,
      senderName: true,
      notes: true,
      priceUah: true,
      personId: true,
    },
  });
}

/** Евристики для query після префікса rides / rides_today */
export function parseInlineRidesQueryPayload(payload: string): {
  dateFrom?: Date;
  dateTo?: Date;
  futureFromToday?: boolean;
  routeHint?: string;
} {
  const q = payload.trim().toLowerCase();
  const today = startOfLocalDay(new Date());

  if (!q || q === 'today' || q.includes('сьогодні') || q.includes('сьогодни')) {
    const end = addLocalDays(today, 1);
    return { dateFrom: today, dateTo: end };
  }
  if (q.includes('завтра') || q.includes('tomorrow')) {
    const from = addLocalDays(today, 1);
    const to = addLocalDays(today, 2);
    return { dateFrom: from, dateTo: to };
  }

  let routeHint: string | undefined;
  if (q.includes('київ') || q.includes('киев') || q.includes('kyiv') || q.includes('kiev')) {
    routeHint = 'Kyiv';
  } else if (q.includes('малин') || q.includes('malyn')) {
    routeHint = 'Malyn';
  } else if (q.includes('житомир') || q.includes('zhytomyr')) {
    routeHint = 'Zhytomyr';
  } else if (q.includes('коростень') || q.includes('korosten')) {
    routeHint = 'Korosten';
  }

  if (routeHint) {
    return { futureFromToday: true, routeHint };
  }

  return { futureFromToday: true };
}
