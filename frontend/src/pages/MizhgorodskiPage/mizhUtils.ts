import type { BookingCity } from '@/utils/constants';
import { BOOKING_CITY_LABELS, getDirectionFromCities } from '@/utils/constants';
import type { Direction } from '@/types';

/** Коридор через Малин: один «далекий» кінець + напрямок */
export type CorridorId = 'kyiv' | 'zhytomyr' | 'korosten';

export type TransportFilter = 'all' | 'carpool' | 'bus' | 'train';

/** ISO weekday 1=Mon … 7=Sun for YYYY-MM-DD */
export function isoWeekdayFromDate(date: string): number {
  const d = new Date(`${date.slice(0, 10)}T12:00:00`);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

export function isScheduleActiveOnDate(activeWeekdays: number[] | undefined | null, date: string): boolean {
  const days =
    Array.isArray(activeWeekdays) && activeWeekdays.length > 0
      ? activeWeekdays
      : [1, 2, 3, 4, 5, 6, 7];
  return days.includes(isoWeekdayFromDate(date));
}

export function isElektrichka(schedule: { vehicleType?: string | null }): boolean {
  return schedule.vehicleType === 'elektrichka';
}

export function isMarshrutka(schedule: { vehicleType?: string | null }): boolean {
  return !isElektrichka(schedule);
}

export const CORRIDORS: {
  id: CorridorId;
  city: Exclude<BookingCity, 'Malyn'>;
  label: string;
  shortLabel: string;
}[] = [
  { id: 'kyiv', city: 'Kyiv', label: 'Київ ↔ Малин', shortLabel: 'Київ' },
  { id: 'zhytomyr', city: 'Zhytomyr', label: 'Житомир ↔ Малин', shortLabel: 'Житомир' },
  { id: 'korosten', city: 'Korosten', label: 'Коростень ↔ Малин', shortLabel: 'Коростень' },
];

export function corridorFromCity(city: BookingCity): CorridorId | null {
  if (city === 'Kyiv') return 'kyiv';
  if (city === 'Zhytomyr') return 'zhytomyr';
  if (city === 'Korosten') return 'korosten';
  return null;
}

export function citiesFromCorridor(
  corridor: CorridorId,
  /** true = з Малина назовні, false = до Малина */
  fromMalyn: boolean
): { from: BookingCity; to: BookingCity } {
  const city = CORRIDORS.find((c) => c.id === corridor)!.city;
  return fromMalyn ? { from: 'Malyn', to: city } : { from: city, to: 'Malyn' };
}

export function directionFromCities(from: BookingCity, to: BookingCity): Direction | null {
  return getDirectionFromCities(from, to);
}

export function formatRouteLabel(route: string): string {
  const labels: Record<string, string> = {
    Kyiv: 'Київ',
    Malyn: 'Малин',
    Zhytomyr: 'Житомир',
    Korosten: 'Коростень',
    Irpin: 'Ірпінь',
    Bucha: 'Буча',
  };
  const parts = route.split('-').filter(Boolean);
  if (parts.length < 2) return route;
  const from = labels[parts[0]] ?? parts[0];
  const to = labels[parts[1]] ?? parts[1];
  const via = parts.slice(2).map((p) => labels[p] ?? p);
  if (via.length > 0) return `${from} → ${to} (через ${via.join(', ')})`;
  return `${from} → ${to}`;
}

export function formatTripDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', weekday: 'short' });
}

