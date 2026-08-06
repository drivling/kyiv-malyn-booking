import type { TransportRecord } from './types';

/**
 * Parse HH:MM or HH:MM:SS to minutes from midnight.
 * Returns 0 if the string is not a clock time (e.g. vehicle plate).
 */
export function parseClockToMinutes(s: string | undefined): number {
  if (!s) return 0;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * First-stop departure in minutes.
 * Prefers GTFS-style departure_time; falls back to legacy time-like block_id.
 */
export function tripDepartureMinutes(trip: Pick<TransportRecord, 'departure_time' | 'block_id'>): number {
  const fromDeparture = parseClockToMinutes(trip.departure_time);
  if (fromDeparture > 0) return fromDeparture;
  return parseClockToMinutes(trip.block_id);
}

export function sortTripsByDeparture(
  a: Pick<TransportRecord, 'departure_time' | 'block_id'>,
  b: Pick<TransportRecord, 'departure_time' | 'block_id'>
): number {
  return tripDepartureMinutes(a) - tripDepartureMinutes(b);
}
