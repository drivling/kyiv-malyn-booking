/**
 * Нагадування про поїздку, які раніше запускали зовнішні cron-job.org (20:00 і 08:00).
 *
 * Для кожного бронювання (час — київський, `departureTime` "HH:MM"):
 *   • evening — за день до поїздки о 20:00;
 *   • morning — у день поїздки о 08:00;
 *   • soon    — один раз перед поїздкою, лише коли бронь не потрапила під evening/morning
 *               (створена пізно ввечері/вранці або поїздка раніше за 08:30): за 2 години, а якщо до
 *               поїздки на момент броні було менше 2 год — за 30 хв; менше 30 хв — не нагадуємо.
 * Кожне нагадування шлеться не більше одного разу: унікальний ключ BookingReminder(bookingId, kind)
 * «захоплюється» перед відправкою, тож таймер, ручні POST і два контейнери під час деплою не дублюють.
 * Прострочене (сервер лежав) нагадування не надсилаємо — це підказка в часі, а не архів.
 */
import type { PrismaClient } from '@prisma/client';
import { kyivWallToUtc } from './viber-listing-expiry';
import {
  isTelegramEnabled,
  sendTripReminderSmsOnly,
  sendTripReminderVia,
  type TripReminderBooking,
  type TripReminderDelivery,
  type TripReminderWhen,
} from './telegram';

export type ReminderKind = 'evening' | 'morning' | 'soon_120' | 'soon_30';

const MIN = 60_000;
export const EVENING_HOUR = 20;
export const MORNING_HOUR = 8;
/** Ранкове нагадування має сенс, лише якщо до поїздки лишається щонайменше стільки. */
export const MIN_LEAD_MS = 30 * MIN;
export const SOON_LONG_MS = 120 * MIN;
/** Скільки після запланованого часу ще вважаємо нагадування актуальним. */
export const EVENING_MORNING_CATCHUP_MS = 90 * MIN;
export const SOON_CATCHUP_MS = 15 * MIN;

const KIND_WHEN: Record<ReminderKind, TripReminderWhen> = {
  evening: 'tomorrow',
  morning: 'today',
  soon_120: 'in2h',
  soon_30: 'in30m',
};

export interface ReminderBookingTimes {
  /** Доба поїздки (північ локального часу процесу, як у решті проєкту) */
  date: Date;
  departureTime: string;
  createdAt: Date;
}

/** Момент відправлення (UTC) з київського "HH:MM"; null — час не розпізнано. */
export function bookingDepartureAt(date: Date, departureTime: string): Date | null {
  const m = departureTime.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return kyivWallToUtc(date.getFullYear(), date.getMonth(), date.getDate(), Number(m[1]), Number(m[2]));
}

export interface ReminderPlan {
  kind: ReminderKind;
  /** Коли слати (UTC) */
  at: Date;
}

/**
 * Усі нагадування, що можуть існувати для броні (з їхнім часом). `soon` є лише якщо evening і morning
 * бронь не покривають. Прострочені/неактуальні відсіює `dueReminders`.
 */
export function planReminders(b: ReminderBookingTimes): ReminderPlan[] {
  const y = b.date.getFullYear();
  const mo = b.date.getMonth();
  const d = b.date.getDate();
  const departure = bookingDepartureAt(b.date, b.departureTime);
  const eveningAt = kyivWallToUtc(y, mo, d - 1, EVENING_HOUR, 0);
  const morningAt = kyivWallToUtc(y, mo, d, MORNING_HOUR, 0);

  const plans: ReminderPlan[] = [];
  const eveningCovers = b.createdAt < eveningAt;
  const morningCovers = b.createdAt < morningAt && (!departure || departure.getTime() - morningAt.getTime() >= MIN_LEAD_MS);
  if (eveningCovers) plans.push({ kind: 'evening', at: eveningAt });
  if (morningCovers) plans.push({ kind: 'morning', at: morningAt });

  if (!eveningCovers && !morningCovers && departure) {
    const untilDeparture = departure.getTime() - b.createdAt.getTime();
    if (untilDeparture >= SOON_LONG_MS) {
      plans.push({ kind: 'soon_120', at: new Date(departure.getTime() - SOON_LONG_MS) });
    } else if (untilDeparture >= MIN_LEAD_MS) {
      plans.push({ kind: 'soon_30', at: new Date(departure.getTime() - MIN_LEAD_MS) });
    }
  }
  return plans;
}

/** Нагадування, які треба надіслати саме зараз. */
export function dueReminders(b: ReminderBookingTimes, now: Date): ReminderKind[] {
  const departure = bookingDepartureAt(b.date, b.departureTime);
  const t = now.getTime();
  return planReminders(b)
    .filter(({ kind, at }) => {
      const catchup = kind.startsWith('soon') ? SOON_CATCHUP_MS : EVENING_MORNING_CATCHUP_MS;
      if (t < at.getTime() || t > at.getTime() + catchup) return false;
      if (!departure) return true;
      // після відправлення — нізащо; evening/morning ще й не пізніше ніж за 30 хв до поїздки
      return kind.startsWith('soon') ? t < departure.getTime() : departure.getTime() - t >= MIN_LEAD_MS;
    })
    .map((p) => p.kind);
}