export function formatTripDateShort(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

export function getDateValue(date: string): number | null {
  const value = new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
  return Number.isNaN(value) ? null : value;
}

export function getTimeMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const normalized = time.trim().split('-')[0];
  const match = normalized.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function routeMatchesCities(route: string, from: string, to: string): boolean {
  const direction = getDirectionFromCities(from as BookingCity, to as BookingCity);
  const r = route.toLowerCase();
  if (direction) {
    const d = direction.toLowerCase();
    // direction e.g. kyiv-malyn; route may be kyiv-malyn-irpin OR corridor kyiv-malyn
    return r === d || r.startsWith(`${d}-`) || r.includes(d);
  }
  // Free OD pair (e.g. Irpin-Malyn): exact slug match on first two segments
  const slug = `${from}-${to}`.toLowerCase();
  return r === slug || r.startsWith(`${slug}-`);
}

/** Passenger OD lies on itinerary stops in the same direction. */
export function isOdAlongItinerary(
  itineraryPointIds: number[],
  fromPointId: number,
  toPointId: number
): boolean {
  if (!itineraryPointIds.length || fromPointId === toPointId) return false;
  const fromIdx = itineraryPointIds.indexOf(fromPointId);
  const toIdx = itineraryPointIds.indexOf(toPointId);
  if (fromIdx < 0 || toIdx < 0) return false;
  return fromIdx < toIdx;
}

/**
 * Dual-read listing filter for search from/to:
 * 1) exact OD by point ids
 * 2) along-route: listing.tripRouteId stops contain from→to in order
 * 3) corridor slug / route string fallback
 */
export function listingMatchesCities(
  listing: {
    route: string;
    tripRouteId?: number | null;
    fromPointId?: number | null;
    toPointId?: number | null;
  },
  from: string,
  to: string,
  corridorById?: Map<number, { slug: string }>,
  pointIdByCode?: Map<string, number>,
  stopsByTripRouteId?: Map<number, number[]>
): boolean {
  const fromId = pointIdByCode?.get(from);
  const toId = pointIdByCode?.get(to);
  if (fromId != null && toId != null) {
    if (listing.fromPointId === fromId && listing.toPointId === toId) {
      return true;
    }
    if (
      listing.tripRouteId != null &&
      stopsByTripRouteId?.has(listing.tripRouteId) &&
      isOdAlongItinerary(stopsByTripRouteId.get(listing.tripRouteId)!, fromId, toId)
    ) {
      return true;
    }
  }
  if (listing.tripRouteId != null && corridorById?.has(listing.tripRouteId)) {
    return routeMatchesCities(corridorById.get(listing.tripRouteId)!.slug, from, to);
  }
  return routeMatchesCities(listing.route, from, to);
}

export const HOME_CITY_COOKIE = 'malin_home_city';
export const DEFAULT_HOME_CITY_CODE = 'Malyn';

export function readHomeCityCookie(): string {
  if (typeof document === 'undefined') return DEFAULT_HOME_CITY_CODE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${HOME_CITY_COOKIE}=([^;]*)`));
  const raw = match ? decodeURIComponent(match[1]) : '';
  return raw.trim() || DEFAULT_HOME_CITY_CODE;
}

export function writeHomeCityCookie(code: string, maxAgeDays = 365): void {
  if (typeof document === 'undefined') return;
  const maxAge = Math.max(1, Math.round(maxAgeDays * 24 * 60 * 60));
  document.cookie = `${HOME_CITY_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export type QuickDirectChip = {
  id: string;
  otherCode: string;
  otherNameUk: string;
  label: string;
};

/** Build «Other ↔ Home» chips from home city's quickDirectPointIds. */
export function buildQuickDirectChips(
  home: { id: number; code: string; nameUk: string; quickDirectPointIds?: number[] } | null | undefined,
  allPoints: Array<{ id: number; code: string; nameUk: string }>
): QuickDirectChip[] {
  if (!home) return [];
  const byId = new Map(allPoints.map((p) => [p.id, p]));
  const chips: QuickDirectChip[] = [];
  for (const id of home.quickDirectPointIds || []) {
    const other = byId.get(id);
    if (!other || other.id === home.id) continue;
    chips.push({
      id: `${other.code}-${home.code}`,
      otherCode: other.code,
      otherNameUk: other.nameUk,
      label: `${other.nameUk} ↔ ${home.nameUk}`,
    });
  }
  return chips;
}

/** Fallback chips when DB quickDirect is empty (legacy Malyn corridors). */
export function legacyMalynCorridorChips(): QuickDirectChip[] {
  return CORRIDORS.map((c) => ({
    id: c.id,
    otherCode: c.city,
    otherNameUk: c.shortLabel,
    label: c.label,
  }));
}

export function citiesFromQuickChip(
  homeCode: string,
  otherCode: string,
  /** true = from home outward */
  fromHome: boolean
): { from: string; to: string } {
  return fromHome ? { from: homeCode, to: otherCode } : { from: otherCode, to: homeCode };
}

export function addMinutesToHhMm(departureTime: string, offsetMinutes: number | null | undefined): string {
  if (offsetMinutes == null || !Number.isFinite(offsetMinutes) || offsetMinutes === 0) {
    return departureTime;
  }
  const base = getTimeMinutes(departureTime);
  if (base == null) return departureTime;
  const total = ((base + Math.round(offsetMinutes)) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function boardingTimeAtStop(
  scheduleDepartureTime: string,
  stops: Array<{ pointId: number; position: number; departureOffsetMinutes?: number | null }> | undefined,
  boardPointId: number | undefined
): string {
  if (boardPointId == null || !stops?.length) return scheduleDepartureTime;
  const stop = [...stops]
    .sort((a, b) => a.position - b.position || a.pointId - b.pointId)
    .find((s) => s.pointId === boardPointId);
  if (!stop) return scheduleDepartureTime;
  return addMinutesToHhMm(scheduleDepartureTime, stop.departureOffsetMinutes ?? 0);
}

export function cityLabel(city: BookingCity | string): string {
  if (city in BOOKING_CITY_LABELS) return BOOKING_CITY_LABELS[city as BookingCity];
  return String(city);
}

/** Міста з маршруту запису (наприклад "Kyiv-Malyn-Irpin" → Київ / Малин) */
export function routeCityLabels(route: string): { from: string; to: string } | null {
  const parts = route.split('-').filter(Boolean);
  if (parts.length < 2) return null;
  const label = formatRouteLabel(`${parts[0]}-${parts[1]}`);
  const [from, to] = label.split(' → ');
  if (!from || !to) return null;
  return { from, to };
}

export function todayISO(): string {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
}

export function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
}
