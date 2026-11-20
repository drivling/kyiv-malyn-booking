import { describe, expect, it } from 'vitest';
import type { AdminViberListing } from '@/types';
import { EMPTY_FILTER, filterListings, kyivDate, listingChannel, listingCounts, tripDay } from './viberText';

const l = (over: Partial<AdminViberListing>): AdminViberListing => ({
  id: 1,
  rawMessage: '',
  senderName: 'Інна',
  listingType: 'driver',
  route: 'Kyiv-Malyn',
  tripRouteId: 1,
  date: '2026-11-20T00:00:00.000Z',
  departureTime: '18:00',
  seats: 3,
  phone: '380671112233',
  notes: null,
  isActive: true,
  authorNotifiedAt: '2026-11-19T10:00:00Z',
  createdAt: '2026-11-19T10:00:00Z',
  updatedAt: '2026-11-19T10:00:00Z',
  ...over,
});

const LIST = [
  l({ id: 1 }),
  l({ id: 2, listingType: 'passenger', departureTime: null, source: 'telegram1', sourceChat: 'PoDoroguem' }),
  l({ id: 3, phone: '', tripRouteId: null, authorNotifiedAt: null, date: '2026-11-21T00:00:00.000Z', departureTime: '07:30' }),
  l({ id: 4, isActive: false, departureTime: null }),
];

describe('viberText', () => {
  it('підсумки рахують лише активні', () => {
    expect(listingCounts(LIST, '2026-11-20')).toEqual({
      total: 4, active: 3, drivers: 2, passengers: 1, today: 2, telegram: 1, viber: 2, notime: 1, nophone: 1, noroute: 1, unnotified: 1,
    });
  });

  it('фільтри: стан, тип, вада, пошук і порядок за часом поїздки', () => {
    expect(filterListings(LIST, EMPTY_FILTER).map((x) => x.id)).toEqual([3, 2, 1]);
    expect(filterListings(LIST, { ...EMPTY_FILTER, state: 'all', issue: 'notime' }).map((x) => x.id)).toEqual([4, 2]);
    expect(filterListings(LIST, { ...EMPTY_FILTER, kind: 'passenger' }).map((x) => x.id)).toEqual([2]);
    expect(filterListings(LIST, { ...EMPTY_FILTER, sort: 'trip' }).map((x) => x.id)).toEqual([2, 1, 3]);
    expect(filterListings(LIST, { ...EMPTY_FILTER, query: 'інна', date: '2026-11-21' }).map((x) => x.id)).toEqual([3]);
  });

  it('канал, день поїздки словами й київська дата', () => {
    expect(listingChannel(LIST[1])).toBe('telegram');
    expect(listingChannel(LIST[0])).toBe('viber');
    expect(tripDay('2026-11-20T00:00:00.000Z', '2026-11-20')).toBe('сьогодні');
    expect(tripDay('2026-11-21', '2026-11-20')).toBe('завтра');
    expect(tripDay('2026-12-01', '2026-11-20')).toBe('01.12');
    expect(kyivDate(new Date('2026-11-20T22:30:00Z'))).toBe('2026-11-21');
  });
});
