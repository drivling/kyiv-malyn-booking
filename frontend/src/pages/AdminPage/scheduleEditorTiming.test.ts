import { describe, it, expect } from 'vitest';
import {
  parseClockToMinutes,
  formatMinutesToClock,
  buildSegmentLookup,
  getSegmentDurationSec,
  getDurationFromStartSec,
  computeStopArrivalClock,
  compareTripsByDeparture,
  nextTripId,
} from './scheduleEditorTiming';

describe('parseClockToMinutes', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(parseClockToMinutes('06:40')).toBe(400);
    expect(parseClockToMinutes('06:40:00')).toBe(400);
    expect(parseClockToMinutes('18:05')).toBe(18 * 60 + 5);
  });

  it('returns null for empty/invalid input', () => {
    expect(parseClockToMinutes(null)).toBeNull();
    expect(parseClockToMinutes(undefined)).toBeNull();
    expect(parseClockToMinutes('')).toBeNull();
    expect(parseClockToMinutes('not-a-time')).toBeNull();
  });
});

describe('formatMinutesToClock', () => {
  it('formats and zero-pads', () => {
    expect(formatMinutesToClock(400)).toBe('06:40');
    expect(formatMinutesToClock(5)).toBe('00:05');
  });

  it('wraps past midnight', () => {
    expect(formatMinutesToClock(24 * 60 + 30)).toBe('00:30');
  });
});

describe('segment duration lookup', () => {
  const segments = [
    { routeId: '3', fromStopId: 'a', toStopId: 'b', seconds: 60 },
    { routeId: '3', fromStopId: 'b', toStopId: 'c', seconds: 90 },
  ];
  const lookup = buildSegmentLookup(segments);

  it('finds exact key', () => {
    expect(getSegmentDurationSec(lookup, '3', 'a', 'b', 120)).toBe(60);
  });

  it('finds reverse key (back direction reuses same segment)', () => {
    expect(getSegmentDurationSec(lookup, '3', 'b', 'a', 120)).toBe(60);
  });

  it('falls back to defaultSec when missing', () => {
    expect(getSegmentDurationSec(lookup, '3', 'x', 'y', 120)).toBe(120);
  });

  it('sums duration from start via getDurationFromStartSec', () => {
    const ordered = ['a', 'b', 'c'];
    expect(getDurationFromStartSec(lookup, '3', ordered, 0, 120)).toBe(0);
    expect(getDurationFromStartSec(lookup, '3', ordered, 1, 120)).toBe(60);
    expect(getDurationFromStartSec(lookup, '3', ordered, 2, 120)).toBe(150);
  });
});

describe('computeStopArrivalClock', () => {
  const segments = [
    { routeId: '3', fromStopId: 'a', toStopId: 'b', seconds: 300 },
    { routeId: '3', fromStopId: 'b', toStopId: 'c', seconds: 600 },
  ];
  const lookup = buildSegmentLookup(segments);
  const ordered = ['a', 'b', 'c'];

  it('adds cumulative segment seconds to the departure time', () => {
    expect(computeStopArrivalClock('06:40', lookup, '3', ordered, 0, 120)).toBe('06:40');
    expect(computeStopArrivalClock('06:40', lookup, '3', ordered, 1, 120)).toBe('06:45');
    expect(computeStopArrivalClock('06:40', lookup, '3', ordered, 2, 120)).toBe('06:55');
  });

  it('returns null when the trip has no departureTime', () => {
    expect(computeStopArrivalClock(null, lookup, '3', ordered, 1, 120)).toBeNull();
  });
});

describe('compareTripsByDeparture', () => {
  it('sorts by departure time ascending', () => {
    const trips = [
      { id: '3-02', routeId: '3', departureTime: '08:15' },
      { id: '3-01', routeId: '3', departureTime: '06:40' },
    ];
    expect(trips.slice().sort(compareTripsByDeparture).map((t) => t.id)).toEqual(['3-01', '3-02']);
  });

  it('pushes trips without departureTime to the end', () => {
    const trips = [
      { id: '10-02', routeId: '10', departureTime: null },
      { id: '10-01', routeId: '10', departureTime: '07:00' },
    ];
    expect(trips.slice().sort(compareTripsByDeparture).map((t) => t.id)).toEqual(['10-01', '10-02']);
  });
});

describe('nextTripId', () => {
  it('increments the max numeric suffix for the route, zero-padded', () => {
    const trips = [
      { id: '3-01', routeId: '3' },
      { id: '3-21', routeId: '3' },
      { id: '3-05', routeId: '3' },
      { id: '11-09', routeId: '11' },
    ];
    expect(nextTripId('3', trips)).toBe('3-22');
  });

  it('starts at 01 when the route has no trips yet', () => {
    expect(nextTripId('6', [])).toBe('6-01');
  });
});
