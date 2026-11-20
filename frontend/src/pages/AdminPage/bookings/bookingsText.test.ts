import { describe, expect, it } from 'vitest';
import type { Booking } from '@/types';
import { addDays, bookingTiles, dayTitle, filterBookings, groupByDay, kyivDate, seatsWord, whenCounts } from './bookingsText';

const b = (over: Partial<Booking>): Booking => ({
  id: 1, route: 'Kyiv-Malyn-Irpin', date: '2026-11-21T00:00:00.000Z', departureTime: '08:00', seats: 1, name: 'Олена', phone: '380671112233',
  scheduleId: 1, source: 'schedule', createdAt: '2026-11-20T10:00:00.000Z', ...over,
});

const TODAY = '2026-11-21';
const LIST = [
  b({ id: 1, departureTime: '18:00', seats: 2 }),
  b({ id: 2, departureTime: '07:30' }),
  b({ id: 3, date: '2026-11-22T00:00:00.000Z', source: 'viber_match', seats: 3, name: 'Петро', phone: '380509998877' }),
  b({ id: 4, date: '2026-11-19T00:00:00.000Z', createdAt: '2026-11-01T10:00:00.000Z' }),
];

describe('bookingsText', () => {
  it('лічильники «коли» й плитки', () => {
    expect(whenCounts(LIST, TODAY)).toEqual({ upcoming: 3, today: 2, past: 1, all: 4 });
    expect(bookingTiles(LIST, TODAY, new Date('2026-11-21T12:00:00Z'))).toEqual({
      upcoming: 3, upcomingSeats: 6, today: 2, todaySeats: 3, tomorrow: 1, tomorrowSeats: 3, week: 3, weekRides: 1, upcomingRides: 1,
    });
  });

  it('попереду — від найближчих, минулі — від свіжих; пошук за телефоном і тип', () => {
    const f = { kind: '' as const, route: '', date: '', query: '' };
    expect(filterBookings(LIST, { ...f, when: 'upcoming' }, TODAY).map((x) => x.id)).toEqual([2, 1, 3]);
    expect(filterBookings(LIST, { ...f, when: 'all' }, TODAY).map((x) => x.id)).toEqual([3, 1, 2, 4]);
    expect(filterBookings(LIST, { ...f, when: 'all', query: '050 999' }, TODAY).map((x) => x.id)).toEqual([3]);
    expect(filterBookings(LIST, { ...f, when: 'upcoming', kind: 'viber_match' }, TODAY).map((x) => x.id)).toEqual([3]);
  });

  it('групи за днями, назви днів і слово «місць»', () => {
    const days = groupByDay(filterBookings(LIST, { kind: '', route: '', date: '', query: '', when: 'upcoming' }, TODAY));
    expect(days.map((d) => [d.date, d.bookings.length, d.seats])).toEqual([['2026-11-21', 2, 3], ['2026-11-22', 1, 3]]);
    expect(dayTitle('2026-11-21', TODAY)).toBe('Сьогодні, 21.11');
    expect(dayTitle('2026-11-22', TODAY)).toBe('Завтра, 22.11');
    expect(dayTitle('2026-11-20', TODAY)).toBe('Вчора, 20.11');
    expect(dayTitle('2026-11-26', TODAY)).toBe('четвер, 26.11');
    expect([1, 2, 5, 11, 21, 22].map(seatsWord)).toEqual(['місце', 'місця', 'місць', 'місць', 'місце', 'місця']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(kyivDate(new Date('2026-11-20T22:30:00Z'))).toBe('2026-11-21');
  });
});
