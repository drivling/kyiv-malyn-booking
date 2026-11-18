/**
 * Синхронізація електричок з ПЗЗ: рядки пар зі сторінки (листопад 2026), зіставлення з базою,
 * запис (нові / змінені / скасовані), обережність при збої сторінки, повідомлення в адмін-чат.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import { parseEltrainTimetable } from './swrailway-eltrain';
import {
  ELTRAIN_SOURCES,
  createEltrainSyncTick,
  eltrainSyncAlertHtml,
  eltrainSyncSummary,
  inheritPrice,
  planPair,
  reportHasChanges,
  rowsForPair,
  runEltrainSync,
  type ExistingEltrainRow,
} from './eltrain-sync';

const fromKyivHtml = readFileSync(join(__dirname, 'fixtures/swrailway-eltrain-kyiv-korosten-2026-11.html'), 'utf8');
const toKyivHtml = readFileSync(join(__dirname, 'fixtures/swrailway-eltrain-korosten-kyiv-2026-11.html'), 'utf8');
const fromKyiv = parseEltrainTimetable(fromKyivHtml);
const toKyiv = parseEltrainTimetable(toKyivHtml);
const [URL_FROM_KYIV, URL_TO_KYIV] = ELTRAIN_SOURCES.map((s) => s.url) as [string, string];

const brief = (rows: ReturnType<typeof rowsForPair>) =>
  rows.map((r) => `${r.tripNumber} ${r.departureTime}-${r.arrivalTime} ${r.activeWeekdays.join('')} ${r.boardingPlace} → ${r.alightingPlace}`);

describe('rowsForPair (сторінки ПЗЗ, листопад 2026)', () => {
  it('Київ → Коростень: кожен поїзд, що доїжджає до Коростеня, зі своєю станцією в Києві', () => {
    expect(brief(rowsForPair(fromKyiv, { from: 'Kyiv', to: 'Korosten' }))).toEqual([
      '6601 05:35-09:11 1234567 Київ-Пас. (Приміський) → Коростень',
      '855 09:20-12:20 12345 Київ-Пас. (Приміський) → Коростень',
      '6613 14:51-18:20 1234567 Київ-Пас. (Приміський) → Коростень',
      '859 17:30-20:18 123457 Київ-Пас. (Приміський) → Коростень',
      '6621 18:51-21:55 67 з.п. Борщагівка → Коростень',
      '6621 18:59-21:55 12345 Святошин → Коростень',
    ]);
  });

  it('Коростень → Київ: висадка — кінцева станція в Києві', () => {
    expect(brief(rowsForPair(toKyiv, { from: 'Korosten', to: 'Kyiv' }))).toEqual([
      '6606 04:10-07:42 7 Коростень → Київ-Пас. (Приміський)',
      '856 04:54-07:42 123456 Коростень → Київ-Пас. (Приміський)',
      '6610 05:50-09:06 123456 Коростень → з.п. Борщагівка',
      '6614 08:40-12:17 1234567 Коростень → Київ-Пас. (Приміський)',
      '860 13:29-16:23 12345 Коростень → Київ-Пас. (Приміський)',
      '6626 18:25-22:11 1234567 Коростень → Київ-Пас. (Приміський)',
    ]);
  });

  it('Київ → Малин: прибуття в Малин, а не в кінцеву; тетерівські поїзди не потрапляють', () => {
    const rows = brief(rowsForPair(fromKyiv, { from: 'Kyiv', to: 'Malyn' }));
    expect(rows).toContain('6601 05:35-08:01 1234567 Київ-Пас. (Приміський) → Малин');
    expect(rows).toContain('6605 08:50-11:11 1234567 Київ-Пас. (Приміський) → Малин');
    expect(rows.some((r) => r.startsWith('6603 ') || r.startsWith('6609 '))).toBe(false);
    expect(rows).toHaveLength(7);
  });

  it('Малин → Коростень: два 6621 з однаковим часом від Малина — один рядок щодня', () => {
    expect(brief(rowsForPair(fromKyiv, { from: 'Malyn', to: 'Korosten' }))).toEqual([
      '6601 08:03-09:11 1234567 Малин → Коростень',
      '855 11:32-12:20 12345 Малин → Коростень',
      '6613 17:13-18:20 1234567 Малин → Коростень',
      '859 19:30-20:18 123457 Малин → Коростень',
      '6621 20:49-21:55 1234567 Малин → Коростень',
    ]);
  });

  it('Малин → Київ: 6620 тепер починає в Малині, 6616 на сторінці немає', () => {
    const rows = brief(rowsForPair(toKyiv, { from: 'Malyn', to: 'Kyiv' }));
    expect(rows).toContain('6620 14:55-16:55 1234567 Малин → Святошин');
    expect(rows.some((r) => r.startsWith('6616 '))).toBe(false);
  });
});

const existingRow = (id: number, r: Partial<ExistingEltrainRow> & { tripNumber: string; departureTime: string }): ExistingEltrainRow => ({
  id,
  arrivalTime: '',
  durationMinutes: null,
  activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  boardingPlace: '',
  alightingPlace: '',
  priceUah: null,
  ticketPurchaseUrl: null,
  ...r,
});

describe('planPair', () => {
  it('зіставляє за номером і часом, за станцією посадки, за єдиним номером', () => {
    const desired = rowsForPair(fromKyiv, { from: 'Kyiv', to: 'Malyn' });
    const plan = planPair(desired, [
      existingRow(69, { tripNumber: '6621', departureTime: '18:51', boardingPlace: 'з.п. Борщагівка' }),
      existingRow(70, { tripNumber: '6621', departureTime: '18:40', boardingPlace: 'Святошин' }),
      existingRow(64, { tripNumber: '6601', departureTime: '05:30', boardingPlace: 'Десь' }),
      existingRow(99, { tripNumber: '6699', departureTime: '23:00' }),
    ]);
    expect(plan.update.map((u) => [u.id, u.after.departureTime])).toEqual([
      [69, '18:51'],
      [70, '18:59'],
      [64, '05:35'],
    ]);
    expect(plan.remove.map((r) => r.id)).toEqual([99]);
    expect(plan.create.map((r) => r.tripNumber).sort()).toEqual(['6605', '6613', '855', '859']);
  });

  it('незмінений рядок рахується як unchanged', () => {
    const [row] = rowsForPair(fromKyiv, { from: 'Kyiv', to: 'Korosten' });
    const plan = planPair([row!], [existingRow(1, { ...row!, activeWeekdays: [7, 6, 5, 4, 3, 2, 1] })]);
    expect(plan).toMatchObject({ create: [], update: [], remove: [], unchanged: 1 });
  });
});

describe('inheritPrice', () => {
  it('бере найчастішу ціну того ж класу поїзда', () => {
    const rows = [
      { tripNumber: '6601', priceUah: 60 },
      { tripNumber: '6605', priceUah: 60 },
      { tripNumber: '6613', priceUah: 55 },
      { tripNumber: '855', priceUah: 120 },
    ];
    expect(inheritPrice('6699', rows)).toBe(60);
    expect(inheritPrice('861', rows)).toBe(120);
    expect(inheritPrice('6699', [])).toBeNull();
  });
});

// ---------- запис у базу (Prisma у пам'яті) ----------

type Sched = {
  id: number;
  route: string;
  tripRouteId: number;
  startPointId: number | null;
  endPointId: number | null;
  viaPointIds: unknown;
  vehicleType: string;
  tripNumber: string | null;
  departureTime: string;
  arrivalTime: string | null;
  durationMinutes: number | null;
  activeWeekdays: unknown;
  boardingPlace: string | null;
  alightingPlace: string | null;
  priceUah: number | null;
  ticketPurchaseUrl: string | null;
  timetableSourceUrl: string | null;
};

const POINT = { Kyiv: 1, Malyn: 2, Korosten: 4 } as const;
const ROUTES = [
  { id: 4, slug: 'Kyiv-Malyn', startPointId: POINT.Kyiv, endPointId: POINT.Malyn },
  { id: 17, slug: 'Kyiv-Korosten', startPointId: POINT.Kyiv, endPointId: POINT.Korosten },
  { id: 6, slug: 'Malyn-Korosten', startPointId: POINT.Malyn, endPointId: POINT.Korosten },
  { id: 2, slug: 'Korosten-Malyn', startPointId: POINT.Korosten, endPointId: POINT.Malyn },
  { id: 15, slug: 'Korosten-Kyiv', startPointId: POINT.Korosten, endPointId: POINT.Kyiv },
  { id: 1, slug: 'Malyn-Kyiv', startPointId: POINT.Malyn, endPointId: POINT.Kyiv },
];

function memoryPrisma(seed: Sched[], bookings: Record<number, number> = {}) {
  const rows = new Map(seed.map((s) => [s.id, { ...s }]));
  let nextId = Math.max(100, ...seed.map((s) => s.id)) + 1;
  let writes = 0;
  const pick = (s: Sched, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, (s as Record<string, unknown>)[k]])) : s;
  const matches = (s: Sched, where: any): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === 'NOT') {
        const not = v as any;
        if (not.id?.in && not.id.in.includes(s.id)) return false;
        if ('ticketPurchaseUrl' in not && s.ticketPurchaseUrl === not.ticketPurchaseUrl) return false;
        continue;
      }
      if (k === 'id' && (v as any)?.in) {
        if (!(v as any).in.includes(s.id)) return false;
        continue;
      }
      if ((s as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  };
  const schedule = {
    findMany: async ({ where, select }: any) =>
      [...rows.values()]
        .filter((s) => matches(s, where))
        .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
        .map((s) => pick(s, select)),
    findFirst: async ({ where, select }: any) => {
      const s = [...rows.values()].sort((a, b) => a.id - b.id).find((x) => matches(x, where));
      return s ? pick(s, select) : null;
    },
    deleteMany: async ({ where }: any) => {
      writes++;
      for (const s of [...rows.values()]) if (matches(s, where)) rows.delete(s.id);
    },
    update: async ({ where, data }: any) => {
      writes++;
      const s = rows.get(where.id)!;
      const next = { ...s, ...data };
      if ([...rows.values()].some((o) => o.id !== s.id && o.tripRouteId === next.tripRouteId && o.departureTime === next.departureTime)) {
        throw new Error(`unique tripRouteId+departureTime ${next.departureTime}`);
      }
      rows.set(s.id, next);
      return next;
    },
    create: async ({ data }: any) => {
      writes++;
      if ([...rows.values()].some((o) => o.tripRouteId === data.tripRouteId && o.departureTime === data.departureTime)) {
        throw new Error(`unique tripRouteId+departureTime ${data.departureTime}`);
      }
      const s = { id: nextId++, ...data } as Sched;
      rows.set(s.id, s);
      return s;
    },
  };
  const prisma = {
    tripRoute: { findUnique: async ({ where }: any) => ROUTES.find((r) => r.slug === where.slug) ?? null },
    schedule,
    booking: { count: async ({ where }: any) => bookings[where.scheduleId] ?? 0 },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ schedule }),
  };
  return { prisma: prisma as unknown as PrismaClient, rows, writes: () => writes };
}

const TICKET = 'https://lnk.ua/8iLMTuFpe';
let seedId = 40;
const sched = (route: string, r: Partial<Sched> & { tripNumber: string; departureTime: string }): Sched => {
  const tr = ROUTES.find((x) => x.slug === route)!;
  return {
    id: ++seedId,
    route,
    tripRouteId: tr.id,
    startPointId: tr.startPointId,
    endPointId: tr.endPointId,
    viaPointIds: [],
    vehicleType: 'elektrichka',
    arrivalTime: null,
    durationMinutes: null,
    activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
    boardingPlace: null,
    alightingPlace: null,
    priceUah: 60,
    ticketPurchaseUrl: TICKET,
    timetableSourceUrl: route.startsWith('Kyiv') || route === 'Malyn-Korosten' ? URL_FROM_KYIV : URL_TO_KYIV,
    ...r,
  };
};

/** Стан продакшну на 18.11.2026 (частина): малинські пари є, київсько-коростенських немає. */
function prodLikeSeed(): Sched[] {
  return [
    sched('Malyn-Korosten', { tripNumber: '6601', departureTime: '08:03', arrivalTime: '09:11', durationMinutes: 68, boardingPlace: 'Малин', alightingPlace: 'Коростень', priceUah: 35 }),
    sched('Malyn-Korosten', { tripNumber: '855', departureTime: '11:32', arrivalTime: '12:20', durationMinutes: 48, activeWeekdays: [1, 2, 3, 4, 5], boardingPlace: 'Малин', alightingPlace: 'Коростень', priceUah: 120 }),
    sched('Malyn-Korosten', { tripNumber: '6613', departureTime: '17:13', arrivalTime: '18:20', durationMinutes: 67, boardingPlace: 'Малин', alightingPlace: 'Коростень', priceUah: 35 }),
    sched('Malyn-Korosten', { tripNumber: '859', departureTime: '19:30', arrivalTime: '20:18', durationMinutes: 48, activeWeekdays: [1, 2, 3, 4, 5, 7], boardingPlace: 'Малин', alightingPlace: 'Коростень', priceUah: 120 }),
    sched('Malyn-Korosten', { tripNumber: '6621', departureTime: '20:48', boardingPlace: 'Малин', alightingPlace: 'Коростень', priceUah: 35 }),
    sched('Malyn-Kyiv', { tripNumber: '6614', departureTime: '09:48', arrivalTime: '11:47', durationMinutes: 119, boardingPlace: 'Малин', alightingPlace: 'Святошин' }),
    sched('Malyn-Kyiv', { tripNumber: '6616', departureTime: '11:47', arrivalTime: '13:42', durationMinutes: 115, boardingPlace: 'Малин', alightingPlace: 'Святошин' }),
    sched('Malyn-Kyiv', { tripNumber: '6626', departureTime: '19:32', arrivalTime: '22:11', durationMinutes: 159, boardingPlace: 'Малин', alightingPlace: 'Київ-Пас. (Приміський)' }),
    // маршрутка на маршруті Київ → Коростень о тій самій хвилині, що й 6613
    sched('Kyiv-Korosten', { tripNumber: null as unknown as string, vehicleType: 'marshrutka', departureTime: '14:51', timetableSourceUrl: null, ticketPurchaseUrl: null }),
  ];
}

