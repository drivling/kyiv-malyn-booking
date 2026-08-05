import type { BookingCity } from '@/utils/constants';
import { BOOKING_CITY_LABELS, getDirectionFromCities } from '@/utils/constants';
import type { Direction } from '@/types';

/** Коридор через Малин: один «далекий» кінець + напрямок */
export type CorridorId = 'kyiv' | 'zhytomyr' | 'korosten';

export type TransportFilter = 'all' | 'carpool' | 'bus';

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
  return route
    .replace('Kyiv-Malyn', 'Київ → Малин')
    .replace('Malyn-Kyiv', 'Малин → Київ')
    .replace('Malyn-Zhytomyr', 'Малин → Житомир')
    .replace('Zhytomyr-Malyn', 'Житомир → Малин')
    .replace('Korosten-Malyn', 'Коростень → Малин')
    .replace('Malyn-Korosten', 'Малин → Коростень')
    .replace('-Irpin', ' (через Ірпінь)')
    .replace('-Bucha', ' (через Бучу)');
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

export function routeMatchesCities(route: string, from: BookingCity, to: BookingCity): boolean {
  const direction = getDirectionFromCities(from, to);
  if (!direction) return false;
  const r = route.toLowerCase();
  const d = direction.toLowerCase();
  // direction e.g. kyiv-malyn; route may be kyiv-malyn-irpin
  return r.includes(d) || r.startsWith(d);
}

export function cityLabel(city: BookingCity): string {
  return BOOKING_CITY_LABELS[city];
}

export function todayISO(): string {
  const today = new Date();
  return today.toISOString().split('T')[0];
}
