import { useCallback, useEffect, useRef, useState } from 'react';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { haversineDistance } from './nearbyAlternatives';

export interface NearestStop {
  /** Ключ зупинки (id) — як у `coords.stops` */
  name: string;
  /** Відстань до користувача, метри */
  distance: number;
}

export interface UseNearestStopsOptions {
  /** Куди піде подія `transport_geo` — планувальник чи табло */
  page: 'planner' | 'board';
  /** Скільки зупинок повертати (за замовчуванням 5) */
  limit?: number;
}

/** «120 м» / «1.4 км» */
export function formatDistance(distance: number): string {
  return distance < 1000 ? `${Math.round(distance)} м` : `${(distance / 1000).toFixed(1)} км`;
}

/**
 * «Поруч зі мною»: браузерна геолокація → найближчі зупинки з `stopsCoords`.
 * Спільний для планувальника і табло; стан помилки — рядок для live-region.
 */
export function useNearestStops(
  stopsCoords: Record<string, [number, number]> | null,
  { page, limit = 5 }: UseNearestStopsOptions
) {
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [nearestStops, setNearestStops] = useState<NearestStop[] | null>(null);
  // Відповідь геолокації може прийти після unmount — не чіпаємо стан розмонтованого компонента
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const findNearest = useCallback(() => {
    setGeoError('');
    setNearestStops(null);
    setGeoLoading(true);
    if (!navigator.geolocation) {
      setGeoError('Геолокація не підтримується браузером');
      setGeoLoading(false);
      gaTrackEvent('transport_geo', { result: 'unsupported', page });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mountedRef.current) return;
        const { latitude, longitude } = pos.coords;
        if (!stopsCoords || Object.keys(stopsCoords).length === 0) {
          setGeoError('Не вдалося завантажити координати зупинок');
          setGeoLoading(false);
          return;
        }
        const withDistance = Object.entries(stopsCoords)
          .map(([name, coords]) => ({
            name,
            distance: haversineDistance(latitude, longitude, coords[0], coords[1]),
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, limit);
        setNearestStops(withDistance);
        setGeoLoading(false);
        gaTrackEvent('transport_geo', { result: 'ok', page });
      },
      (err) => {
        if (!mountedRef.current) return;
        setGeoError(
          err.code === 1
            ? 'Дозвіл на геолокацію відхилено'
            : err.code === 2
              ? 'Позицію не визначено'
              : 'Помилка геолокації'
        );
        setGeoLoading(false);
        gaTrackEvent('transport_geo', { result: err.code === 1 ? 'denied' : 'error', page });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [stopsCoords, page, limit]);

  const clear = useCallback(() => setNearestStops(null), []);

  return { geoLoading, geoError, nearestStops, findNearest, clear };
}
