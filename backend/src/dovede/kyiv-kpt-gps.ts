/**
 * «Доведе» · запис онлайн-руху «Київпастрансу» (крок 8г): інтервальна задача `kyiv-kpt-gps` бере стрічку GTFS-RT
 * (адреса — лише в змінній `KYIV_GTFS_RT_URL`, у репозиторій не кладемо), веде візити машин біля контрольних точок
 * (`kyiv-kpt-passes.ts`) і пише закриті візити в `KyivKptPass`; старші за `retentionDays` — геть.
 * Стан останнього тіку — у памʼяті процесу, для адмінки.
 */
import type { PrismaClient } from '@prisma/client';
import { parseVehiclePositions } from '../gtfs-rt';
import { createVisitTracker, type KptVisit, type VisitTracker } from './kyiv-kpt-passes';
import { buildKptGpsReport, type KptGpsReport } from './kyiv-kpt-gps-times';

export const KYIV_GPS_DAYS_DEFAULT = 2;
export const KYIV_GPS_DAYS_MAX = 7;
/** Скільки візитів максимум бере звіт (≈ 120 тис. на добу) */
const REPORT_LIMIT = 1_000_000;

export interface KyivGpsTick {
  at: string;
  vehicles: number;
  /** машин біля контрольних точок зараз (відкриті візити) */
  open: number;
  written: number;
  deleted: number;
  error?: string;
}

export interface KyivGpsDeps {
  prisma: PrismaClient;
  url: string;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  now?: () => Date;
  retentionDays?: number;
  tracker?: VisitTracker;
}

export async function fetchFeedBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': 'transport-gps-recorder/1.0', Accept: 'application/x-protobuf, */*' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function createKyivGpsRecorder(deps: KyivGpsDeps) {
  const tracker = deps.tracker ?? createVisitTracker();
  const now = deps.now ?? (() => new Date());
  const fetchBytes = deps.fetchBytes ?? fetchFeedBytes;
  const retentionMs = (deps.retentionDays ?? 30) * 86_400_000;
  let last: KyivGpsTick | null = null;

  async function write(visits: KptVisit[]): Promise<number> {
    if (!visits.length) return 0;
    const r = await deps.prisma.kyivKptPass.createMany({ data: visits, skipDuplicates: true });
    return r.count;
  }

  return {
    async tick(): Promise<KyivGpsTick> {
      const at = now();
      try {
        const feed = parseVehiclePositions(await fetchBytes(deps.url));
        const written = await write(tracker.feed(feed.vehicles, at));
        const removed = await deps.prisma.kyivKptPass.deleteMany({ where: { firstAt: { lt: new Date(at.getTime() - retentionMs) } } });
        last = { at: at.toISOString(), vehicles: feed.vehicles.length, open: tracker.openCount(), written, deleted: removed.count };
      } catch (e) {
        last = { at: at.toISOString(), vehicles: 0, open: tracker.openCount(), written: 0, deleted: 0, error: e instanceof Error ? e.message : String(e) };
      }
      return last;
    },
    /** Закрити відкриті візити й записати (зупинка процесу) */
    async flush(): Promise<number> {
      return write(tracker.flush()).catch(() => 0);
    },
    status: () => last,
  };
}

export type KyivGpsRecorder = ReturnType<typeof createKyivGpsRecorder>;

export function parseKyivGpsDays(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return KYIV_GPS_DAYS_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= KYIV_GPS_DAYS_MAX ? n : null;
}

/** Адмінка: звіт за останні `days` діб + скільки візитів усього */
export async function kyivGpsReport(prisma: PrismaClient, days: number, now: Date = new Date()): Promise<KptGpsReport & { days: number; truncated: boolean }> {
  const rows = await prisma.kyivKptPass.findMany({
    where: { firstAt: { gte: new Date(now.getTime() - days * 86_400_000) } },
    orderBy: [{ vehicleId: 'asc' }, { firstAt: 'asc' }],
    take: REPORT_LIMIT + 1,
    select: { routeId: true, vehicleId: true, point: true, firstAt: true, lastAt: true },
  });
  const truncated = rows.length > REPORT_LIMIT;
  return { ...buildKptGpsReport(truncated ? rows.slice(0, REPORT_LIMIT) : rows), days, truncated };
}
