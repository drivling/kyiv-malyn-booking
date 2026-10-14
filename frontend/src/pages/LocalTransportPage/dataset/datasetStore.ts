/**
 * Локальна копія датасету транспорту і знімок збірки (Docs/transport-pwa-2026-10.md, фаза 2).
 *
 * Копія — localStorage: ~265 КБ JSON, читається синхронно при першому рендері, тож табло відкривається
 * без «Завантаження...» і без мережі. Знімок — /transport/dataset.json, який prerender-transport-stops.mjs
 * пише з того ж API під час збірки: остання опора, коли копії ще нема, а бекенд не відповідає.
 * Під пререндером усе вимкнено: jsdom має свій localStorage, а fetch там іде на прод — смужка
 * «без мережі» не має запектися в статичний HTML.
 */
import type { TransportDataset } from '@/api/transportDataset';
import { isPrerendering } from '@/utils/prerender';

export const DATASET_STORAGE_KEY = 'transport-dataset:v1';
export const SNAPSHOT_URL = '/transport/dataset.json';
/** Більше не зберігаємо: localStorage ~5 МБ на origin, копія має лишити місце решті ключів */
export const MAX_STORED_CHARS = 1_500_000;

export interface StoredDataset {
  dataset: TransportDataset;
  revision: string | null;
  /** Коли копію отримано з мережі (ms since epoch) */
  fetchedAt: number;
}

function looksLikeDataset(v: unknown): v is TransportDataset {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<TransportDataset>;
  return Array.isArray(d.stops) && Array.isArray(d.routes) && Array.isArray(d.trips);
}

export function readStored(): StoredDataset | null {
  if (isPrerendering()) return null;
  try {
    const raw = localStorage.getItem(DATASET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDataset>;
    if (!looksLikeDataset(parsed.dataset) || typeof parsed.fetchedAt !== 'number') return null;
    return {
      dataset: parsed.dataset,
      revision: typeof parsed.revision === 'string' ? parsed.revision : null,
      fetchedAt: parsed.fetchedAt,
    };
  } catch {
    return null;
  }
}

/** true — збережено; false — завеликий, нема localStorage або квота вичерпана (сайт працює й без копії) */
export function writeStored(dataset: TransportDataset, fetchedAt: number = Date.now()): boolean {
  if (isPrerendering()) return false;
  try {
    const stored: StoredDataset = { dataset, revision: dataset.revision ?? null, fetchedAt };
    const raw = JSON.stringify(stored);
    if (raw.length > MAX_STORED_CHARS) return false;
    localStorage.setItem(DATASET_STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearStored(): void {
  try {
    localStorage.removeItem(DATASET_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Знімок збірки. У dev і за SPA-fallback serve-dist на цей шлях приходить HTML зі статусом 200 —
 * тому перевіряємо content-type і форму, а не лише res.ok.
 */
export async function fetchSnapshot(fetchImpl: typeof fetch = fetch): Promise<TransportDataset> {
  if (isPrerendering()) throw new Error('snapshot: prerender');
  const res = await fetchImpl(SNAPSHOT_URL, { cache: 'no-cache', credentials: 'omit' });
  if (!res.ok) throw new Error(`snapshot: ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/json/i.test(type)) throw new Error('snapshot: not json');
  const body: unknown = await res.json();
  if (!looksLikeDataset(body)) throw new Error('snapshot: bad shape');
  return body;
}
