import { describe, expect, it } from 'vitest';
import { differs, timeCandidates } from './transport-time-check';
import type { RunSpan, RunTimesReport } from './transport-gps-times';

const span = (fromName: string, toName: string, ourMin: number, gpsMin: number | null, confidence: RunSpan['confidence'] = 'ok'): RunSpan => ({
  fromStopId: fromName,
  toStopId: toName,
  fromName,
  toName,
  meters: 1000,
  ourSec: ourMin * 60,
  gpsSec: gpsMin === null ? null : gpsMin * 60,
  passes: confidence === 'ok' ? 20 : 4,
  confidence,
});

const report = (spans: RunSpan[], routeNo = '4'): RunTimesReport => ({
  routes: [{ routeId: routeNo, routeNo, points: 100, directions: [{ direction: 'there', meters: 3000, ourSec: 0, gpsSec: 0, covered: 1, timetableSec: null, passes: 20, spans }] }],
  unknownRouteNos: [],
});

describe('час у дорозі трьома джерелами: наш розклад, GPS, Google', () => {
  it('«різне» — понад 2 хв і понад 20 %', () => {
    expect(differs(18, 14)).toBe(true);
    expect(differs(10, 12)).toBe(false);
    expect(differs(40, 47)).toBe(false);
    expect(differs(40, 49)).toBe(true);
  });

  it('GPS і Google разом проти нас — перерахувати; лише GPS — теж кандидат; GPS згоден з нами — гаразд', () => {
    // вокзал → Київська: у нас 18 хв (6 + 6 + 6), GPS — 14, Google — 14 (№4, як у звірці 2026-11-22)
    const r = report([span('Вокзал', 'Ринок', 6, 4), span('Ринок', 'Центр', 6, 5), span('Центр', 'Київська', 6, 5)]);
    expect(timeCandidates(r, [{ from: 'Вокзал', to: 'Київська', verdict: 'google_faster', routeNo: '4', googleMin: 14, routes: ['4'] }])).toEqual([
      { routeNo: '4', direction: 'there', from: 'Вокзал', to: 'Київська', ourMin: 18, gpsMin: 14, googleMin: 14, verdict: 'recalc', weak: false },
    ]);
    // Google каже як ми, а GPS — інакше: головний GPS
    expect(timeCandidates(r, [{ from: 'Вокзал', to: 'Київська', verdict: 'same', routeNo: '4', googleMin: 18, routes: ['4'] }])[0].verdict).toBe('gps');
    // GPS підтверджує нас, хоч Google швидший (№5: у нас 24, GPS 21, Google 30 — так було з білокоровицьким шосе)
    const five = report([span('Вокзал', 'Шосе', 24, 21)], '5');
    expect(timeCandidates(five, [{ from: 'Вокзал', to: 'Шосе', verdict: 'ours_faster', routeNo: '5', googleMin: 30, routes: ['5'] }])[0].verdict).toBe('ok');
  });

  it('без GPS — лише коли Google розходиться з нами; мало проїздів — позначено; чужа лінія й пари не з цього напрямку — пропускаємо', () => {
    const r = report([span('Вокзал', 'Ринок', 6, null), span('Ринок', 'Центр', 6, 5, 'few')]);
    expect(timeCandidates(r, [{ from: 'Вокзал', to: 'Центр', verdict: 'google_faster', routeNo: '4', googleMin: 7, routes: ['4'] }])).toEqual([
      { routeNo: '4', direction: 'there', from: 'Вокзал', to: 'Центр', ourMin: 12, gpsMin: null, googleMin: 7, verdict: 'google_only', weak: true },
    ]);
    expect(timeCandidates(r, [{ from: 'Вокзал', to: 'Центр', verdict: 'same', routeNo: '4', googleMin: 12, routes: ['4'] }])).toEqual([]);
    expect(timeCandidates(r, [{ from: 'Ринок', to: 'Центр', verdict: 'same', routeNo: '4', googleMin: 6, routes: ['4'] }])[0]).toMatchObject({ verdict: 'ok', weak: true });
    // Google поїхав іншою лінією — його хвилин не беремо, але GPS нашої лінії все одно звіряємо
    expect(timeCandidates(r, [{ from: 'Ринок', to: 'Центр', verdict: 'other_line', routes: ['4'] }])[0]).toMatchObject({ googleMin: null, verdict: 'ok' });
    expect(timeCandidates(r, [{ from: 'Центр', to: 'Вокзал', verdict: 'same', routeNo: '4', googleMin: 6, routes: ['4'] }])).toEqual([]);
    expect(timeCandidates(r, [{ from: 'Вокзал', to: 'Центр', verdict: 'same', routeNo: '7', googleMin: 6, routes: ['7'] }])).toEqual([]);
    // «2-Б» і «2Б» — той самий номер
    expect(timeCandidates(report([span('А', 'Б', 10, 20)], '2-Б'), [{ from: 'А', to: 'Б', verdict: 'same', routeNo: '2Б', googleMin: 10, routes: ['2-Б'] }])[0].verdict).toBe('gps');
  });
});
