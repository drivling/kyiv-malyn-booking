import type { PrismaClient } from '@prisma/client';

/**
 * Факт прибуття міського автобуса від пасажирів (frontend: довге натискання на час рейсу на
 * /transport/route/:id і на картку табло /transport/stop/:id → ArrivalReportSheet).
 *
 * Поки лише збираємо статистику для точніших графіків: `arrived` — «автобус тут» (фактичний час
 * бере сервер за київським годинником мінус `minutesAgo`, а не телефон), `missed` — «чекав,
 * автобуса не було ні до, ні після». Рядок зберігає маршрут, напрямок, зупинку й час за розкладом
 * текстом, без FK: датасет замінюється цілком (replaceTransportDataset), а історія має лишитися.
 * IP у базу не пишеться — лише в пам'ять процесу для відсіву повторів (як у sticker-scans.ts).
 */

export const ARRIVAL_KINDS = ['arrived', 'missed'] as const;
export type ArrivalKind = (typeof ARRIVAL_KINDS)[number];
export const ARRIVAL_SOURCES = ['route', 'board'] as const;
export type ArrivalSource = (typeof ARRIVAL_SOURCES)[number];
export type ArrivalDirection = 'there' | 'back';

/** «Автобус приїхав» приймається лише в межах ±90 хв від розкладу — інакше це інший рейс */
export const ARRIVED_WINDOW_MIN = 90;
/** «Не було автобуса»: щонайменше 5 хв до розкладу (людина вже на зупинці) і до 3 год після */
export const MISSED_EARLY_MIN = 5;
export const MISSED_LATE_MIN = 180;
export const MAX_MINUTES_AGO = 30;
export const MAX_WAITED_MIN = 180;

const ID_RE = /^[A-Za-z0-9_.:-]{1,60}$/;
const STOP_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ArrivalReportInput = {
  kind: ArrivalKind;
  routeId: string;
  tripId: string;
  direction: ArrivalDirection;
  stopId: string;
  scheduledTime: string;
  source: ArrivalSource;
  minutesAgo: number;
  waitedMin: number | null;
  clientId: string | null;
};

function intIn(v: unknown, min: number, max: number): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Body POST /transport/arrival-reports:
 * { kind, routeId, tripId, direction: there|back, stopId, scheduledTime: HH:MM, source: route|board,
 *   minutesAgo?: 0–30 (arrived), waitedMin?: 1–180 (missed), clientId? }
 */
export function parseArrivalReport(body: unknown): ArrivalReportInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  const kind = str('kind');
  const routeId = str('routeId');
  const tripId = str('tripId');
  const direction = str('direction');
  const stopId = str('stopId');
  const scheduledTime = str('scheduledTime');
  const source = str('source');
  const clientId = str('clientId');
  if (!(ARRIVAL_KINDS as readonly string[]).includes(kind)) return null;
  if (!ID_RE.test(routeId) || !ID_RE.test(tripId) || !STOP_ID_RE.test(stopId)) return null;
  if (direction !== 'there' && direction !== 'back') return null;
  if (!HHMM_RE.test(scheduledTime)) return null;
  if (!(ARRIVAL_SOURCES as readonly string[]).includes(source)) return null;
  const minutesAgo = kind === 'arrived' ? intIn(b.minutesAgo, 0, MAX_MINUTES_AGO) : 0;
  if (kind === 'arrived' && minutesAgo === null && b.minutesAgo !== undefined) return null;
  const waitedMin = kind === 'missed' ? intIn(b.waitedMin, 1, MAX_WAITED_MIN) : null;
  if (kind === 'missed' && waitedMin === null && b.waitedMin !== undefined && b.waitedMin !== null) return null;
  return {
    kind: kind as ArrivalKind,
    routeId,
    tripId,
    direction,
    stopId,
    scheduledTime,
    source: source as ArrivalSource,
    minutesAgo: minutesAgo ?? 0,
    waitedMin,
    clientId: CLIENT_ID_RE.test(clientId) ? clientId : null,
  };
}

