import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildTripReminderSms } from './telegram';
import {
  bookingDepartureAt,
  dueReminders,
  kyivTodayStart,
  planReminders,
  runDueBookingReminders,
  sendManualReminders,
  type ReminderDeps,
} from './booking-reminders';

// 14 жовтня 2026, Київ UTC+3 (літній час до 25.10). Вечір = 13.10 17:00Z, ранок = 14.10 05:00Z.
const TRIP = new Date(2026, 9, 14);
const z = (s: string) => new Date(s);
const bk = (departureTime: string, createdAt: string) => ({ date: TRIP, departureTime, createdAt: z(createdAt) });

describe('bookingDepartureAt', () => {
  it('київський HH:MM → UTC; сміття → null', () => {
    expect(bookingDepartureAt(TRIP, '17:00')?.toISOString()).toBe('2026-10-14T14:00:00.000Z');
    expect(bookingDepartureAt(TRIP, '9:05')?.toISOString()).toBe('2026-10-14T06:05:00.000Z');
    expect(bookingDepartureAt(TRIP, 'вранці')).toBeNull();
  });
});

describe('planReminders', () => {
  it('заздалегідь: вечір + ранок, без «перед поїздкою»', () => {
    expect(planReminders(bk('17:00', '2026-10-10T09:00:00Z')).map((p) => p.kind)).toEqual(['evening', 'morning']);
  });
  it('бронь вдень на вечір (приклад із задачі): лише soon_120 за 2 год', () => {
    const plans = planReminders(bk('17:00', '2026-10-14T08:00:00Z')); // 11:00 Київ → 17:00, 6 год
    expect(plans.map((p) => p.kind)).toEqual(['soon_120']);
    expect(plans[0].at.toISOString()).toBe('2026-10-14T12:00:00.000Z'); // 15:00 Київ
  });
  it('до поїздки <2 год, але ≥30 хв → за 30 хв', () => {
    const plans = planReminders(bk('17:00', '2026-10-14T13:00:00Z')); // 16:00 Київ, лишилась 1 год
    expect(plans.map((p) => p.kind)).toEqual(['soon_30']);
    expect(plans[0].at.toISOString()).toBe('2026-10-14T13:30:00.000Z');
  });
  it('до поїздки <30 хв → без нагадувань', () => {
    expect(planReminders(bk('17:00', '2026-10-14T13:40:00Z'))).toEqual([]);
  });
  it('бронь пізно ввечері на завтра: ранок покриває, soon не потрібен', () => {
    expect(planReminders(bk('17:00', '2026-10-13T20:00:00Z')).map((p) => p.kind)).toEqual(['morning']);
  });
  it('ранній виліт (08:20): ранок запізно → soon_120; 07:00 із ранньою бронню → лише вечір', () => {
    expect(planReminders(bk('08:20', '2026-10-13T20:00:00Z')).map((p) => p.kind)).toEqual(['soon_120']);
    expect(planReminders(bk('07:00', '2026-10-10T09:00:00Z')).map((p) => p.kind)).toEqual(['evening']);
  });
  it('час не розпізнано: лише evening/morning', () => {
    expect(planReminders(bk('вранці', '2026-10-14T08:00:00Z'))).toEqual([]);
    expect(planReminders(bk('вранці', '2026-10-10T09:00:00Z')).map((p) => p.kind)).toEqual(['evening', 'morning']);
  });
});

describe('dueReminders', () => {
  const early = bk('17:00', '2026-10-10T09:00:00Z');
  it('вечір о 20:00 Київ (17:00Z) і ще 90 хв', () => {
    expect(dueReminders(early, z('2026-10-13T16:59:00Z'))).toEqual([]);
    expect(dueReminders(early, z('2026-10-13T17:00:00Z'))).toEqual(['evening']);
    expect(dueReminders(early, z('2026-10-13T18:29:00Z'))).toEqual(['evening']);
    expect(dueReminders(early, z('2026-10-13T18:31:00Z'))).toEqual([]);
  });
  it('ранок о 08:00 Київ (05:00Z)', () => {
    expect(dueReminders(early, z('2026-10-14T04:59:00Z'))).toEqual([]);
    expect(dueReminders(early, z('2026-10-14T05:00:00Z'))).toEqual(['morning']);
    expect(dueReminders(early, z('2026-10-14T06:31:00Z'))).toEqual([]);
  });
  it('ранок не шлемо, якщо до поїздки <30 хв (бронь о 08:40, виліт 09:00 → бронь після ранку)', () => {
    const b = bk('08:20', '2026-10-10T09:00:00Z'); // виліт 05:20Z; ранок 05:00Z — лишилось 20 хв
    expect(dueReminders(b, z('2026-10-14T05:00:00Z'))).toEqual([]);
  });
  it('soon: вікно 15 хв і не після відправлення', () => {
    const b = bk('17:00', '2026-10-14T08:00:00Z');
    expect(dueReminders(b, z('2026-10-14T11:59:00Z'))).toEqual([]);
    expect(dueReminders(b, z('2026-10-14T12:00:00Z'))).toEqual(['soon_120']);
    expect(dueReminders(b, z('2026-10-14T12:16:00Z'))).toEqual([]);
  });
});

