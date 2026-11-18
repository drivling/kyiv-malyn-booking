import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TransportDataset } from '@/api/transportDataset';
import { configureRouteNames, routeNamesCity, routeNo, routeNoIn, setRouteNamesCity } from '@/utils/routeNames';
import { SEGMENT_DURATIONS_SEC } from '../segmentDurations';
import { usePlannerModel } from './usePlannerModel';

/**
 * Два міста з тим самим id маршруту «2» і тими самими id зупинок, але різними хвилинами між ними: у Малині A → B —
 * 4 хв, у «Коростені» — 10. Так перевіряємо, що другий (пасивний) планувальник не плутає сегменти з першим.
 */
function dataset(city: string, seconds: number): TransportDataset {
  return {
    stops: [
      { id: 'st_a', name: `${city} A`, lat: 50, lng: 29 },
      { id: 'st_b', name: `${city} B`, lat: 50.05, lng: 29 },
    ],
    routes: [{ id: '2', fromName: `${city} A`, toName: `${city} B`, shortName: city === 'Korosten' ? '2-К' : '' }],
    routeStops: [
      { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 2 },
      { routeId: '2', stopId: 'st_b', orderThere: 2, orderBack: 1 },
    ],
    trips: [{ id: `${city}-1`, routeId: '2', serviceId: 'everyday', headsign: `${city} B`, directionId: '1', departureTime: '08:00' }],
    segments: [
      { routeId: '2', fromStopId: 'st_a', toStopId: 'st_b', seconds },
      { routeId: '2', fromStopId: 'st_b', toStopId: 'st_a', seconds },
    ],
    meta: {},
    revision: `${city}-r1`,
  };
}

const DATASETS: Record<string, TransportDataset> = { Malyn: dataset('Malyn', 240), Korosten: dataset('Korosten', 600) };
// маршрут «4» не в малинському списку перевірених (routeTiming.VERIFIED_ROUTE_IDS): у Малині він ішов би плоскими
// 2 хв на крок, а в Коростені — за сегментами
const k4 = dataset('Korosten', 600);
DATASETS.Korosten4 = {
  ...k4,
  routes: k4.routes.map((r) => ({ ...r, id: '4' })),
  routeStops: k4.routeStops.map((x) => ({ ...x, routeId: '4' })),
  trips: k4.trips.map((t) => ({ ...t, routeId: '4' })),
  segments: k4.segments.map((x) => ({ ...x, routeId: '4' })),
};

vi.mock('../dataset/useTransportDataset', () => ({
  useTransportDataset: (city: string, opts: { passive?: boolean; enabled?: boolean } = {}) => {
    const enabled = opts.enabled ?? true;
    const d = enabled ? DATASETS[city] : null;
    // як справжній завантажувач: реєстр номерів міста заповнено; пасивний повертає місто сторінки
    const page = routeNamesCity();
    if (d) configureRouteNames(d.routes, city);
    setRouteNamesCity(opts.passive ? page : city);
    return { dataset: d, loading: false, error: '' };
  },
}));

const A = { kind: 'stop', stopId: 'st_a' } as const;
const B = { kind: 'stop', stopId: 'st_b' } as const;

describe('usePlannerModel: два міста на одній сторінці', () => {
  it('кожен планувальник їде зі своїми сегментами; глобальні лишаються за містом сторінки', () => {
    const { result } = renderHook(() => {
      const korosten = usePlannerModel('Korosten', { passive: true });
      const malyn = usePlannerModel('Malyn');
      return { malyn, korosten };
    });
    const malynDay = result.current.malyn.plannerFor('2026-11-18')!;
    const korostenDay = result.current.korosten.plannerFor('2026-11-18')!;
    // Коростень будується другим — і все одно не лишає своїх сегментів глобально
    const kJourney = korostenDay.plan(A, B).journeys[0];
    const mJourney = malynDay.plan(A, B).journeys[0];
    expect(mJourney.arriveMins - mJourney.departMins).toBe(4);
    expect(kJourney.arriveMins - kJourney.departMins).toBe(10);
    expect(SEGMENT_DURATIONS_SEC['2|st_a|st_b']).toBe(240);
    expect(korostenDay.stopName('st_a')).toBe('Korosten A');
    expect(malynDay.stopName('st_a')).toBe('Malyn A');
  });

  it('маршрут, неперевірений у Малині, у пасивному планувальнику іншого міста їде за сегментами, а не по 2 хв на крок', () => {
    const { result } = renderHook(() => {
      const malyn = usePlannerModel('Malyn');
      const far = usePlannerModel('Korosten4', { passive: true });
      return { malyn, far };
    });
    const j = result.current.far.plannerFor('2026-11-18')!.plan(A, B).journeys[0];
    expect(j.arriveMins - j.departMins).toBe(10);
  });

  it('пасивний не перемикає номери сторінки; routeNoIn читає місто явно', () => {
    renderHook(() => {
      usePlannerModel('Malyn');
      usePlannerModel('Korosten', { passive: true });
    });
    expect(routeNo('2')).toBe('2');
    expect(routeNoIn('Korosten', '2')).toBe('2-К');
  });

  it('city null — нічого не вантажить', () => {
    const { result } = renderHook(() => usePlannerModel(null, { passive: true }));
    expect(result.current.ready).toBe(false);
    expect(result.current.plannerFor('2026-11-18')).toBeNull();
    expect(result.current.stops).toEqual([]);
  });
});
