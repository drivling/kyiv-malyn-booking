/**
 * Entry for scripts/prerender-spa.mjs: renders the real <App /> for one URL inside jsdom,
 * waits until data fetching settles, and returns what a crawler should see.
 *
 * This is the same app the browser runs — no duplicated page templates. Head tags come from
 * usePageSeo (title, canonical, description, og:*, JSON-LD) exactly as in production.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import './index.css';

export type PrerenderResult = {
  title: string;
  canonical: string | null;
  description: string | null;
  og: Record<string, string>;
  jsonLd: string[];
  rootHtml: string;
  pendingFetches: number;
};

type Tracker = { pending: () => number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves once no fetch is in flight and the DOM stayed unchanged for `quietMs`. */
async function settle(tracker: Tracker, root: HTMLElement, { quietMs, timeoutMs }: { quietMs: number; timeoutMs: number }) {
  const started = Date.now();
  let lastHtml = '';
  let quietSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(50);
    const html = root.innerHTML;
    if (html !== lastHtml || tracker.pending() > 0) {
      lastHtml = html;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= quietMs) return;
  }
}

function readHead(): Omit<PrerenderResult, 'rootHtml' | 'pendingFetches'> {
  const og: Record<string, string> = {};
  document.querySelectorAll('meta[property^="og:"]').forEach((m) => {
    const p = m.getAttribute('property');
    const c = m.getAttribute('content');
    if (p && c) og[p] = c;
  });
  return {
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    og,
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent || ''),
  };
}

export async function renderRoute(
  path: string,
  tracker: Tracker,
  opts: { quietMs?: number; timeoutMs?: number } = {}
): Promise<PrerenderResult> {
  const quietMs = opts.quietMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 20000;

  window.history.replaceState({}, '', path);
  const container = document.getElementById('root');
  if (!container) throw new Error('prerender-entry: #root missing in jsdom document');

  const root: Root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  await settle(tracker, container, { quietMs, timeoutMs });

  const head = readHead();
  const result: PrerenderResult = { ...head, rootHtml: container.innerHTML, pendingFetches: tracker.pending() };

  root.unmount();
  await sleep(0);
  return result;
}