const fetchFixtures = async (url: string) => {
  if (url === URL_FROM_KYIV) return fromKyivHtml;
  if (url === URL_TO_KYIV) return toKyivHtml;
  throw new Error(`unexpected ${url}`);
};

describe('runEltrainSync', () => {
  it('додає Київ ↔ Коростень, оновлює змінені, прибирає скасовані', async () => {
    const db = memoryPrisma(prodLikeSeed());
    const report = await runEltrainSync(db.prisma, { fetchPage: fetchFixtures });
    expect(report.errors).toEqual([]);
    const byRoute = Object.fromEntries(report.pairs.map((p) => [p.route, p]));

    // Київ → Коростень: 6 поїздів, 6613 о 14:51 зіткнувся з маршруткою — не записано, у звіті
    expect(byRoute['Kyiv-Korosten']!.created.map((r) => r.tripNumber)).toEqual(['6601', '855', '859', '6621', '6621']);
    expect(byRoute['Kyiv-Korosten']!.conflicts.map((c) => c.row.tripNumber)).toEqual(['6613']);
    const kk = [...db.rows.values()].filter((s) => s.route === 'Kyiv-Korosten' && s.vehicleType === 'elektrichka');
    expect(kk).toHaveLength(5);
    expect(kk.every((s) => s.ticketPurchaseUrl === TICKET && s.timetableSourceUrl === URL_FROM_KYIV)).toBe(true);
    expect(kk.find((s) => s.tripNumber === '6601')).toMatchObject({
      departureTime: '05:35',
      arrivalTime: '09:11',
      durationMinutes: 216,
      boardingPlace: 'Київ-Пас. (Приміський)',
      alightingPlace: 'Коростень',
      startPointId: POINT.Kyiv,
      endPointId: POINT.Korosten,
      priceUah: null, // ціни пари ще немає — задає адмін, нові рейси далі її успадкують
    });

    // Коростень → Київ: шість нових
    expect(byRoute['Korosten-Kyiv']!.created).toHaveLength(6);

    // Малин → Коростень: 6621 тепер 20:49 → 21:55
    expect(byRoute['Malyn-Korosten']!.updated.map((u) => [u.after.tripNumber, u.after.departureTime, u.after.arrivalTime])).toEqual([
      ['6621', '20:49', '21:55'],
    ]);

    // Малин → Київ: 6616 скасовано, 6620 новий (ціна з приміських цієї пари), 6614 їде до Київ-Пас.
    const mk = byRoute['Malyn-Kyiv']!;
    expect(mk.removed.map((r) => r.tripNumber)).toEqual(['6616']);
    expect(mk.updated.map((u) => [u.after.tripNumber, u.after.arrivalTime, u.after.alightingPlace])).toEqual([
      ['6614', '12:17', 'Київ-Пас. (Приміський)'],
    ]);
    const malynKyiv = [...db.rows.values()].filter((s) => s.route === 'Malyn-Kyiv');
    expect(malynKyiv.some((s) => s.tripNumber === '6616')).toBe(false);
    expect(malynKyiv.find((s) => s.tripNumber === '6620')).toMatchObject({ departureTime: '14:55', priceUah: 60 });

    // Другий прогін — нічого нового (окрім того ж конфлікту з маршруткою)
    const again = await runEltrainSync(db.prisma, { fetchPage: fetchFixtures });
    expect(reportHasChanges(again)).toBe(false);
    expect(eltrainSyncSummary(again)).toMatch(/^нових 0, змінено 0, прибрано 0/);
  });

  it('dryRun нічого не пише', async () => {
    const db = memoryPrisma(prodLikeSeed());
    const report = await runEltrainSync(db.prisma, { fetchPage: fetchFixtures, dryRun: true });
    expect(reportHasChanges(report)).toBe(true);
    expect(db.writes()).toBe(0);
    expect(eltrainSyncAlertHtml(report)).toContain('що змінилось би');
  });

  it('зламана сторінка нічого не змінює', async () => {
    const db = memoryPrisma(prodLikeSeed());
    const report = await runEltrainSync(db.prisma, {
      fetchPage: async (url) => (url === URL_TO_KYIV ? '<html>технічні роботи</html>' : Promise.reject(new Error('timeout'))),
    });
    expect(report.pairs).toEqual([]);
    expect(report.errors.map((e) => e.error)).toEqual(['timeout', expect.stringMatching(/розібрано лише 0 поїздів/)]);
    expect(db.writes()).toBe(0);
    expect(eltrainSyncAlertHtml(report)).toContain('не все вдалось оновити');
  });

  it('пару, де зникла б більша частина рейсів, пропускає без force', async () => {
    const seed = prodLikeSeed().filter((s) => s.route === 'Malyn-Korosten');
    for (const s of seed) s.tripNumber = `9${s.tripNumber}`; // жоден номер не збігається зі сторінкою
    const db = memoryPrisma(seed);
    const sources = [{ url: URL_FROM_KYIV, pairs: [{ from: 'Malyn', to: 'Korosten' }] }];
    const report = await runEltrainSync(db.prisma, { fetchPage: fetchFixtures, sources });
    expect(report.pairs[0]).toMatchObject({ status: 'skipped', created: [], removed: [] });
    expect(report.pairs[0]!.reason).toMatch(/зникло б 5 з 5/);
    expect(db.writes()).toBe(0);

    const forced = await runEltrainSync(db.prisma, { fetchPage: fetchFixtures, sources, force: true });
    expect(forced.pairs[0]).toMatchObject({ status: 'ok' });
    expect(forced.pairs[0]!.removed).toHaveLength(5);
    expect(forced.pairs[0]!.created).toHaveLength(5);
  });

  it('скасований рейс з бронюваннями не видаляє', async () => {
    const seed = prodLikeSeed();
    const r6616 = seed.find((s) => s.tripNumber === '6616')!;
    const db = memoryPrisma(seed, { [r6616.id]: 2 });
    const report = await runEltrainSync(db.prisma, { fetchPage: fetchFixtures });
    const mk = report.pairs.find((p) => p.route === 'Malyn-Kyiv')!;
    expect(mk.removed).toEqual([]);
    expect(mk.conflicts[0]!.error).toMatch(/має 2 бронювань/);
    expect(db.rows.has(r6616.id)).toBe(true);
  });

  it('повідомлення перелічує зміни по парах', async () => {
    const db = memoryPrisma(prodLikeSeed());
    const html = eltrainSyncAlertHtml(await runEltrainSync(db.prisma, { fetchPage: fetchFixtures }));
    expect(html).toContain('Розклад електричок (ПЗЗ) оновлено');
    expect(html).toContain('<b>Київ → Коростень</b>');
    expect(html).toContain('➕ №6601 05:35→09:11 (щодня, Київ-Пас. (Приміський) → Коростень)');
    expect(html).toContain('➖ №6616 11:47→13:42 (щодня, Малин → Святошин)');
    expect(html).toContain('⚠️ №6613 14:51→18:20');
  });
});

