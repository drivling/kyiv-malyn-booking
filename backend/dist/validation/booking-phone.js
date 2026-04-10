"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOOKING_MISSING_FIELDS_MESSAGE = void 0;
exports.validateBookingPhoneInput = validateBookingPhoneInput;
/**
 * Перевірка телефону для POST /bookings (обов’язкове поле + нормалізація як у домені).
 */
const telegram_1 = require("../telegram");
exports.BOOKING_MISSING_FIELDS_MESSAGE = 'Missing required fields';
function validateBookingPhoneInput(phone) {
    if (phone == null) {
        return { ok: false, error: exports.BOOKING_MISSING_FIELDS_MESSAGE };
    }
    const raw = typeof phone === 'string' ? phone.trim() : String(phone).trim();
    if (!raw) {
        return { ok: false, error: exports.BOOKING_MISSING_FIELDS_MESSAGE };
    }
    const normalized = (0, telegram_1.normalizePhone)(raw);
    if (!normalized) {
        return { ok: false, error: 'Invalid phone number' };
    }
    return { ok: true, raw };
}
