import type { PrismaClient } from '@prisma/client';

/**
 * Відкриття табло з QR-наклейок на зупинках (frontend: /admin/stickers, Docs/stop-stickers.md).
 * QR несе `utm_campaign=<stopId>-<side>`; табло при першому за сесію відкритті шле
 * POST /transport/sticker-scans, адмінка читає агрегати. IP у базу не пишеться — лише в пам'ять
 * процесу на 2 хвилини (разом з User-Agent), щоб подвійний скан чи перезавантаження без
 * sessionStorage не рахувались як нове відкриття. Короткі вікно і ключ з UA — бо за мобільним
 * CGNAT різні люди мають спільну IP-адресу.
 */

export const STICKER_SIDES = ['a', 'b', 's'] as const;
export type StickerSide = (typeof STICKER_SIDES)[number];

const STOP_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function parseStickerScan(body: unknown): { stopId: string; side: StickerSide } | null {
  const b = (body ?? {}) as { stopId?: unknown; side?: unknown };
  const stopId = typeof b.stopId === 'string' ? b.stopId.trim() : '';
  const side = typeof b.side === 'string' ? b.side.trim() : '';
  if (!STOP_ID_RE.test(stopId)) return null;
  if (!(STICKER_SIDES as readonly string[]).includes(side)) return null;
  return { stopId, side: side as StickerSide };
}

const DEDUPE_MS = 2 * 60 * 1000;
const DEDUPE_MAX = 5000;

/** Повтор того самого скану з того самого клієнта (IP + User-Agent) протягом 2 хвилин — не рахується */
export function createScanDeduper(windowMs = DEDUPE_MS, max = DEDUPE_MAX) {
  const seen = new Map<string, number>();
  return (key: string, now = Date.now()): boolean => {
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) return true;
    if (seen.size >= max) {
      for (const [k, t] of seen) if (now - t >= windowMs) seen.delete(k);
      if (seen.size >= max) seen.clear();
    }
    seen.set(key, now);
    return false;
  };
}

export type StickerScanStat = {
  stopId: string;
  side: StickerSide;
  total: number;
  last7d: number;
  last30d: number;
  lastAt: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Агрегати по наклейках (зупинка + бік): усього, за 7 і 30 днів, останнє відкриття; популярні — першими */
export async function stickerScanStats(
  prisma: PrismaClient,
  now = new Date()
): Promise<{ rows: StickerScanStat[]; total: number; last7d: number; last30d: number }> {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const [all, week, month] = await Promise.all([
    prisma.stickerScan.groupBy({ by: ['stopId', 'side'], _count: { _all: true }, _max: { createdAt: true } }),
    prisma.stickerScan.groupBy({ by: ['stopId', 'side'], where: { createdAt: { gte: since(7) } }, _count: { _all: true } }),
    prisma.stickerScan.groupBy({ by: ['stopId', 'side'], where: { createdAt: { gte: since(30) } }, _count: { _all: true } }),
  ]);
  const key = (r: { stopId: string; side: string }) => `${r.stopId}|${r.side}`;
  const weekBy = new Map(week.map((r) => [key(r), r._count._all]));
  const monthBy = new Map(month.map((r) => [key(r), r._count._all]));
  const rows: StickerScanStat[] = all
    .map((r) => ({
      stopId: r.stopId,
      side: r.side as StickerSide,
      total: r._count._all,
      last7d: weekBy.get(key(r)) ?? 0,
      last30d: monthBy.get(key(r)) ?? 0,
      lastAt: r._max.createdAt ? r._max.createdAt.toISOString() : null,
    }))
    .sort((a, b) => b.total - a.total || b.last7d - a.last7d || a.stopId.localeCompare(b.stopId) || a.side.localeCompare(b.side));
  const sum = (k: 'total' | 'last7d' | 'last30d') => rows.reduce((n, r) => n + r[k], 0);
  return { rows, total: sum('total'), last7d: sum('last7d'), last30d: sum('last30d') };
}

/** Адреса клієнта за проксі Railway (trust proxy не ввімкнено): перший X-Forwarded-For */
export function clientKey(headers: Record<string, string | string[] | undefined>, fallbackIp: string | undefined): string {
  const xff = headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  const ua = headers['user-agent'];
  return `${first || fallbackIp || '?'}|${(Array.isArray(ua) ? ua[0] : ua) ?? ''}`;
}
