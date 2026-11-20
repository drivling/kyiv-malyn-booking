/**
 * Чисті частини вкладки «Попутки» (ViberTab): лічильники, фільтри й сортування оголошень з Viber і Telegram-груп.
 * Без React — щоб перевіряти тестами окремо.
 */
import type { AdminViberListing } from '@/types';

/** Що не так з оголошенням: без часу, без телефону, не привʼязане до маршруту, автору нічого не надіслано */
export type ListingIssue = 'none' | 'notime' | 'nophone' | 'noroute' | 'unnotified';

const ISSUE_TESTS: Record<Exclude<ListingIssue, 'none'>, (l: AdminViberListing) => boolean> = {
  notime: (l) => !l.departureTime?.trim(),
  nophone: (l) => !l.phone?.trim(),
  noroute: (l) => l.tripRouteId == null,
  unnotified: (l) => !l.authorNotifiedAt,
};

export const isListingIssue = (s: string | null): s is ListingIssue =>
  s === 'none' || s === 'notime' || s === 'nophone' || s === 'noroute' || s === 'unnotified';

export const ISSUE_LABEL: Record<Exclude<ListingIssue, 'none'>, string> = {
  notime: 'Без часу',
  nophone: 'Без телефону',
  noroute: 'Без маршруту',
  unnotified: 'Автора не сповіщено',
};

export type ListingState = 'active' | 'all';
export type ListingKind = '' | 'driver' | 'passenger';
export type ListingSort = 'new' | 'trip';

export interface ListingFilter {
  state: ListingState;
  kind: ListingKind;
  issue: ListingIssue;
  route: string;
  date: string;
  query: string;
  sort: ListingSort;
}

export const EMPTY_FILTER: ListingFilter = { state: 'active', kind: '', issue: 'none', route: '', date: '', query: '', sort: 'new' };

/** Звідки оголошення: Telegram-група чи Viber-чат (`source` — грубий канал, `sourceChat` — лише в Telegram) */
export const listingChannel = (l: AdminViberListing): 'telegram' | 'viber' =>
  l.source?.toLowerCase().startsWith('telegram') || l.sourceChat ? 'telegram' : 'viber';

/** Київська дата YYYY-MM-DD для «сьогодні» */
export const kyivDate = (now: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Підсумки по активних оголошеннях (плитки вгорі) — не залежать від фільтрів */
export function listingCounts(listings: readonly AdminViberListing[], today: string) {
  const active = listings.filter((l) => l.isActive);
  const issue = (k: Exclude<ListingIssue, 'none'>) => active.filter(ISSUE_TESTS[k]).length;
  return {
    total: listings.length,
    active: active.length,
    drivers: active.filter((l) => l.listingType === 'driver').length,
    passengers: active.filter((l) => l.listingType === 'passenger').length,
    today: active.filter((l) => l.date.slice(0, 10) === today).length,
    telegram: active.filter((l) => listingChannel(l) === 'telegram').length,
    viber: active.filter((l) => listingChannel(l) === 'viber').length,
    notime: issue('notime'),
    nophone: issue('nophone'),
    noroute: issue('noroute'),
    unnotified: issue('unnotified'),
  };
}

export function filterListings(listings: readonly AdminViberListing[], f: ListingFilter): AdminViberListing[] {
  const route = f.route.trim().toLowerCase();
  const query = f.query.trim().toLowerCase();
  return listings
    .filter((l) => {
      if (f.state === 'active' && !l.isActive) return false;
      if (f.kind && l.listingType !== f.kind) return false;
      if (f.issue !== 'none' && !ISSUE_TESTS[f.issue](l)) return false;
      if (route && !l.route.toLowerCase().includes(route)) return false;
      if (f.date && l.date.slice(0, 10) !== f.date) return false;
      if (query) {
        const hay = `${l.phone ?? ''} ${l.senderName ?? ''} ${l.notes ?? ''} ${l.rawMessage}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (f.sort === 'new') return b.id - a.id;
      const da = a.date.slice(0, 10);
      const db = b.date.slice(0, 10);
      if (da !== db) return da.localeCompare(db);
      return ((a.departureTime || '').trim() || '00:00').localeCompare((b.departureTime || '').trim() || '00:00');
    });
}

/** «21.11» або «сьогодні» / «завтра» за київською датою */
export function tripDay(dateIso: string, today: string): string {
  const d = dateIso.slice(0, 10);
  if (d === today) return 'сьогодні';
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  if (d === t.toISOString().slice(0, 10)) return 'завтра';
  return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
}
