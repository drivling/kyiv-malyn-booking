/**
 * Перевірка телефону для POST /bookings (обов’язкове поле + нормалізація як у домені).
 */
import { normalizePhone } from '../telegram';

export const BOOKING_MISSING_FIELDS_MESSAGE = 'Missing required fields' as const;

export function validateBookingPhoneInput(
  phone: unknown
): { ok: true; raw: string } | { ok: false; error: string } {
  if (phone == null) {
    return { ok: false, error: BOOKING_MISSING_FIELDS_MESSAGE };
  }
  const raw = typeof phone === 'string' ? phone.trim() : String(phone).trim();
  if (!raw) {
    return { ok: false, error: BOOKING_MISSING_FIELDS_MESSAGE };
  }
  const normalized = normalizePhone(raw);
  if (!normalized) {
    return { ok: false, error: 'Invalid phone number' };
  }
  return { ok: true, raw };
}
