/**
 * Люди з QR-наклейок (Docs/stop-stickers.md, «Люди з наклейок»): рядок StickerPerson на анонімний id браузера в місті —
 * перша й остання наклейка, зупинки за порядком першого скану, київські доби зі сканами, повернення, досмотрений тизер.
 * Номер пасажира — порядок появи в місті: скільки людей міста мають id не більший (окремого лічильника немає).
 * Пишуть POST /transport/sticker-scans, /transport/sticker-returns і /ads/events (тизер досмотрено); читають стіна
 * (вкладка «Люди») і адмінка («Наклейки зупинок» → «Люди»). Стан рахується тут, у JS (без increment / push), —
 * так само працює й transport-test-store.ts.
 */
import type { PrismaClient } from '@prisma/client';
import { kyivDayHour, type StatsDays } from './sticker-scans';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Скільки різних зупинок памʼятаємо на людину (перша лишається завжди) */
export const MAX_PERSON_STOPS = 200;
/** Скільки людей у стрічці стіни й у списку адмінки */
const LIST_LIMIT = 30;

export type StickerPersonRow = {
  id: number;
  cityCode: string;
  clientId: string;
  firstStopId: string;
  firstSide: string;
  firstAt: Date;
  lastStopId: string;
  lastSide: string;
  lastAt: Date;
  scans: number;
  stopIds: string[];
  scanDays: number;
  lastScanDay: string | null;
  returns: number;
  lastReturnAt: Date | null;
  teaserAt: Date | null;
};

/** Відповідь скану для телефона: номер і коротка історія (паспорт пасажира, frontend stickerPassport.ts) */
export type PassengerSummary = {
  number: number;
  scans: number;
  stops: number;
  firstStopId: string;
  firstAt: string;
  isNew: boolean;
};

type Db = Pick<PrismaClient, 'stickerPerson'>;
type Scan = { cityCode: string; clientId: string; stopId: string; side: string; at?: Date };

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const key = (cityCode: string, clientId: string) => ({ cityCode_clientId: { cityCode, clientId } });

/** Новий стан людини після зарахованого скану (чиста функція) */
export function nextScanState(prev: StickerPersonRow, scan: { stopId: string; side: string; at: Date }) {
  const day = kyivDayHour(scan.at).day;
  const stopIds = prev.stopIds.includes(scan.stopId)
    ? prev.stopIds
    : [...prev.stopIds, scan.stopId].filter((id, i, all) => i === 0 || all.length - i <= MAX_PERSON_STOPS - 1);
  return {
    lastStopId: scan.stopId,
    lastSide: scan.side,
    lastAt: scan.at,
    scans: prev.scans + 1,
    stopIds,
    scanDays: prev.scanDays + (prev.lastScanDay === day ? 0 : 1),
    lastScanDay: day,
  };
}

/** Номер пасажира в місті: скільки людей міста зʼявилось не пізніше (id росте з часом появи) */
export function passengerNumber(prisma: Db, cityCode: string, id: number): Promise<number> {
  return prisma.stickerPerson.count({ where: { cityCode, id: { lte: id } } });
}

async function summary(prisma: Db, row: StickerPersonRow, isNew: boolean): Promise<PassengerSummary> {
  return {
    number: await passengerNumber(prisma, row.cityCode, row.id),
    scans: row.scans,
    stops: row.stopIds.length,
    firstStopId: row.firstStopId,
    firstAt: row.firstAt.toISOString(),
    isNew,
  };
}

/**
 * Зарахований скан наклейки з анонімним id: нова людина або оновлена історія. Гонку двох перших сканів одного браузера
 * (P2002 на create) вирішує один повтор — тоді це вже оновлення.
 */
