import { describe, it, expect } from 'vitest';
import { parseClockToMinutes, sortTripsByDeparture, tripDepartureMinutes } from './tripDeparture';

describe('tripDeparture', () => {
  it('parseClockToMinutes', () => {
    expect(parseClockToMinutes('08:30')).toBe(8 * 60 + 30);
    expect(parseClockToMinutes('18:00:00')).toBe(18 * 60);
    expect(parseClockToMinutes('not-a-time')).toBe(0);
    expect(parseClockToMinutes(undefined)).toBe(0);
  });

  it('tripDepartureMinutes prefers departure_time', () => {
    expect(tripDepartureMinutes({ departure_time: '09:15:00', block_id: 'AA1234' })).toBe(9 * 60 + 15);
    expect(tripDepartureMinutes({ departure_time: '', block_id: '07:40' })).toBe(7 * 60 + 40);
  });

  it('sortTripsByDeparture', () => {
    const a = { departure_time: '10:00:00', block_id: null };
    const b = { departure_time: '08:00:00', block_id: null };
    expect(sortTripsByDeparture(a, b)).toBeGreaterThan(0);
    expect(sortTripsByDeparture(b, a)).toBeLessThan(0);
  });
});
