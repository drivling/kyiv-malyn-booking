/**
 * Чисті частини вкладки «Бронювання» (BookingsTab): коли поїздка (київська дата), фільтри, групування за днями,
 * підсумки для плиток. Без React — щоб перевіряти тестами окремо.
 */
import type { Booking } from '@/types';

/** Київська дата YYYY-MM-DD */
export const kyivDate = (d: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** День поїздки бронювання (дата зберігається як день, без часу) */
export const tripDate = (b: Pick<Booking, 'date'>) => b.date.slice(0, 10);

export const addDays = (day: string, n: number) => {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export type BookingWhen = 'upcoming' | 'today' | 'past' | 'all';
export type BookingKind = '' | 'schedule' | 'viber_match';

export const isBookingWhen = (s: string | null): s is BookingWhen => s === 'upcoming' || s === 'today' || s === 'past' || s === 'all';

/** Маршрутка чи попутка (старі рядки без `source` — маршрутки) */
export const bookingKind = (b: Pick<Booking, 'source'>): Exclude<BookingKind, ''> => (b.source === 'viber_match' ? 'viber_match' : 'schedule');

const WHEN_TESTS: Record<BookingWhen, (day: string, today: string) => boolean> = {
  upcoming: (d, t) => d >= t,
  today: (d, t) => d === t,
  past: (d, t) => d < t,
  all: () => true,
};

export function whenCounts(bookings: readonly Booking[], today: string): Record<BookingWhen, number> {
  const out = { upcoming: 0, today: 0, past: 0, all: 0 };
  for (const b of bookings) for (const k of Object.keys(out) as BookingWhen[]) if (WHEN_TESTS[k](tripDate(b), today)) out[k] += 1;
  return out;
}

const seatsOf = (list: readonly Booking[]) => list.reduce((s, b) => s + (b.seats || 0), 0);

/** Плитки: попереду, сьогодні, завтра (з місцями), нових за 7 днів, попуток попереду */
export function bookingTiles(bookings: readonly Booking[], today: string, now: Date = new Date()) {
  const tomorrow = addDays(today, 1);
  const upcoming = bookings.filter((b) => tripDate(b) >= today);
  const onDay = (d: string) => bookings.filter((b) => tripDate(b) === d);
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const fresh = bookings.filter((b) => new Date(b.createdAt).getTime() >= weekAgo);
  return {
    upcoming: upcoming.length,
    upcomingSeats: seatsOf(upcoming),
    today: onDay(today).length,
    todaySeats: seatsOf(onDay(today)),
    tomorrow: onDay(tomorrow).length,
    tomorrowSeats: seatsOf(onDay(tomorrow)),
    week: fresh.length,
    weekRides: fresh.filter((b) => bookingKind(b) === 'viber_match').length,
    upcomingRides: upcoming.filter((b) => bookingKind(b) === 'viber_match').length,
  };
}

export interface BookingFilter {
  when: BookingWhen;
  kind: BookingKind;
  route: string;
  date: string;
  query: string;
}

export const EMPTY_BOOKING_FILTER: Omit<BookingFilter, 'when'> = { kind: '', route: '', date: '', query: '' };

/** Відфільтровані й упорядковані: майбутні — від найближчих, минулі й «усі» — від найсвіжіших */
export function filterBookings(bookings: readonly Booking[], f: BookingFilter, today: string): Booking[] {
  const q = f.query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = bookings.filter((b) => {
    const d = tripDate(b);
    if (!WHEN_TESTS[f.when](d, today)) return false;
    if (f.kind && bookingKind(b) !== f.kind) return false;
    if (f.route && b.route !== f.route) return false;
    if (f.date && d !== f.date) return false;
    if (q) {
      const byName = b.name.toLowerCase().includes(q);
      const byPhone = digits.length >= 3 && b.phone.replace(/\D/g, '').includes(digits);
      if (!byName && !byPhone) return false;
    }
    return true;
  });
  const ascending = f.when === 'upcoming' || f.when === 'today';
  return list.sort((a, b) => {
    const key = (x: Booking) => `${tripDate(x)} ${x.departureTime || '00:00'}`;
    const c = key(a).localeCompare(key(b));
    return (ascending ? c : -c) || (ascending ? a.id - b.id : b.id - a.id);
  });
}

export interface BookingDay {
  date: string;
  bookings: Booking[];
  seats: number;
}

/** Групи за днем поїздки в тому ж порядку, що й список */
export function groupByDay(bookings: readonly Booking[]): BookingDay[] {
  const out: BookingDay[] = [];
  for (const b of bookings) {
    const d = tripDate(b);
    let g = out[out.length - 1];
    if (!g || g.date !== d) {
      g = { date: d, bookings: [], seats: 0 };
      out.push(g);
    }
    g.bookings.push(b);
    g.seats += b.seats || 0;
  }
  return out;
}

const WEEKDAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];

/** «Сьогодні, 21.11», «Завтра, 22.11», «Вчора, 20.11» або «середа, 26.11» */
export function dayTitle(day: string, today: string): string {
  const short = `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  if (day === today) return `Сьогодні, ${short}`;
  if (day === addDays(today, 1)) return `Завтра, ${short}`;
  if (day === addDays(today, -1)) return `Вчора, ${short}`;
  const wd = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return `${wd}, ${short}${day.slice(0, 4) !== today.slice(0, 4) ? `.${day.slice(0, 4)}` : ''}`;
}

/** Українська форма «місце / місця / місць» */
export function seatsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'місце';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'місця';
  return 'місць';
}
