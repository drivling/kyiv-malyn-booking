import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { TransportDataset } from '@/api/transportDataset';

let cached: TransportDataset | null = null;
let inflight: Promise<TransportDataset> | null = null;

async function fetchDataset(): Promise<TransportDataset> {
  if (cached) return cached;
  if (!inflight) {
    inflight = apiClient.getTransportDataset().then((d) => {
      cached = d;
      inflight = null;
      return d;
    });
  }
  return inflight;
}

export function invalidateTransportDatasetCache() {
  cached = null;
}

export function useTransportDataset() {
  const [dataset, setDataset] = useState<TransportDataset | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      invalidateTransportDatasetCache();
      const d = await fetchDataset();
      setDataset(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося завантажити транспорт');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDataset()
      .then((d) => {
        if (!cancelled) setDataset(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не вдалося завантажити транспорт');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { dataset, loading, error, reload };
}