describe('createEltrainSyncTick', () => {
  it('зміни — повідомлення; та сама проблема на наступних тіках — тиша; нова проблема — знову', async () => {
    const db = memoryPrisma(prodLikeSeed());
    const sent: string[] = [];
    let fail = false;
    const tick = createEltrainSyncTick(db.prisma, {
      notify: async (html) => sent.push(html),
      fetchPage: async (url) => (fail ? Promise.reject(new Error('503')) : fetchFixtures(url)),
      log: () => {},
    });
    await tick(); // нові рейси + конфлікт 6613 з маршруткою
    expect(sent).toHaveLength(1);
    await tick(); // змін немає, конфлікт той самий
    expect(sent).toHaveLength(1);
    fail = true;
    await tick(); // сайт упав — нова проблема
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('503');
    await tick();
    expect(sent).toHaveLength(2);
  });
});

describe('POST /schedules/eltrain-sync', () => {
  const ADMIN = 'eltrain-test-password';

  it('лише для адміна; dryRun зі збереженими сторінками нічого не пише', async () => {
    const db = memoryPrisma(prodLikeSeed());
    const app = createApp({ prisma: db.prisma, adminPassword: ADMIN });
    expect((await request(app).post('/schedules/eltrain-sync').send({ dryRun: true })).status).toBe(401);

    const res = await request(app)
      .post('/schedules/eltrain-sync')
      .set({ Authorization: adminAuthToken(ADMIN) })
      .send({
        dryRun: true,
        pages: [
          { url: URL_FROM_KYIV, html: fromKyivHtml },
          { url: URL_TO_KYIV, html: toKyivHtml },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.errors).toEqual([]);
    const kk = res.body.pairs.find((p: { route: string }) => p.route === 'Kyiv-Korosten');
    expect(kk.created.map((r: { tripNumber: string }) => r.tripNumber)).toEqual(['6601', '855', '859', '6621', '6621']);
    expect(db.writes()).toBe(0);
  });
});
