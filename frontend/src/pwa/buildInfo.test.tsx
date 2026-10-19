import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { DATASET_STORAGE_KEY } from '@/pages/LocalTransportPage/dataset/datasetStore';
import { BuildStamp } from './BuildStamp';
import { activeWorkerBuildId, bundleHashOf, storedDataAsOf, useBuildInfo, workerLabel } from './buildInfo';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'activated';
  constructor(public buildId: string) {
    super();
  }
  postMessage(message: unknown, transfer?: Transferable[]) {
    const port = transfer?.[0] as MessagePort | undefined;
    if ((message as { type?: string })?.type === 'GET_BUILD_ID' && port) port.postMessage({ buildId: this.buildId });
  }
}
const swWith = (active: FakeWorker | null) => ({
  getRegistration: vi.fn(async () => (active ? ({ active } as unknown as ServiceWorkerRegistration) : undefined)),
});
const storeDataset = (revision: string | null, fetchedAt = Date.UTC(2026, 9, 19, 10, 0, 0)) =>
  localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ dataset: { stops: [], routes: [], trips: [], revision }, revision, fetchedAt }));

afterEach(() => {
  localStorage.clear();
  document.head.innerHTML = '';
  delete (window as Window & { __MALIN_PRERENDER__?: boolean }).__MALIN_PRERENDER__;
});

describe('buildInfo (Docs/transport-verifiable-build-2026-10.md, фаза 2)', () => {
  it('хеш бандла — з назви головного скрипта; dev (/src/main.tsx) — null', () => {
    expect(bundleHashOf('/assets/index-BQ7sKb7V.js')).toBe('BQ7sKb7V');
    expect(bundleHashOf('/src/main.tsx')).toBeNull();
    expect(bundleHashOf(null)).toBeNull();
  });

  it('BUILD_ID активного воркера зі scope /transport; без реєстрації або без serviceWorker — null', async () => {
    const sw = swWith(new FakeWorker('c8be6a0c153c'));
    expect(await activeWorkerBuildId(sw)).toBe('c8be6a0c153c');
    expect(sw.getRegistration).toHaveBeenCalledWith('/transport');
    expect(await activeWorkerBuildId(swWith(null))).toBeNull();
    expect(await activeWorkerBuildId(null)).toBeNull();
    expect(await activeWorkerBuildId({ getRegistration: vi.fn(async () => Promise.reject(new Error('SecurityError'))) })).toBeNull();
  });

  it('мітка даних — ревізія локальної копії, інакше час її збереження; без копії — null', () => {
    expect(storedDataAsOf()).toBeNull();
    storeDataset('2026-10-19T09:12:00.000Z');
    expect(storedDataAsOf()).toBe('2026-10-19T09:12:00.000Z');
    storeDataset(null);
    expect(storedDataAsOf()).toBe('2026-10-19T10:00:00.000Z');
  });

  it('useBuildInfo збирає все разом; під пререндером — порожньо і воркера не питає', async () => {
    document.head.innerHTML = '<script type="module" src="/assets/index-Ab12Cd.js" integrity="sha384-x" crossorigin="anonymous"></script>';
    storeDataset('2026-10-19T09:12:00.000Z');
    const sw = swWith(new FakeWorker('deadbeef0001'));
    const { result } = renderHook(() => useBuildInfo({ sw }));
    expect(result.current.bundle).toBe('Ab12Cd');
    expect(result.current.dataAsOf).toBe('2026-10-19T09:12:00.000Z');
    await waitFor(() => expect(result.current.worker).toBe('deadbeef0001'));

    (window as Window & { __MALIN_PRERENDER__?: boolean }).__MALIN_PRERENDER__ = true;
    const prerender = swWith(new FakeWorker('x'));
    const { result: pre } = renderHook(() => useBuildInfo({ sw: prerender }));
    expect(pre.current).toEqual({ bundle: null, worker: null, dataAsOf: null });
    expect(prerender.getRegistration).not.toHaveBeenCalled();
  });

  it('BuildStamp: значення в <code>, відносні адреси для звірки; без воркера й копії — чесні підписи; під пререндером — нічого', async () => {
    document.head.innerHTML = '<script type="module" src="/assets/index-Ab12Cd.js"></script>';
    const { container, unmount } = render(<BuildStamp sw={swWith(null)} />);
    await waitFor(() => expect(screen.getByTestId('build-stamp').textContent).toContain(workerLabel(null)));
    const codes = Array.from(container.querySelectorAll('code')).map((c) => c.textContent);
    expect(codes).toContain('Ab12Cd');
    expect(codes).toContain('копії ще нема');
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/transport-sw.js', '/transport/revisions']);
    expect(container.innerHTML).not.toMatch(/https?:\/\//);
    unmount();

    storeDataset('2026-10-19T09:12:00.000Z');
    render(<BuildStamp sw={swWith(new FakeWorker('c8be6a0c153c'))} />);
    await waitFor(() => expect(screen.getByTestId('build-stamp').textContent).toContain('c8be6a0c153c'));
    expect(screen.getByTestId('build-stamp').textContent).toContain('2026-10-19T09:12:00.000Z');
  });

  it('BuildStamp під пререндером не рендериться', () => {
    (window as Window & { __MALIN_PRERENDER__?: boolean }).__MALIN_PRERENDER__ = true;
    const { container } = render(<BuildStamp sw={swWith(new FakeWorker('x'))} />);
    expect(container.innerHTML).toBe('');
  });
});