describe('kyivTodayStart', () => {
  it('після півночі за Києвом — уже наступна доба', () => {
    expect(kyivTodayStart(z('2026-10-13T22:30:00Z'))).toEqual(new Date(2026, 9, 14));
    expect(kyivTodayStart(z('2026-10-13T20:30:00Z'))).toEqual(new Date(2026, 9, 13));
  });
});

type Row = {
  id: number; route: string; source: string | null; date: Date; departureTime: string; createdAt: Date;
  name: string; phone: string; personId: number | null; telegramChatId: string | null;
  viberListing: { senderName: string | null; phone: string } | null;
};
const row = (over: Partial<Row>): Row => ({
  id: 1, route: 'Kyiv-Malyn', source: 'schedule', date: TRIP, departureTime: '17:00',
  createdAt: z('2026-10-10T09:00:00Z'), name: 'Іван', phone: '380501234567', personId: null,
  telegramChatId: '555', viberListing: null, ...over,
});

function harness(rows: Row[]) {
  const claimed = new Set<string>();
  const findMany = vi.fn(async (_a: unknown) => rows);
  const prisma = {
    booking: { findMany },
    bookingReminder: {
      create: vi.fn(async ({ data }: { data: { bookingId: number; kind: string } }) => {
        const key = `${data.bookingId}:${data.kind}`;
        if (claimed.has(key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        claimed.add(key);
        return { id: claimed.size };
      }),
      update: vi.fn(async () => ({})),
    },
  } as unknown as PrismaClient;
  const deps: ReminderDeps = {
    isEnabled: () => true,
    sendBot: vi.fn(async () => ({ delivered: 'bot' as const })),
    sendSmsOnly: vi.fn(async () => ({ delivered: 'sms' as const })),
  };
  return { prisma, deps, findMany };
}

describe('runDueBookingReminders', () => {
  it('шле вечірнє один раз навіть за кілька тіків; Telegram → бот, без чату → SMS', async () => {
    const { prisma, deps } = harness([row({ id: 1 }), row({ id: 2, telegramChatId: null })]);
    const at = z('2026-10-13T17:00:00Z');
    const first = await runDueBookingReminders(prisma, deps, at);
    const second = await runDueBookingReminders(prisma, deps, new Date(at.getTime() + 60_000));
    expect(first).toMatchObject({ total: 2, sent: 1, smsSent: 1, duplicate: 0 });
    expect(second).toMatchObject({ total: 2, duplicate: 2, sent: 0, smsSent: 0 });
    expect(deps.sendBot).toHaveBeenCalledTimes(1);
    expect(deps.sendBot).toHaveBeenCalledWith('555', expect.objectContaining({ bookingId: 1 }), 'tomorrow');
    expect(deps.sendSmsOnly).toHaveBeenCalledTimes(1);
  });
  it('нічого не шле поза часом нагадування і коли бот вимкнено', async () => {
    const h = harness([row({})]);
    expect(await runDueBookingReminders(h.prisma, h.deps, z('2026-10-13T12:00:00Z'))).toMatchObject({ total: 0 });
    const off = harness([row({})]);
    off.deps.isEnabled = () => false;
    await runDueBookingReminders(off.prisma, off.deps, z('2026-10-13T17:00:00Z'));
    expect(off.findMany).not.toHaveBeenCalled();
  });
  it('«перед поїздкою» для пізньої броні шле з потрібним текстом (in2h)', async () => {
    const { prisma, deps } = harness([row({ createdAt: z('2026-10-14T08:00:00Z') })]);
    await runDueBookingReminders(prisma, deps, z('2026-10-14T12:00:00Z'));
    expect(deps.sendBot).toHaveBeenCalledWith('555', expect.anything(), 'in2h');
  });
  it('збій відправки рахується як failed і не кидає', async () => {
    const { prisma, deps } = harness([row({})]);
    deps.sendBot = vi.fn(async () => { throw new Error('boom'); });
    const c = await runDueBookingReminders(prisma, deps, z('2026-10-13T17:00:00Z'));
    expect(c.failed).toBe(1);
  });
});

describe('sendManualReminders', () => {
  it('evening бере завтрашню добу, morning — сьогоднішню, і ділить журнал із таймером', async () => {
    const h = harness([row({})]);
    const now = z('2026-10-13T10:00:00Z');
    const manual = await sendManualReminders(h.prisma, h.deps, 'evening', now);
    expect(manual).toMatchObject({ total: 1, sent: 1 });
    const where = (h.findMany.mock.calls[0][0] as { where: { date: { gte: Date; lt: Date } } }).where.date;
    expect(where.gte).toEqual(new Date(2026, 9, 14));
    expect(where.lt).toEqual(new Date(2026, 9, 15));
    const timer = await runDueBookingReminders(h.prisma, h.deps, z('2026-10-13T17:00:00Z'));
    expect(timer).toMatchObject({ duplicate: 1, sent: 0 }); // таймер не дублює ручний запуск
  });
});

describe('buildTripReminderSms: «перед поїздкою»', () => {
  const base = { route: 'Kyiv-Malyn', date: TRIP, departureTime: '17:00', name: 'Іван', phone: '380501234567' };
  it('за 2 год і за 30 хв', () => {
    expect(buildTripReminderSms(base, 'in2h')).toMatch(/^Через 2 години у вас поїздка: /);
    expect(buildTripReminderSms(base, 'in30m')).toMatch(/^Через 30 хвилин у вас поїздка: /);
  });
});
