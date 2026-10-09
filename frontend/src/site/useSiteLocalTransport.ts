/**
 * Чи показувати локальний транспорт на цьому домені.
 *
 * Джерело правди — прапорець TripPoint.hasLocalTransport (галочка в адмінці, вкладка «Маршрути»).
 * Поки він true тільки в Малина; Коростень бачить заглушку «скоро».
 */
import { useEffect, useState } from 'react';
import { catalogCache } from '@/api/catalogCache';
import type { TripPoint } from '@/types';
import { getCurrentSite } from './siteConfig';

// Один кеш TripPoint на весь SPA (той самий, що в головній і формах) — src/api/catalogCache.ts
const fetchTripPoints = (): Promise<TripPoint[]> => catalogCache.tripPoints.get();

export function invalidateSiteLocalTransportCache(): void {
  catalogCache.tripPoints.invalidate();
}

function flagFor(points: TripPoint[], cityCode: string): boolean {
  const point = points.find((p) => p.code === cityCode);
  return Boolean(point?.hasLocalTransport);
}

export interface SiteLocalTransport {
  /** true — рендеримо звичайні сторінки транспорту, false — заглушку «скоро» */
  enabled: boolean;
  loading: boolean;
}

export function useSiteLocalTransport(): SiteLocalTransport {
  const site = getCurrentSite();
  // Фолбек, якщо API недоступний: головний сайт (Малин) не гасимо через мережеву помилку.
  const fallback = site.isPrimary;
  const [state, setState] = useState<SiteLocalTransport>(() => {
    const cached = catalogCache.tripPoints.peek();
    return cached
      ? { enabled: flagFor(cached, site.cityCode), loading: false }
      : { enabled: fallback, loading: true };
  });

  useEffect(() => {
    let cancelled = false;
    fetchTripPoints()
      .then((points) => {
        if (!cancelled) setState({ enabled: flagFor(points, site.cityCode), loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ enabled: fallback, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [site.cityCode, fallback]);

  return state;
}
