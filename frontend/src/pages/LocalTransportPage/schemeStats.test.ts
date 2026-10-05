import { describe, it, expect } from 'vitest';
import { routeScheduleStats } from './schemeStats';

const trips = [
  { id: '3-01', routeId: '3', directionId: '1', departureTime: '06:40:00' },
  { id: '3-02', routeId: '3', directionId: '1', departureTime: '09:20:00' },
  { id: '3-03', routeId: '3', directionId: '0', departureTime: '18:30:00' },
  { id: '7-01', routeId: '7', directionId: '1', departureTime: '07:15:00' },
  { id: '7-02', routeId: '7', directionId: '0', departureTime: '19:45:00' },
  { id: '10-01', routeId: '10', directionId: '1', departureTime: null },
];

describe('routeScheduleStats', () => {
  it('counts trips per direction as a range and strips the leading zero of the clock', () => {
    expect(routeScheduleStats(trips, '3')).toEqual({ tripsPerDirection: '1–2', first: '6:40', last: '18:30' });
  });

  it('collapses equal direction counts to one number', () => {
    expect(routeScheduleStats(trips, '7')).toEqual({ tripsPerDirection: '1', first: '7:15', last: '19:45' });
  });

  it('returns null without timetabled trips', () => {
    expect(routeScheduleStats(trips, '10')).toBeNull();
    expect(routeScheduleStats(trips, '99')).toBeNull();
  });
});
