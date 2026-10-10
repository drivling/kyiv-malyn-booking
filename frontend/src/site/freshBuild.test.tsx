/**
 * Автооновлення застарілої вкладки: порівняння скрипта збірки, коли вкладка знову видима;
 * одразу — лише після довгої відсутності й коли людина нічого не заповнює, інакше — на переході.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import {
  CHECK_EVERY_MS,
  STALE_HIDDEN_MS,
  bundleInHtml,
  loadedBundle,
  safeToReload,
  useFreshBuild,
} from './freshBuild';

const OLD = '/assets/index-OLD111.js';
const NEW = '/assets/index-NEW222.js';
const html = (bundle: string) => `<!doctype html><html><head><script type="module" crossorigin src="${bundle}"></script></head></html>`;

let visibility: DocumentVisibilityState = 'visible';
let clock = 1_000_000;
let nav: NavigateFunction;

function Probe({ fetchImpl, reload }: { fetchImpl: typeof fetch; reload: () => void }) {
  useFreshBuild({ fetchImpl, reload, now: () => clock });
  nav = useNavigate();
  return null;
}

function mount(path: string, served = NEW) {
  const fetchImpl = vi.fn(async () => new Response(html(served), { status: 200 })) as unknown as typeof fetch;
  const reload = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Probe fetchImpl={fetchImpl} reload={reload} />
    </MemoryRouter>
  );
  return { fetchImpl, reload, view };
}

async function away(ms: number) {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  clock += ms;
  visibility = 'visible';
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  visibility = 'visible';
  clock = 1_000_000;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const s = document.createElement('script');
  s.type = 'module';
  s.src = OLD;
  s.setAttribute('data-test', 'bundle');
  document.head.appendChild(s);
  sessionStorage.clear();
});

afterEach(() => {
  document.querySelectorAll('[data-test="bundle"], [data-test="dialog"]').forEach((el) => el.remove());
});

describe('freshBuild helpers', () => {
  it('finds the bundle in the page and in served HTML; nothing in dev', () => {
    expect(loadedBundle()).toBe(OLD);
    expect(bundleInHtml(html(NEW))).toBe(NEW);
    expect(bundleInHtml('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
  });

  it('safeToReload: not on admin pages, not with an open modal (the cookie banner is fine) or a focused field', () => {
    expect(safeToReload(document, '/transport')).toBe(true);
    expect(safeToReload(document, '/admin/stickers')).toBe(false);
    const banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('data-test', 'dialog');
    document.body.appendChild(banner);
    expect(safeToReload(document, '/transport')).toBe(true);
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('data-test', 'dialog');
    document.body.appendChild(d);
    expect(safeToReload(document, '/transport')).toBe(false);
    d.remove();
    banner.remove();
    const input = document.createElement('input');
    input.setAttribute('data-test', 'dialog');
    document.body.appendChild(input);
    input.focus();
    expect(safeToReload(document, '/transport')).toBe(false);
  });
});

describe('useFreshBuild', () => {
  it('a tab left for a long time reloads on return when a new build is out', async () => {
    const { fetchImpl, reload } = mount('/transport/stop/st_a');
    await away(STALE_HIDDEN_MS + 1);
    expect(fetchImpl).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the same build — nothing happens', async () => {
    const { fetchImpl, reload } = mount('/transport', OLD);
    await away(STALE_HIDDEN_MS + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a short break: no reload now, the next page change loads the new build', async () => {
    const { reload } = mount('/transport');
    await away(CHECK_EVERY_MS + 1);
    expect(reload).not.toHaveBeenCalled();
    act(() => nav('/transport?d=10.10.26'));
    expect(reload).not.toHaveBeenCalled();
    act(() => nav('/transport/stop/st_a'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks at most every 10 minutes', async () => {
    const { fetchImpl } = mount('/transport', OLD);
    await away(60_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    await away(CHECK_EVERY_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('admin pages are never reloaded by it', async () => {
    const { reload } = mount('/admin/map-editor');
    await away(STALE_HIDDEN_MS + 1);
    act(() => nav('/admin/stickers'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('an open dialog defers the reload to the next page change; one try per build', async () => {
    const d = document.createElement('div');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('data-test', 'dialog');
    document.body.appendChild(d);
    const { reload } = mount('/transport/route/5');
    await away(STALE_HIDDEN_MS + 1);
    expect(reload).not.toHaveBeenCalled();
    d.remove();
    act(() => nav('/transport/stop/st_a'));
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => nav('/transport'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
