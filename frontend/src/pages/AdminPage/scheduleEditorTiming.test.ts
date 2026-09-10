import { describe, it, expect } from 'vitest';
import {
  parseClockToMinutes,
  formatMinutesToClock,
  buildSegmentLookup,
  getSegmentDurationSec,
  computeTripTimes,
  clockAtStop,
  autoHeadsign,
  nextOppositeDeparture,
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

});

describe('computeTripTimes / clockAtStop', () => {
  const segments = [
    { routeId: '3', fromStopId: 'a', toStopId: 'b', seconds: 300 },
    { routeId: '3', fromStopId: 'b', toStopId: 'c', seconds: 600 },
  ];
  const lookup = buildSegmentLookup(segments);
  const chain = ['a', 'b', 'c'];
  const trip = { id: '3-01', routeId: '3', directionId: '1', departureTime: '06:40' };

  it('adds cumulative segment seconds to the departure time', () => {
    const t = computeTripTimes(trip, lookup, '3', chain, 120);
    expect(clockAtStop(t, 'a')).toBe('06:40');
    expect(clockAtStop(t, 'b')).toBe('06:45');
    expect(clockAtStop(t, 'c')).toBe('06:55');
  });

  it('returns null when the trip has no departureTime', () => {
    expect(computeTripTimes({ ...trip, departureTime: null }, lookup, '3', chain, 120)).toBeNull();
    expect(clockAtStop(null, 'a')).toBeNull();
  });

  it('honours start/end stops: unserved stops have no clock', () => {
    const t = computeTripTimes({ ...trip, startStopId: 'b' }, lookup, '3', chain, 120);
    expect(clockAtStop(t, 'a')).toBeNull();
    expect(clockAtStop(t, 'b')).toBe('06:40');
    expect(clockAtStop(t, 'c')).toBe('06:50');
    const e = computeTripTimes({ ...trip, endStopId: 'b' }, lookup, '3', chain, 120);
    expect(clockAtStop(e, 'c')).toBeNull();
  });

  it('compresses to arrivalTime when segments overshoot, never stretches', () => {
    const t = computeTripTimes({ ...trip, arrivalTime: '06:50' }, lookup, '3', chain, 120)!;
    expect(t.factor).toBeCloseTo(10 / 15, 6);
    expect(clockAtStop(t, 'c')).toBe('06:50');
    expect(clockAtStop(t, 'b')).toBe('06:43'); // 5 хв × 0.667 = 3.33 → 06:43
    const slack = computeTripTimes({ ...trip, arrivalTime: '07:30' }, lookup, '3', chain, 120)!;
    expect(slack.factor).toBe(1);
    expect(clockAtStop(slack, 'c')).toBe('06:55');
  });
});

describe('autoHeadsign', () => {
  it('fills empty or previous-end-name headsigns, keeps custom text', () => {
    expect(autoHeadsign('', null, 'Вокзал')).toBe('Вокзал');
    expect(autoHeadsign('Вокзал', 'Вокзал', 'Центр')).toBe('Центр');
    expect(autoHeadsign('Малинівка, Юрівка, БАМ', 'Вокзал', 'Центр')).toBe('Малинівка, Юрівка, БАМ');
  });
});

describe('nextOppositeDeparture', () => {
  const trips = [
    { id: '5-01', routeId: '5', directionId: '1', departureTime: '05:45' },
    { id: '5-02', routeId: '5', directionId: '0', departureTime: '06:10' },
    { id: '5-03', routeId: '5', directionId: '0', departureTime: '05:40' },
    { id: '5-04', routeId: '5', directionId: '1', departureTime: '06:40' },
    { id: '7-01', routeId: '7', directionId: '0', departureTime: '06:00' },
  ];
  it('finds the earliest later trip in the other direction of the same route', () => {
    expect(nextOppositeDeparture(trips, trips[0])).toBe('06:10');
    expect(nextOppositeDeparture(trips, trips[1])).toBe('06:40');
  });
  it('returns null without a departure or without a later opposite trip', () => {
    expect(nextOppositeDeparture(trips, { ...trips[0], departureTime: null })).toBeNull();
    expect(nextOppositeDeparture(trips, trips[3])).toBeNull();
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
