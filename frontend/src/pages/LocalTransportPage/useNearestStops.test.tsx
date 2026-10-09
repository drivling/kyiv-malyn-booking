/**
 * «Поруч зі мною»: геолокація → найближчі зупинки, помилки в рядку для live-region,
 * подія `transport_geo` з параметром `page`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { formatDistance, useNearestStops } from './useNearestStops';

vi.mock('@/analytics/googleAnalytics', () => ({ gaTrackEvent: vi.fn() }));

const coords: Record<string, [number, number]> = {
  st_c: [50.79, 29.26],
  st_a: [50.77, 29.24],
  st_b: [50.78, 29.25],
};

function stubGeolocation(impl: (ok: PositionCallback, err?: PositionErrorCallback) => void) {
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition: vi.fn(impl) },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.mocked(gaTrackEvent).mockClear();
});

describe('useNearestStops', () => {
  it('returns the closest stops first, limited, and reports transport_geo ok with the page', () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 50.7701, longitude: 29.2401 } } as unknown as GeolocationPosition));
    const { result } = renderHook(() => useNearestStops(coords, { page: 'board', limit: 2 }));
    expect(result.current.nearestStops).toBeNull();

    act(() => result.current.findNearest());

    expect(result.current.geoLoading).toBe(false);
    expect(result.current.geoError).toBe('');
    expect(result.current.nearestStops?.map((s) => s.name)).toEqual(['st_a', 'st_b']);
    const [first, second] = result.current.nearestStops!;
    expect(first.distance).toBeLessThan(second.distance);
    expect(first.distance).toBeLessThan(50);
    expect(gaTrackEvent).toHaveBeenCalledWith('transport_geo', { result: 'ok', page: 'board' });

    act(() => result.current.clear());
    expect(result.current.nearestStops).toBeNull();
  });

  it('a denied permission becomes a readable error and transport_geo denied', () => {
    stubGeolocation((_ok, err) => err?.({ code: 1, message: 'denied' } as GeolocationPositionError));
    const { result } = renderHook(() => useNearestStops(coords, { page: 'planner' }));
    act(() => result.current.findNearest());
    expect(result.current.geoError).toBe('Дозвіл на геолокацію відхилено');
    expect(result.current.nearestStops).toBeNull();
    expect(result.current.geoLoading).toBe(false);
    expect(gaTrackEvent).toHaveBeenCalledWith('transport_geo', { result: 'denied', page: 'planner' });
  });

  it('without navigator.geolocation reports unsupported', () => {
    Reflect.deleteProperty(navigator, 'geolocation');
    const { result } = renderHook(() => useNearestStops(coords, { page: 'board' }));
    act(() => result.current.findNearest());
    expect(result.current.geoError).toBe('Геолокація не підтримується браузером');
    expect(gaTrackEvent).toHaveBeenCalledWith('transport_geo', { result: 'unsupported', page: 'board' });
  });

  it('without stop coordinates the position cannot be matched', () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 50.77, longitude: 29.24 } } as unknown as GeolocationPosition));
    const { result } = renderHook(() => useNearestStops(null, { page: 'board' }));
    act(() => result.current.findNearest());
    expect(result.current.geoError).toBe('Не вдалося завантажити координати зупинок');
    expect(gaTrackEvent).not.toHaveBeenCalled();
  });

  it('formatDistance: metres below 1 km, one decimal above', () => {
    expect(formatDistance(120.4)).toBe('120 м');
    expect(formatDistance(999.6)).toBe('1000 м');
    expect(formatDistance(1440)).toBe('1.4 км');
  });
});