export interface ReminderDeps {
  isEnabled: () => boolean;
  sendBot: (chatId: string, booking: TripReminderBooking, when: TripReminderWhen) => Promise<TripReminderDelivery>;
  sendSmsOnly: (booking: TripReminderBooking, when: TripReminderWhen) => Promise<TripReminderDelivery>;
}

export const defaultReminderDeps: ReminderDeps = {
  isEnabled: isTelegramEnabled,
  sendBot: sendTripReminderVia,
  sendSmsOnly: sendTripReminderSmsOnly,
};

export interface ReminderCounters {
  total: number;
  sent: number;
  smsSent: number;
  failed: number;
  skipped: number;
  /** Уже надіслано раніше (інший тік/контейнер/ручний виклик) */
  duplicate: number;
}

const emptyCounters = (): ReminderCounters => ({ total: 0, sent: 0, smsSent: 0, failed: 0, skipped: 0, duplicate: 0 });

type BookingForReminder = {
  id: number;
  route: string;
  source: string | null;
  date: Date;
  departureTime: string;
  createdAt: Date;
  name: string;
  phone: string;
  personId: number | null;
  telegramChatId: string | null;
  viberListing: { senderName: string | null; phone: string } | null;
};

function toReminderBooking(b: BookingForReminder): TripReminderBooking {
  return {
    route: b.route,
    source: b.source,
    date: b.date,
    departureTime: b.departureTime,
    name: b.name,
    driver: b.viberListing ? { senderName: b.viberListing.senderName, phone: b.viberListing.phone } : undefined,
    personId: b.personId,
    phone: b.phone,
    bookingId: b.id,
  };
}

/** Захоплює (bookingId, kind) і шле; повертає false, якщо це нагадування вже було. */
async function claimAndSend(
  prisma: PrismaClient,
  deps: ReminderDeps,
  booking: BookingForReminder,
  kind: ReminderKind,
  counters: ReminderCounters,
): Promise<void> {
  counters.total++;
  let claimId: number;
  try {
    claimId = (await prisma.bookingReminder.create({ data: { bookingId: booking.id, kind }, select: { id: true } })).id;
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      counters.duplicate++;
      return;
    }
    throw e;
  }
  const when = KIND_WHEN[kind];
  const rb = toReminderBooking(booking);
  try {
    const d = booking.telegramChatId
      ? await deps.sendBot(booking.telegramChatId, rb, when)
      : await deps.sendSmsOnly(rb, when);
    if (d.delivered === 'bot') counters.sent++;
    else if (d.delivered === 'sms') counters.smsSent++;
    else if (booking.telegramChatId) counters.failed++;
    else counters.skipped++; // немає Telegram і платний SMS не пройшов/вимкнено
    await prisma.bookingReminder.update({ where: { id: claimId }, data: { delivered: d.delivered } }).catch(() => undefined);
  } catch (error) {
    console.error(`❌ Не вдалося надіслати нагадування ${kind} для booking #${booking.id}:`, error);
    counters.failed++;
  }
}

const KYIV_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Доба «сьогодні за Києвом» як локальна північ процесу (так зберігається Booking.date). */
export function kyivTodayStart(now: Date): Date {
  const [y, m, d] = KYIV_DATE.format(now).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const bookingInclude = { viberListing: { select: { senderName: true, phone: true } } } as const;

/** Один прохід таймера: усі нагадування, що настали (бронювання на сьогодні й завтра за Києвом). */
export async function runDueBookingReminders(
  prisma: PrismaClient,
  deps: ReminderDeps,
  now: Date = new Date(),
): Promise<ReminderCounters> {
  const counters = emptyCounters();
  if (!deps.isEnabled()) return counters;
  const today = kyivTodayStart(now);
  const dayAfterTomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
  const bookings = await prisma.booking.findMany({
    where: { date: { gte: today, lt: dayAfterTomorrow } },
    include: bookingInclude,
  });
  for (const booking of bookings) {
    for (const kind of dueReminders(booking, now)) {
      await claimAndSend(prisma, deps, booking, kind, counters);
    }
  }
  return counters;
}

/**
 * Ручний запуск (POST /telegram/send-reminders[-today]): усі бронювання на завтра (evening) або сьогодні
 * (morning) без перевірки часу, але з тим самим журналом — повторний виклик не дублює повідомлення.
 */
export async function sendManualReminders(
  prisma: PrismaClient,
  deps: ReminderDeps,
  kind: 'evening' | 'morning',
  now: Date = new Date(),
): Promise<ReminderCounters> {
  const counters = emptyCounters();
  const today = kyivTodayStart(now);
  const day = kind === 'evening' ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1) : today;
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { date: { gte: day, lt: next } },
    include: bookingInclude,
  });
  for (const booking of bookings) await claimAndSend(prisma, deps, booking, kind, counters);
  return counters;
}
