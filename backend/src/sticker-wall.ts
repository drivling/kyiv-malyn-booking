import { createHmac, timingSafeEqual } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { kyivDayHour } from './sticker-scans';

/**
 * Віджет «Відкриття з QR» на стіну (`/admin/wall?key=…`): телефон у горизонтальному положенні
 * щохвилини тягне знімок сьогоднішніх сканів і святкує кожне нове відкриття.
 *
 * Телефон не входить в адмінку: посилання несе окремий ключ лише на читання цього знімка —
 * HMAC від ADMIN_PASSWORD, тож зміна пароля відкликає і ключ.
 */
const WALL_KEY_SALT = 'sticker-wall-v1';

export function stickerWallKey(adminPassword: string): string {
  return createHmac('sha256', adminPassword).update(WALL_KEY_SALT).digest('hex').slice(0, 32);
}

export function isStickerWallKey(key: unknown, adminPassword: string): boolean {
  if (typeof key !== 'string' || key.length !== 32) return false;
  const expected = Buffer.from(stickerWallKey(adminPassword));
  const given = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type StickerWallStop = {
  stopId: string;
  /** Відкриттів за сьогоднішню київську добу */
  today: number;
  lastHour: number;
  last3h: number;
  lastAt: string | null;
  /** Сьогодні по годинах доби (0–23, Київ) */
  hourly: number[];
};

export type StickerWallEvent = { id: number; stopId: string; side: string; createdAt: string };

export type StickerWallSnapshot = {
  now: string;
  /** Київська доба знімка (YYYY-MM-DD) — віджет скидає базу, коли доба змінюється */
  day: string;
  total: number;
  /** Учора до тієї самої години й хвилини за Києвом */
  yesterdaySameTime: number;
  hourly: number[];
  /** Сьогоднішні зупинки, популярні першими */
  stops: StickerWallStop[];
  /** Нові сьогоднішні скани з id > after (за зростанням, не більше EVENTS_LIMIT) */
  events: StickerWallEvent[];
  /** Найбільший id сьогоднішніх сканів — курсор для наступного запиту */
  lastId: number;
  /** Найкраща доба за 90 днів до сьогодні — для «Рекорд дня!» */
  bestDay: { day: string; count: number } | null;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EVENTS_LIMIT = 20;
const BEST_DAY_WINDOW = 90;

/** Хвилина київської доби (0–1439) — «учора на цю пору». Зсув Києва — цілі години, тож хвилини як в UTC */
function kyivMinuteOfDay(d: Date): number {
  const { hour } = kyivDayHour(d);
  return hour * 60 + d.getUTCMinutes();
}

export async function stickerWallSnapshot(
  prisma: PrismaClient,
  opts: { now?: Date; after?: number } = {}
): Promise<StickerWallSnapshot> {
  const now = opts.now ?? new Date();
  const after = opts.after && Number.isFinite(opts.after) && opts.after > 0 ? Math.floor(opts.after) : 0;
  // Сканів небагато — 90 днів читаємо сирими рядками й розкладаємо по київських добах тут
  const rows = await prisma.stickerScan.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - (BEST_DAY_WINDOW + 1) * DAY_MS) } },
    select: { id: true, stopId: true, side: true, createdAt: true },
    orderBy: { id: 'asc' },
  });
  const day = kyivDayHour(now).day;
  const yesterday = kyivDayHour(new Date(now.getTime() - DAY_MS)).day;
  const nowMinute = kyivMinuteOfDay(now);

  const hourly = Array.from({ length: 24 }, () => 0);
  const byStop = new Map<string, StickerWallStop>();
  const perDay = new Map<string, number>();
  const events: StickerWallEvent[] = [];
  let total = 0;
  let yesterdaySameTime = 0;
  let lastId = after;

  for (const r of rows) {
    const { day: d, hour } = kyivDayHour(r.createdAt);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    if (d === yesterday && kyivMinuteOfDay(r.createdAt) <= nowMinute) yesterdaySameTime += 1;
    if (d !== day) continue;
    total += 1;
    hourly[hour] += 1;
    const s = byStop.get(r.stopId) ?? {
      stopId: r.stopId,
      today: 0,
      lastHour: 0,
      last3h: 0,
      lastAt: null,
      hourly: Array.from({ length: 24 }, () => 0),
    };
    const age = now.getTime() - r.createdAt.getTime();
    s.today += 1;
    s.hourly[hour] += 1;
    if (age <= HOUR_MS) s.lastHour += 1;
    if (age <= 3 * HOUR_MS) s.last3h += 1;
    const at = r.createdAt.toISOString();
    if (!s.lastAt || at > s.lastAt) s.lastAt = at;
    byStop.set(r.stopId, s);
    if (r.id > lastId) lastId = r.id;
    if (r.id > after && events.length < EVENTS_LIMIT) {
      events.push({ id: r.id, stopId: r.stopId, side: r.side, createdAt: at });
    }
  }

  let bestDay: StickerWallSnapshot['bestDay'] = null;
  for (const [d, count] of perDay) {
    if (d === day) continue;
    if (!bestDay || count > bestDay.count || (count === bestDay.count && d > bestDay.day)) bestDay = { day: d, count };
  }

  const stops = [...byStop.values()].sort(
    (a, b) => b.today - a.today || (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.stopId.localeCompare(b.stopId)
  );
  return { now: now.toISOString(), day, total, yesterdaySameTime, hourly, stops, events, lastId, bestDay };
}
