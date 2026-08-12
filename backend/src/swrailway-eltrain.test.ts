import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  durationMinutesBetween,
  findTrainByNumber,
  mapDaysNoteToActiveWeekdays,
  parseEltrainTimetable,
  pickStationTimes,
  resolveTrainForSchedule,
  stationNameMatches,
} from './swrailway-eltrain';

const fixture = readFileSync(
  join(__dirname, 'fixtures/swrailway-eltrain-korosten-kyiv.html'),
  'utf8'
);

const fixtureKyiv = readFileSync(
  join(__dirname, 'fixtures/swrailway-eltrain-kyiv-korosten.html'),
  'utf8'
);

describe('mapDaysNoteToActiveWeekdays', () => {
  it('maps common notes', () => {
    expect(mapDaysNoteToActiveWeekdays('щоденно')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(mapDaysNoteToActiveWeekdays('крім нд.')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mapDaysNoteToActiveWeekdays('крім сб., нд.')).toEqual([1, 2, 3, 4, 5]);
    expect(mapDaysNoteToActiveWeekdays('по нд.')).toEqual([7]);
    expect(mapDaysNoteToActiveWeekdays('крім сб.')).toEqual([1, 2, 3, 4, 5, 7]);
    expect(mapDaysNoteToActiveWeekdays('по сб., нд.')).toEqual([6, 7]);
  });
});

describe('parseEltrainTimetable fixture', () => {
  const trains = parseEltrainTimetable(fixture);

  it('parses train columns', () => {
    const nums = trains.map((t) => t.tripNumber);
    expect(nums).toContain('6606');
    expect(nums).toContain('856');
    expect(nums).toContain('6616');
    expect(nums).toContain('6626');
    expect(trains.length).toBeGreaterThanOrEqual(10);
  });

  it('resolves Malyn departure for 6606 / 856 / 6616', () => {
    const t6606 = findTrainByNumber(trains, '6606')[0]!;
    expect(pickStationTimes(t6606, 'Малин', 'Київ').departureTime).toBe('05:18');
    expect(pickStationTimes(t6606, 'Малин', 'Київ').arrivalTime).toBe('07:42');

    const t856 = findTrainByNumber(trains, '856')[0]!;
    expect(pickStationTimes(t856, 'Малин', 'Київ').departureTime).toBe('05:45');

    const t6616 = findTrainByNumber(trains, '6616')[0]!;
    expect(pickStationTimes(t6616, 'Малин', 'Святошин').departureTime).toBe('11:47');
    expect(pickStationTimes(t6616, 'Малин', 'Святошин').arrivalTime).toBe('13:42');
  });

  it('maps 856 days note to except Sunday', () => {
    const t856 = findTrainByNumber(trains, '856')[0]!;
    expect(t856.activeWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('helpers', () => {
  it('stationNameMatches Kyiv aliases', () => {
    expect(stationNameMatches('Київ-Пас. (Приміський)', 'Київ')).toBe(true);
    expect(stationNameMatches('Святошин', 'Святошин')).toBe(true);
    expect(stationNameMatches('Святошин', 'Київ', { exactKyivTerminals: true })).toBe(false);
    expect(stationNameMatches('з.п. Борщагівка', 'Борщагівка')).toBe(true);
  });

  it('durationMinutesBetween', () => {
    expect(durationMinutesBetween('05:18', '07:42')).toBe(144);
  });
});

describe('parseEltrainTimetable Kyiv→Malyn fixture', () => {
  const trains = parseEltrainTimetable(fixtureKyiv);

  it('keeps duplicate trip numbers as separate columns', () => {
    const t6621 = findTrainByNumber(trains, '6621');
    expect(t6621.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves board by Kyiv-area station', () => {
    const t6601 = findTrainByNumber(trains, '6601')[0]!;
    expect(pickStationTimes(t6601, 'Київ-Пас. (Приміський)', 'Малин').departureTime).toBe('05:35');
    expect(pickStationTimes(t6601, 'Київ-Пас. (Приміський)', 'Малин').arrivalTime).toBe('08:01');

    const weekday = resolveTrainForSchedule(trains, '6621', 'Святошин');
    expect(weekday.status).toBe('ok');
    expect(pickStationTimes(weekday.train!, 'Святошин', 'Малин').departureTime).toBe('18:59');

    const weekend = resolveTrainForSchedule(trains, '6621', 'з.п. Борщагівка');
    expect(weekend.status).toBe('ok');
    expect(pickStationTimes(weekend.train!, 'з.п. Борщагівка', 'Малин').departureTime).toBe('18:51');
  });
});
