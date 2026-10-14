import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportDataset } from '@/api/transportDataset';
import { DATASET_STORAGE_KEY, MAX_STORED_CHARS, SNAPSHOT_URL, fetchSnapshot, readStored, writeStored } from './datasetStore';

const sample = (revision: string | null = 'r1'): TransportDataset =>
  ({ stops: [{ id: 'st_1', name: 'A', lat: 1, lng: 2 }], routes: [], routeStops: [], trips: [], segments: [], meta: { defaultSec: 120 }, revision }) as unknown as TransportDataset;

const prerenderWindow = window as Window & { __MALIN_PRERENDER__?: boolean };

describe('datasetStore: локальна копія', () => {
  afterEach(() => {
    delete prerenderWindow.__MALIN_PRERENDER__;
  });

  it('зберігає і читає копію з ревізією та часом', () => {
    expect(writeStored(sample('r7'), 1_700_000_000_000)).toBe(true);
    expect(readStored()).toEqual({ dataset: sample('r7'), revision: 'r7', fetchedAt: 1_700_000_000_000 });
  });

  it('без ревізії (старий бекенд) revision = null', () => {
    writeStored(sample(null), 5);
    expect(readStored()?.revision).toBeNull();
  });

  it('завеликий датасет не зберігає, щоб не з\'їсти localStorage', () => {
    const huge = sample('big');
    huge.meta = { blob: 'x'.repeat(MAX_STORED_CHARS) } as unknown as TransportDataset['meta'];
    expect(writeStored(huge)).toBe(false);
    expect(localStorage.getItem(DATASET_STORAGE_KEY)).toBeNull();
  });

  it('зіпсований або чужий запис читається як null', () => {
    localStorage.setItem(DATASET_STORAGE_KEY, '{not json');
    expect(readStored()).toBeNull();
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ dataset: { stops: 'nope' }, fetchedAt: 1 }));
    expect(readStored()).toBeNull();
  });

  it('під пререндером нічого не пише й не читає', () => {
    prerenderWindow.__MALIN_PRERENDER__ = true;
    expect(writeStored(sample())).toBe(false);
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ dataset: sample(), revision: 'r1', fetchedAt: 1 }));
    expect(readStored()).toBeNull();
  });
});

describe('datasetStore: знімок збірки', () => {
  const respond = (body: string, init: ResponseInit) => vi.fn(async () => new Response(body, init)) as unknown as typeof fetch;

  it('бере JSON за фіксованою адресою без HTTP-кешу', async () => {
    const fetchImpl = respond(JSON.stringify(sample('snap')), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    await expect(fetchSnapshot(fetchImpl)).resolves.toEqual(sample('snap'));
    expect(fetchImpl).toHaveBeenCalledWith(SNAPSHOT_URL, { cache: 'no-cache', credentials: 'omit' });
  });

  it('відкидає HTML зі статусом 200 (dev-сервер і SPA-fallback) і 404', async () => {
    await expect(fetchSnapshot(respond('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))).rejects.toThrow(/not json/);
    await expect(fetchSnapshot(respond('Not found', { status: 404 }))).rejects.toThrow(/404/);
    await expect(fetchSnapshot(respond('{"stops":"x"}', { status: 200, headers: { 'content-type': 'application/json' } }))).rejects.toThrow(/bad shape/);
  });
});