export async function recordPersonScan(prisma: Db, scan: Scan): Promise<PassengerSummary> {
  const at = scan.at ?? new Date();
  for (let attempt = 0; ; attempt += 1) {
    const prev = (await prisma.stickerPerson.findUnique({ where: key(scan.cityCode, scan.clientId) })) as StickerPersonRow | null;
    if (prev) {
      const row = (await prisma.stickerPerson.update({
        where: key(scan.cityCode, scan.clientId),
        data: nextScanState(prev, { stopId: scan.stopId, side: scan.side, at }),
      })) as StickerPersonRow;
      return summary(prisma, row, false);
    }
    try {
      const row = (await prisma.stickerPerson.create({
        data: {
          cityCode: scan.cityCode,
          clientId: scan.clientId,
          firstStopId: scan.stopId,
          firstSide: scan.side,
          firstAt: at,
          lastStopId: scan.stopId,
          lastSide: scan.side,
          lastAt: at,
          scans: 1,
          stopIds: [scan.stopId],
          scanDays: 1,
          lastScanDay: kyivDayHour(at).day,
        },
      })) as StickerPersonRow;
      return summary(prisma, row, true);
    } catch (e) {
      if (!isUniqueViolation(e) || attempt > 0) throw e;
    }
  }
}

/** Скан без зарахування (повтор за 2 хв): номер і історія без змін; людини ще немає — null */
export async function personSummary(prisma: Db, cityCode: string, clientId: string): Promise<PassengerSummary | null> {
  const row = (await prisma.stickerPerson.findUnique({ where: key(cityCode, clientId) })) as StickerPersonRow | null;
  return row ? summary(prisma, row, false) : null;
}

/**
 * Людина повернулась на сайт (StickerReturn). Якщо скану з id не було (сканувала до 10.10.2026 або скан ще в черзі
 * офлайн) — людина зʼявляється з наклейки повернення, без зарахованих сканів.
 */
export async function recordPersonReturn(prisma: Db, ret: Scan): Promise<void> {
  const at = ret.at ?? new Date();
  for (let attempt = 0; ; attempt += 1) {
    const prev = (await prisma.stickerPerson.findUnique({ where: key(ret.cityCode, ret.clientId) })) as StickerPersonRow | null;
    if (prev) {
      await prisma.stickerPerson.update({ where: key(ret.cityCode, ret.clientId), data: { returns: prev.returns + 1, lastReturnAt: at } });
      return;
    }
    try {
      await prisma.stickerPerson.create({
        data: {
          cityCode: ret.cityCode,
          clientId: ret.clientId,
          firstStopId: ret.stopId,
          firstSide: ret.side,
          firstAt: at,
          lastStopId: ret.stopId,
          lastSide: ret.side,
          lastAt: at,
          scans: 0,
          stopIds: [ret.stopId],
          scanDays: 0,
          lastScanDay: null,
          returns: 1,
          lastReturnAt: at,
        },
      });
      return;
    } catch (e) {
      if (!isUniqueViolation(e) || attempt > 0) throw e;
    }
  }
}

/** Людина досмотріла тизер «Доведе» перед табло — лише перший раз */
export async function recordPersonTeaser(prisma: Db, t: { cityCode: string; clientId: string; at?: Date }): Promise<void> {
  await prisma.stickerPerson.updateMany({ where: { cityCode: t.cityCode, clientId: t.clientId, teaserAt: null }, data: { teaserAt: t.at ?? new Date() } });
}

// ---- Читання: стіна й адмінка

/** Остання дія людини: скан або повернення на сайт */
function lastActivity(p: StickerPersonRow): { at: Date; kind: 'scan' | 'return' } {
  return p.lastReturnAt && p.lastReturnAt > p.lastAt ? { at: p.lastReturnAt, kind: 'return' } : { at: p.lastAt, kind: 'scan' };
}

/** Повертався: сканував у різні доби або відкривав сайт знову */
const isReturning = (p: StickerPersonRow) => p.scanDays >= 2 || p.returns > 0;

/** Номери пасажирів міста: порядок id */
function numbers(persons: StickerPersonRow[]): Map<number, number> {
  return new Map([...persons].sort((a, b) => a.id - b.id).map((p, i) => [p.id, i + 1]));
}

