/**
 * Датасет міського транспорту для публічних сторінок — із трьох джерел, за порядком
 * (Docs/transport-pwa-2026-10.md, шар даних):
 *  1. локальна копія в localStorage — віддаємо миттєво, без «Завантаження...»;
 *  2. мережа (GET /transport/dataset) — успіх перезаписує копію; якщо revision та сама, об'єкт датасету
 *     лишається тим самим, щоб сторінки не перераховували розклад даремно;
 *  3. знімок збірки /transport/dataset.json — коли копії нема, а мережа не відповіла (бекенд упав).
 * Кеш один на модуль для всіх сторінок; адмінка після збереження зве broadcastTransportDatasetInvalidate().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import type { TransportDataset } from '@/api/transportDataset';
import { useOnline } from '@/pwa/useOnline';
import { configureRouteNames } from '@/utils/routeNames';
import { fetchSnapshot, readStored, writeStored } from './datasetStore';

export type DatasetSource = 'network' | 'local' | 'snapshot';

export interface LoadedDataset {
  dataset: TransportDataset;
  source: DatasetSource;
  /** Коли дані отримано з мережі (для копії — коли її було збережено) */
  fetchedAt: number;
}

let cached: LoadedDataset | null = null;
let inflight: Promise<LoadedDataset> | null = null;

/** Копія з localStorage — лише поки в пам'яті ще нічого нема */
function fromLocalCopy(): LoadedDataset | null {
  if (cached) return cached;
  const stored = readStored();
  if (!stored) return null;
  // Копія і знімок минають apiClient.getTransportDataset(), який заповнює номери «11/1»
  configureRouteNames(stored.dataset.routes);
  cached = { dataset: stored.dataset, source: 'local', fetchedAt: stored.fetchedAt };
  return cached;
}

function adoptNetwork(fresh: TransportDataset): LoadedDataset {
  const fetchedAt = Date.now();
  writeStored(fresh, fetchedAt);
  const prev = cached;
  const sameRevision = Boolean(prev?.dataset.revision) && prev?.dataset.revision === fresh.revision;
  cached = { dataset: sameRevision && prev ? prev.dataset : fresh, source: 'network', fetchedAt };
  return cached;
}

/** Один спільний запит на всіх споживачів; помилка не кешується — inflight скидається */
function fetchFromNetwork(): Promise<LoadedDataset> {
  if (!inflight) {
    inflight = apiClient
      .getTransportDataset()
      .then((d) => {
        inflight = null;
        return adoptNetwork(d);
      })
      .catch((e: unknown) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

async function fromSnapshot(): Promise<LoadedDataset> {
  const d = await fetchSnapshot();
  configureRouteNames(d.routes);
  cached = { dataset: d, source: 'snapshot', fetchedAt: Date.now() };
  return cached;
}

export function invalidateTransportDatasetCache() {
  cached = null;
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

export function useTransportDataset() {
  const [loaded, setLoaded] = useState<LoadedDataset | null>(() => fromLocalCopy());
  const [loading, setLoading] = useState(() => cached === null);
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
      if (!cached) setLoading(true);
    }
    try {
      const fresh = await fetchFromNetwork();
      if (mounted.current) setLoaded(fresh);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не вдалося завантажити транспорт';
      let fallback = cached;
      if (!fallback) {
        try {
          fallback = await fromSnapshot();
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
  }, []);

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