const KYIV_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Київська дата (YYYY-MM-DD) і хвилини від півночі моменту часу */
export function kyivClock(d: Date): { date: string; mins: number } {
  const p = Object.fromEntries(KYIV_CLOCK.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

export function hhmmToMins(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function minsToHhmm(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Різниця «факт − розклад» у хвилинах з переходом через північ: результат у [−720, 720) */
export function clockDiff(actualMins: number, scheduledMins: number): number {
  return ((((actualMins - scheduledMins + 720) % 1440) + 1440) % 1440) - 720;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T12:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export type ArrivalReportRow = {
  kind: ArrivalKind;
  routeId: string;
  tripId: string;
  direction: ArrivalDirection;
  stopId: string;
  serviceDate: string;
  scheduledTime: string;
  actualTime: string | null;
  delayMin: number | null;
  waitedMin: number | null;
  source: ArrivalSource;
  clientId: string | null;
};

/**
 * Звіт → рядок таблиці за київським часом сервера `now`. Дата рейсу — київська доба розкладу
 * (рейс о 23:55, про який повідомили о 00:05, належить учорашній добі). Поза вікном — null.
 */
export function buildArrivalRow(
  input: ArrivalReportInput,
  now: Date
): { row: ArrivalReportRow } | { error: 'too_far' } {
  const { date, mins } = kyivClock(now);
  const scheduledMins = hhmmToMins(input.scheduledTime);
  const at = input.kind === 'arrived' ? mins - input.minutesAgo : mins;
  const delay = clockDiff(at, scheduledMins);
  if (input.kind === 'arrived' && Math.abs(delay) > ARRIVED_WINDOW_MIN) return { error: 'too_far' };
  if (input.kind === 'missed' && (delay < -MISSED_EARLY_MIN || delay > MISSED_LATE_MIN)) return { error: 'too_far' };
  // На скільки діб зсунулась дата розкладу відносно «зараз» (північ між розкладом і фактом)
  const dayShift = Math.round((at - delay - scheduledMins) / 1440);
  return {
    row: {
      kind: input.kind,
      routeId: input.routeId,
      tripId: input.tripId,
      direction: input.direction,
      stopId: input.stopId,
      serviceDate: shiftDate(date, dayShift),
      scheduledTime: input.scheduledTime,
      actualTime: input.kind === 'arrived' ? minsToHhmm(at) : null,
      delayMin: input.kind === 'arrived' ? delay : null,
      waitedMin: input.kind === 'missed' ? input.waitedMin : null,
      source: input.source,
      clientId: input.clientId,
    },
  };
}

export const REPORT_DAYS = [1, 7, 30, 90] as const;
export type ReportDays = (typeof REPORT_DAYS)[number];

/** ?days= адмінки: 1 | 7 | 30 | 90, інше — 30 */
export function parseReportDays(v: unknown): ReportDays {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (REPORT_DAYS as readonly number[]).includes(n) ? (n as ReportDays) : 30;
}

/** Рейс на зупинці: скільки разів приїхав / не приїхав і розкид запізнення */
export type ArrivalSummaryRow = {
  routeId: string;
  direction: ArrivalDirection;
  stopId: string;
  scheduledTime: string;
  arrived: number;
  missed: number;
  /** Середнє / мінімальне / максимальне «факт − розклад», хв; null — приїздів не було */
  avgDelay: number | null;
  minDelay: number | null;
  maxDelay: number | null;
  /** Скільки різних днів є звіти */
  days: number;
  lastAt: string;
};

export type ArrivalReportView = ArrivalReportRow & { id: number; createdAt: string };

export type ArrivalReportStats = {
  days: ReportDays;
  total: number;
  arrived: number;
  missed: number;
  summary: ArrivalSummaryRow[];
  /** Останні звіти, новіші першими (до 200) */
  recent: ArrivalReportView[];
};

const RECENT_LIMIT = 200;

/**
 * Статистика для адмінки за `days` діб: зведення по «маршрут · напрямок · зупинка · час за
 * розкладом» (найбільше звітів — першими) і останні сирі звіти. Звітів небагато — рахуємо тут.
 */
export async function arrivalReportStats(
  prisma: PrismaClient,
  opts: { days?: ReportDays; now?: Date } = {}
): Promise<ArrivalReportStats> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 30;
  const where =
    days === 1
      ? { serviceDate: { gte: kyivClock(now).date } }
      : { createdAt: { gte: new Date(now.getTime() - days * DAY_MS) } };
  const rows = await prisma.transportArrivalReport.findMany({ where, orderBy: { id: 'desc' } });
  const views: ArrivalReportView[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as ArrivalKind,
    routeId: r.routeId,
    tripId: r.tripId,
    direction: r.direction as ArrivalDirection,
    stopId: r.stopId,
    serviceDate: r.serviceDate,
    scheduledTime: r.scheduledTime,
    actualTime: r.actualTime,
    delayMin: r.delayMin,
    waitedMin: r.waitedMin,
    source: r.source as ArrivalSource,
    clientId: r.clientId,
    createdAt: r.createdAt.toISOString(),
  }));

  type Acc = ArrivalSummaryRow & { delays: number[]; dates: Set<string> };
  const by = new Map<string, Acc>();
  for (const r of views) {
    const k = `${r.routeId}|${r.direction}|${r.stopId}|${r.scheduledTime}`;
    const acc =
      by.get(k) ??
      ({
        routeId: r.routeId,
        direction: r.direction,
        stopId: r.stopId,
        scheduledTime: r.scheduledTime,
        arrived: 0,
        missed: 0,
        avgDelay: null,
        minDelay: null,
        maxDelay: null,
        days: 0,
        lastAt: r.createdAt,
        delays: [],
        dates: new Set<string>(),
      } as Acc);
    if (r.kind === 'arrived') {
      acc.arrived += 1;
      if (r.delayMin !== null) acc.delays.push(r.delayMin);
    } else {
      acc.missed += 1;
    }
    acc.dates.add(r.serviceDate);
    if (r.createdAt > acc.lastAt) acc.lastAt = r.createdAt;
    by.set(k, acc);
  }
  const summary: ArrivalSummaryRow[] = [...by.values()]
    .map(({ delays, dates, ...s }) => ({
      ...s,
      avgDelay: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : null,
      minDelay: delays.length ? Math.min(...delays) : null,
      maxDelay: delays.length ? Math.max(...delays) : null,
      days: dates.size,
    }))
    .sort(
      (a, b) =>
        b.arrived + b.missed - (a.arrived + a.missed) ||
        a.routeId.localeCompare(b.routeId, 'uk', { numeric: true }) ||
        a.scheduledTime.localeCompare(b.scheduledTime) ||
        a.stopId.localeCompare(b.stopId)
    );
  const arrived = views.filter((r) => r.kind === 'arrived').length;
  return {
    days,
    total: views.length,
    arrived,
    missed: views.length - arrived,
    summary,
    recent: views.slice(0, RECENT_LIMIT),
  };
}
