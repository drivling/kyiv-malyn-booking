/**
 * Чи показувати локальний транспорт на цьому домені.
 *
 * Джерело правди — прапорець TripPoint.hasLocalTransport (галочка в адмінці, вкладка «Маршрути»).
 * Поки він true тільки в Малина; Коростень бачить заглушку «скоро».
 */
import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { TripPoint } from '@/types';
import { getCurrentSite } from './siteConfig';

let cached: TripPoint[] | null = null;
let inflight: Promise<TripPoint[]> | null = null;

async function fetchTripPoints(): Promise<TripPoint[]> {
  if (cached) return cached;
  if (!inflight) {
    inflight = apiClient
      .getTripPoints()
      .then((points) => {
        cached = points;
        inflight = null;
        return points;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

export function invalidateSiteLocalTransportCache(): void {
  cached = null;
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
  const [state, setState] = useState<SiteLocalTransport>(() =>
    cached
      ? { enabled: flagFor(cached, site.cityCode), loading: false }
      : { enabled: fallback, loading: true },
  );

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
