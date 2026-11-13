/**
 * «Доведе» — перемикачі й денний ліміт викликів Claude (Docs/dovede-roadmap.md, фаза 2).
 * DOVEDE_ENABLED=0 вимикає ШІ-розбір (сторінка лишається на місцевому), DOVEDE_DAILY_CAP — стеля викликів
 * за київську добу, рахується з журналу DovedeQuery, тож спільна для всіх контейнерів.
 */
import type { PrismaClient } from '@prisma/client';
import { kyivClock } from '../arrival-reports';

export const DEFAULT_DOVEDE_DAILY_CAP = 300;

export function isDovedeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.DOVEDE_ENABLED ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

export function dovedeDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.DOVEDE_DAILY_CAP ?? '').trim();
  if (!raw) return DEFAULT_DOVEDE_DAILY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DOVEDE_DAILY_CAP;
}

/** Початок поточної київської доби як момент часу */
export function kyivDayStart(now: Date): Date {
  const { mins } = kyivClock(now);
  const d = new Date(now.getTime() - mins * 60_000);
  d.setUTCSeconds(0, 0);
  return d;
}

/** Скільки разів сьогодні (за Києвом) уже кликали Claude */
export async function aiCallsToday(prisma: PrismaClient, now: Date): Promise<number> {
  return prisma.dovedeQuery.count({ where: { aiCalled: true, createdAt: { gte: kyivDayStart(now) } } });
}
