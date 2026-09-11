import { describe, expect, it } from 'vitest';
import type { Schedule } from '@/types';
import { arrivalsFromZhytomyr, buildAvtostantsiyaFaq, cityRoutesAtAutostation, groupDepartures } from './avtostantsiyaContent';

const row = (o: Partial<Schedule> & { from: string; to: string; via?: string[] }): Schedule =>
  ({
    id: Math.random(), route: `${o.from}-${o.to}`, departureTime: '08:00', maxSeats: 18, supportPhone: null, createdAt: '', updatedAt: '',
    vehicleType: 'marshrutka', activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
    startPoint: { code: o.from } as never, endPoint: { code: o.to } as never,
    tripRoute: { stops: [o.from, ...(o.via ?? []), o.to].map((c, i) => ({ id: i, pointId: i, position: i, role: 'via', point: { code: c } })) } as never,
    ...o,
  }) as unknown as Schedule;

describe('avtostantsiyaContent', () => {
  it('groups buses leaving Malyn by direction and drops trains', () => {
    const all = [
      row({ from: 'Malyn', to: 'Zhytomyr', departureTime: '06:50' }),
      row({ from: 'Malyn', to: 'Berdychiv', via: ['Zhytomyr'], departureTime: '12:15' }),
      row({ from: 'Malyn', to: 'Kyiv', departureTime: '05:00' }),
      row({ from: 'Malyn', to: 'Korosten', departureTime: '08:03', vehicleType: 'elektrichka' }),
      row({ from: 'Zhytomyr', to: 'Malyn', departureTime: '06:20' }),
    ];
    const groups = groupDepartures(all);
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([['zhytomyr', 2], ['kyiv', 1]]);
    expect(groups[0].rows.map((r) => r.departureTime)).toEqual(['06:50', '12:15']);
  });

  it('lists arrivals from Zhytomyr: terminus Malyn or transit through Malyn', () => {
    const all = [
      row({ from: 'Zhytomyr', to: 'Malyn', departureTime: '06:20', arrivalTime: '08:30' }),
      row({ from: 'Zhytomyr', to: 'Bazar', via: ['Potiivka', 'Malyn'], departureTime: '13:15' }),
      row({ from: 'Zhytomyr', to: 'Kyiv', departureTime: '07:00' }),
    ];
    expect(arrivalsFromZhytomyr(all).map((r) => r.departureTime)).toEqual(['06:20', '13:15']);
  });

  it('builds FAQ with phones, first/last to Zhytomyr and Kyiv, arrivals', () => {
    const groups = groupDepartures([
      row({ from: 'Malyn', to: 'Zhytomyr', departureTime: '18:00' }),
      row({ from: 'Malyn', to: 'Zhytomyr', departureTime: '05:20' }),
      row({ from: 'Malyn', to: 'Kyiv', departureTime: '05:00' }),
    ]);
    const faq = buildAvtostantsiyaFaq(groups, arrivalsFromZhytomyr([row({ from: 'Zhytomyr', to: 'Malyn', departureTime: '06:20' })]));
    expect(faq[0].a).toContain('(073) 182 40 49');
    expect(faq.find((f) => f.q.includes('на Житомир'))?.a).toContain('Перше відправлення о 05:20, останнє о 18:00');
    expect(faq.find((f) => f.q.includes('на Київ'))?.a).toContain('перша о 05:00');
    expect(faq.find((f) => f.q.includes('прибувають'))?.a).toContain('з 06:20 до 06:20');
  });
});

describe('cityRoutesAtAutostation (rule D1: link only to pages that exist)', () => {
  const dataset = {
    stops: [
      { id: 'st_0004', name: 'Автостанція', lat: 0, lng: 0 },
      { id: 'st_0005', name: 'Автостанція (навпроти)', lat: 0, lng: 0 },
      { id: 'st_0019', name: 'Залізничний вокзал', lat: 0, lng: 0 },
    ],
    routes: [
      { id: '10', fromName: '', toName: '', unreliable: true },
      { id: '10-old', fromName: 'A', toName: 'B' },
      { id: '8', fromName: 'Базар (Базарна площа)', toName: 'Залізничний вокзал' },
      { id: '5', fromName: 'Лікарня', toName: 'Залізничний вокзал' },
    ],
    routeStops: [
      { routeId: '10', stopId: 'st_0004' },
      { routeId: '10-old', stopId: 'st_0004' },
      { routeId: '8', stopId: 'st_0005' },
      { routeId: '5', stopId: 'st_0019' },
    ],
    trips: [],
    segments: [],
  } as never;

  it('returns routes serving either autostation stop, sorted by number, without -old', () => {
    expect(cityRoutesAtAutostation(dataset)).toEqual([
      { id: '8', line: 'Базар (Базарна площа) — Залізничний вокзал', published: true },
      { id: '10', line: null, published: false },
    ]);
  });

  it('treats an unreliable or unnamed route as pending, never published', () => {
    const [, pending] = cityRoutesAtAutostation(dataset);
    expect(pending).toMatchObject({ id: '10', published: false });
  });

  it('is safe with no dataset', () => {
    expect(cityRoutesAtAutostation(null)).toEqual([]);
  });

  it('mentions pending routes in the FAQ without promising a schedule', () => {
    const faq = buildAvtostantsiyaFaq([], [], cityRoutesAtAutostation(dataset));
    const a = faq.find((f) => f.q.includes('міська маршрутка'))?.a ?? '';
    expect(a).toContain('№8 — розклад на сторінці маршруту');
    expect(a).toContain('№10 — маршрут ще готуємо до запуску');
  });
});
