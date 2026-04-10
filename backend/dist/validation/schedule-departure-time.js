"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE = void 0;
exports.isValidScheduleDepartureTime = isValidScheduleDepartureTime;
/**
 * Суворий час відправлення для графіка / бронювань: HH:MM, 00–23 години.
 */
exports.SCHEDULE_DEPARTURE_TIME_INVALID_MESSAGE = 'Invalid time format. Use HH:MM (e.g., 08:00)';
const SCHEDULE_TIME_REGEX = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
function isValidScheduleDepartureTime(value) {
    return SCHEDULE_TIME_REGEX.test(value);
}