export type PeopleWallRow = {
  number: number;
  /** Останні 4 символи анонімного id — той самий «хто», що у вкладці «Реклама» */
  who: string;
  firstStopId: string;
  lastStopId: string;
  stops: number;
  scans: number;
  scanDays: number;
  returns: number;
  /** Уперше зʼявився сьогодні (київська доба) */
  isNew: boolean;
  /** Остання дія — скан наклейки чи повернення на сайт */
  kind: 'scan' | 'return';
  at: string;
  teaser: boolean;
};

export type PeopleWallSnapshot = {
  now: string;
  day: string;
  /** Людей у місті — це й номер останнього пасажира */
  total: number;
  today: { new: number; returned: number };
  yesterday: { new: number };
  /** Хто повертався за останні 7 днів */
  returned7d: number;
  /** Люди, що вперше зʼявились за 90 днів: скільки, з них повертались, на ≥ 2 зупинках, досмотріли тизер */
  d90: { new: number; returned: number; multiStop: number; teaser: number };
  people: PeopleWallRow[];
};

/** Зведення для вкладки «Люди» на стіні (чиста функція) */
export function buildPeopleWall(persons: StickerPersonRow[], now: Date): PeopleWallSnapshot {
  const day = kyivDayHour(now).day;
  const yesterday = kyivDayHour(new Date(now.getTime() - DAY_MS)).day;
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const d90Since = new Date(now.getTime() - 90 * DAY_MS);
  const num = numbers(persons);
  const firstDay = (p: StickerPersonRow) => kyivDayHour(p.firstAt).day;
  const returnDay = (p: StickerPersonRow) => (p.lastReturnAt ? kyivDayHour(p.lastReturnAt).day : null);

  let newToday = 0;
  let newYesterday = 0;
  let returnedToday = 0;
  let returned7d = 0;
  const d90 = { new: 0, returned: 0, multiStop: 0, teaser: 0 };
  for (const p of persons) {
    const fd = firstDay(p);
    if (fd === day) newToday += 1;
    if (fd === yesterday) newYesterday += 1;
    if (fd !== day && (p.lastScanDay === day || returnDay(p) === day)) returnedToday += 1;
    const scannedAgain = p.scanDays >= 2 && p.lastAt >= weekAgo && p.lastScanDay !== fd;
    if (scannedAgain || (p.lastReturnAt && p.lastReturnAt >= weekAgo)) returned7d += 1;
    if (p.firstAt >= d90Since) {
      d90.new += 1;
      if (isReturning(p)) d90.returned += 1;
      if (p.stopIds.length >= 2) d90.multiStop += 1;
      if (p.teaserAt) d90.teaser += 1;
    }
  }

  const people = [...persons]
    .map((p) => ({ p, last: lastActivity(p) }))
    .sort((a, b) => b.last.at.getTime() - a.last.at.getTime() || b.p.id - a.p.id)
    .slice(0, LIST_LIMIT)
    .map(({ p, last }) => ({
      number: num.get(p.id) ?? 0,
      who: p.clientId.slice(-4),
      firstStopId: p.firstStopId,
      lastStopId: p.lastStopId,
      stops: p.stopIds.length,
      scans: p.scans,
      scanDays: p.scanDays,
      returns: p.returns,
      isNew: firstDay(p) === day,
      kind: last.kind,
      at: last.at.toISOString(),
      teaser: p.teaserAt !== null,
    }));

  return {
    now: now.toISOString(),
    day,
    total: persons.length,
    today: { new: newToday, returned: returnedToday },
    yesterday: { new: newYesterday },
    returned7d,
    d90,
    people,
  };
}

const PERSON_SELECT = {
  id: true,
  cityCode: true,
  clientId: true,
  firstStopId: true,
  firstSide: true,
  firstAt: true,
  lastStopId: true,
  lastSide: true,
  lastAt: true,
  scans: true,
  stopIds: true,
  scanDays: true,
  lastScanDay: true,
  returns: true,
  lastReturnAt: true,
  teaserAt: true,
} as const;

