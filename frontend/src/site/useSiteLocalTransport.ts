/**
 * Чи показувати локальний транспорт на цьому домені.
 *
 * Джерело правди — прапорець TripPoint.hasLocalTransport (галочка в адмінці, вкладка «Маршрути»).
 * Поки він true тільки в Малина; Коростень бачить заглушку «скоро».
 */
import { useEffect, useState } from 'react';
import { catalogCache } from '@/api/catalogCache';
import type { TripPoint } from '@/types';
import { isPrerendering } from '@/utils/prerender';
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

/**
 * Остання відповідь API для міста — щоб ворота не показували «Завантаження...» без мережі чи на
 * повільному з'єднанні (Docs/transport-pwa-2026-10.md, фаза 2). Під пререндером не пишемо й не читаємо.
 */
const STORAGE_PREFIX = 'site-local-transport:';

export function readRememberedLocalTransport(cityCode: string): boolean | null {
  if (isPrerendering()) return null;
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + cityCode);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function rememberLocalTransport(cityCode: string, enabled: boolean): void {
  if (isPrerendering()) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + cityCode, enabled ? '1' : '0');
  } catch {
    /* без localStorage — просто не пам'ятаємо */
  }
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
    if (cached) return { enabled: flagFor(cached, site.cityCode), loading: false };
    const remembered = readRememberedLocalTransport(site.cityCode);
    return remembered === null ? { enabled: fallback, loading: true } : { enabled: remembered, loading: false };
  });

  useEffect(() => {
    let cancelled = false;
    fetchTripPoints()
      .then((points) => {
        const enabled = flagFor(points, site.cityCode);
        rememberLocalTransport(site.cityCode, enabled);
        if (!cancelled) setState({ enabled, loading: false });
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
