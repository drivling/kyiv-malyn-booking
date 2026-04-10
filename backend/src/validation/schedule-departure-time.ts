/**
 * Суворий час відправлення для графіка / бронювань: HH:MM, 00–23 години.
 */
export const SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE =
  'Invalid time format. Use HH:MM (e.g., 08:00)' as const;

const SCHEDULE_TIME_REGEX = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

export function isValidScheduleDepartureTime(value: string): boolean {
  return SCHEDULE_TIME_REGEX.test(value);
}
