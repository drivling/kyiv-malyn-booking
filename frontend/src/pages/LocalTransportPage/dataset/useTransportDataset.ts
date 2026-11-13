/**
 * Датасет міського транспорту для публічних сторінок — із трьох джерел, за порядком
 * (Docs/transport-pwa-2026-10.md, шар даних):
 *  1. локальна копія в localStorage — віддаємо миттєво, без «Завантаження...»;
 *  2. мережа (GET /transport/dataset) — успіх перезаписує копію; якщо revision та сама, об'єкт датасету
 *     лишається тим самим, щоб сторінки не перераховували розклад даремно;
 *  3. знімок збірки /transport/dataset.json — коли копії нема, а мережа не відповіла (бекенд упав).
 * Кеш один на модуль для всіх сторінок — окремий для кожного міста (місто за замовчуванням дає поточний сайт);
 * знімок збірки є лише для Малина. Адмінка після збереження зве broadcastTransportDatasetInvalidate().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import type { TransportDataset } from '@/api/transportDataset';
import { flushOutbox } from '@/pwa/outbox';
import { useOnline } from '@/pwa/useOnline';
import { configureRouteNames, setRouteNamesCity } from '@/utils/routeNames';
import { isDefaultTransportCity, siteTransportCity } from '@/site/transportCity';
import { configureRouteColors, setRouteColorsCity } from '../routeColors';
import { setVerifiedRoutesCity } from '../routeTiming';
import { fetchSnapshot, readStored, writeStored } from './datasetStore';

export type DatasetSource = 'network' | 'local' | 'snapshot';

export interface LoadedDataset {
  dataset: TransportDataset;
  source: DatasetSource;
  /** Коли дані отримано з мережі (для копії — коли її було збережено) */
  fetchedAt: number;
}

const cachedByCity = new Map<string, LoadedDataset>();
const inflightByCity = new Map<string, Promise<LoadedDataset>>();

/** Номери й кольори маршрутів для копії чи знімка: вони минають apiClient.getTransportDataset() */
function configureFor(dataset: TransportDataset, city: string): void {
  configureRouteNames(dataset.routes, city);
  configureRouteColors(dataset.meta, city);
}

/** Копія з localStorage — лише поки в пам'яті ще нічого нема */
function fromLocalCopy(city: string): LoadedDataset | null {
  const cached = cachedByCity.get(city);
  if (cached) return cached;
  const stored = readStored(city);
  if (!stored) return null;
  configureFor(stored.dataset, city);
  const loaded: LoadedDataset = { dataset: stored.dataset, source: 'local', fetchedAt: stored.fetchedAt };
  cachedByCity.set(city, loaded);
  return loaded;
}

function adoptNetwork(fresh: TransportDataset, city: string): LoadedDataset {
  const fetchedAt = Date.now();
  writeStored(fresh, fetchedAt, city);
  const prev = cachedByCity.get(city);
  const sameRevision = Boolean(prev?.dataset.revision) && prev?.dataset.revision === fresh.revision;
  const cached: LoadedDataset = { dataset: sameRevision && prev ? prev.dataset : fresh, source: 'network', fetchedAt };
  cachedByCity.set(city, cached);
  // API відповідає — час надіслати записи, що чекали на мережу (src/pwa/outbox.ts)
  void flushOutbox();
  return cached;
}

/** Один спільний запит на всіх споживачів; помилка не кешується — inflight скидається */
function fetchFromNetwork(city: string): Promise<LoadedDataset> {
  let inflight = inflightByCity.get(city);
  if (!inflight) {
    inflight = apiClient
      .getTransportDataset({ city })
      .then((d) => {
        inflightByCity.delete(city);
        return adoptNetwork(d, city);
      })
      .catch((e: unknown) => {
        inflightByCity.delete(city);
        throw e;
      });
    inflightByCity.set(city, inflight);
  }
  return inflight;
}

/** Знімок збірки /transport/dataset.json — датасет Малина; для іншого міста його нема */
async function fromSnapshot(city: string): Promise<LoadedDataset> {
  if (!isDefaultTransportCity(city)) throw new Error('snapshot: other city');
  const d = await fetchSnapshot();
  configureFor(d, city);
  const loaded: LoadedDataset = { dataset: d, source: 'snapshot', fetchedAt: Date.now() };
  cachedByCity.set(city, loaded);
  return loaded;
}

export function invalidateTransportDatasetCache() {
  cachedByCity.clear();
}

const STORAGE_INVALIDATE_KEY = 'transport-dataset-invalidate';

/** Call after admin saves / recalculates so other tabs refetch. */
export function broadcastTransportDatasetInvalidate() {
  invalidateTransportDatasetCache();
  try {
    localStorage.setItem(STORAGE_INVALIDATE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** city — чий транспорт; без аргументу — місто поточного сайту (сторінки Малина поза /transport називають його явно) */
export function useTransportDataset(city: string = siteTransportCity()) {
  // routeNo() у цій сторінці має читати номери саме цього міста
  setRouteNamesCity(city);
  setRouteColorsCity(city);
  setVerifiedRoutesCity(city);
  const [loaded, setLoaded] = useState<LoadedDataset | null>(() => fromLocalCopy(city));
  const [loading, setLoading] = useState(() => !cachedByCity.has(city));
  const [error, setError] = useState('');
  const online = useOnline();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Мережа; без неї — копія лишається на екрані, а без копії — знімок збірки */
  const reload = useCallback(async () => {
    if (mounted.current) {
      setError('');
      if (!cachedByCity.has(city)) setLoading(true);
    }
    try {
      const fresh = await fetchFromNetwork(city);
      if (mounted.current) setLoaded(fresh);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не вдалося завантажити транспорт';
      let fallback = cachedByCity.get(city) ?? null;
      if (!fallback) {
        try {
          fallback = await fromSnapshot(city);
        } catch {
          /* знімка теж нема — лишається помилка */
        }
      }
      if (mounted.current) {
        setLoaded(fallback);
        setError(message);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [city]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_INVALIDATE_KEY) void reload();
    };
    const onOnline = () => void reload();
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
    };
  }, [reload]);

  return {
    dataset: loaded?.dataset ?? null,
    loading,
    error,
    reload,
    /** Звідки дані на екрані; null — ще нічого */
    source: loaded?.source ?? null,
    online,
    /** ISO-мітка даних: revision датасету, інакше час отримання копії */
    dataAsOf: loaded ? (loaded.dataset.revision ?? new Date(loaded.fetchedAt).toISOString()) : null,
  };
}