/** Усі люди міста — їх небагато (сотні), читаються одним запитом */
function cityPeople(prisma: Db, cityCode: string): Promise<StickerPersonRow[]> {
  return prisma.stickerPerson.findMany({ where: { cityCode }, select: PERSON_SELECT }) as Promise<StickerPersonRow[]>;
}

export async function peopleWallSnapshot(prisma: Db, opts: { cityCode: string; now?: Date }): Promise<PeopleWallSnapshot> {
  return buildPeopleWall(await cityPeople(prisma, opts.cityCode), opts.now ?? new Date());
}

export type StickerPersonView = {
  number: number;
  who: string;
  firstStopId: string;
  firstAt: string;
  /** Остання дія — скан або повернення */
  lastAt: string;
  scans: number;
  /** Зупинки за порядком першого скану */
  stopIds: string[];
  scanDays: number;
  returns: number;
  teaser: boolean;
};

export type StickerPeopleStats = {
  days: StatsDays;
  /** Людей у місті усього */
  total: number;
  /** Уперше зʼявились за вікно `days` (1 — сьогодні за Києвом) */
  newInPeriod: number;
  /** Повертались (різні доби або повернення на сайт) — усього */
  returning: number;
  /** Бували на ≥ 2 зупинках — усього */
  multiStop: number;
  /** Досмотріли тизер «Доведе» — усього */
  teaser: number;
  /** Нові люди по київських добах вікна */
  daily: { day: string; count: number }[];
  /** Перші зупинки нових за вікно — звідки приходять новенькі */
  firstStops: { stopId: string; count: number }[];
  /** Постійні пасажири: більше зупинок → більше діб → свіжіша дія */
  people: StickerPersonView[];
};

/** Статистика для підвкладки «Люди» в адмінці (чиста функція) */
export function buildStickerPeople(persons: StickerPersonRow[], now: Date, days: StatsDays): StickerPeopleStats {
  const today = kyivDayHour(now).day;
  const since = new Date(now.getTime() - days * DAY_MS);
  const num = numbers(persons);
  const fresh = persons.filter((p) => (days === 1 ? kyivDayHour(p.firstAt).day === today : p.firstAt >= since));
  const daily = new Map<string, number>();
  const firstStops = new Map<string, number>();
  for (const p of fresh) {
    const d = kyivDayHour(p.firstAt).day;
    daily.set(d, (daily.get(d) ?? 0) + 1);
    firstStops.set(p.firstStopId, (firstStops.get(p.firstStopId) ?? 0) + 1);
  }
  const people = [...persons]
    .map((p) => ({ p, last: lastActivity(p).at }))
    .sort((a, b) => b.p.stopIds.length - a.p.stopIds.length || b.p.scanDays - a.p.scanDays || b.last.getTime() - a.last.getTime())
    .slice(0, LIST_LIMIT)
    .map(({ p, last }) => ({
      number: num.get(p.id) ?? 0,
      who: p.clientId.slice(-4),
      firstStopId: p.firstStopId,
      firstAt: p.firstAt.toISOString(),
      lastAt: last.toISOString(),
      scans: p.scans,
      stopIds: p.stopIds,
      scanDays: p.scanDays,
      returns: p.returns,
      teaser: p.teaserAt !== null,
    }));
  return {
    days,
    total: persons.length,
    newInPeriod: fresh.length,
    returning: persons.filter(isReturning).length,
    multiStop: persons.filter((p) => p.stopIds.length >= 2).length,
    teaser: persons.filter((p) => p.teaserAt !== null).length,
    daily: [...daily.entries()].map(([d, count]) => ({ day: d, count })).sort((a, b) => a.day.localeCompare(b.day)),
    firstStops: [...firstStops.entries()].map(([stopId, count]) => ({ stopId, count })).sort((a, b) => b.count - a.count || a.stopId.localeCompare(b.stopId)),
    people,
  };
}

export async function stickerPeopleStats(prisma: Db, opts: { cityCode: string; days: StatsDays; now?: Date }): Promise<StickerPeopleStats> {
  return buildStickerPeople(await cityPeople(prisma, opts.cityCode), opts.now ?? new Date(), opts.days);
}
