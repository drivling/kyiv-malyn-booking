/**
 * Кеш майже статичних каталогів (точки, маршрути, OD-пари) на рівні модуля.
 *
 * Вони змінюються лише з адмінки, а головна перечитувала їх на кожен пошук
 * (Docs/poputky-search-performance-plan.md, Фаза 1.3). Один inflight-запит на всіх
 * споживачів, TTL 5 хв; адмінка після збереження викликає invalidateCatalogCache().
 */
import { apiClient } from './client';
import type { TripPoint, TripRoute } from '@/types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface CachedLoader<T> {
  /** Значення з кешу або один спільний запит; помилка не кешується. */
  get(): Promise<T>;
  /** Синхронно: що зараз у кеші (для initial state без запиту). */
  peek(): T | null;
  invalidate(): void;
}

export function createCachedLoader<T>(load: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): CachedLoader<T> {
  let value: T | null = null;
  let loadedAt = 0;
  let inflight: Promise<T> | null = null;
  return {
    get() {
      if (value !== null && Date.now() - loadedAt < ttlMs) return Promise.resolve(value);
      if (!inflight) {
        inflight = load()
          .then((v) => {
            value = v;
            loadedAt = Date.now();
            inflight = null;
            return v;
          })
          .catch((e: unknown) => {
            inflight = null;
            throw e;
          });
      }
      return inflight;
    },
    peek() {
      return value !== null && Date.now() - loadedAt < ttlMs ? value : null;
    },
    invalidate() {
      value = null;
      loadedAt = 0;
    },
  };
}

export type OdPair = Awaited<ReturnType<typeof apiClient.getOdPairs>>[number];

export const catalogCache = {
  tripPoints: createCachedLoader<TripPoint[]>(() => apiClient.getTripPoints()),
  poputkyPoints: createCachedLoader<TripPoint[]>(() => apiClient.getTripPoints({ appearInPoputky: true })),
  tripRoutes: createCachedLoader<TripRoute[]>(() => apiClient.getTripRoutes()),
  odPairs: createCachedLoader<OdPair[]>(() => apiClient.getOdPairs()),
};

/** Після зміни точок/маршрутів в адмінці — наступний get() піде в API. */
export function invalidateCatalogCache(): void {
  for (const loader of Object.values(catalogCache)) loader.invalidate();
}
