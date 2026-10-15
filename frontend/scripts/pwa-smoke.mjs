/**
 * Manual smoke of the REAL transport service worker on a deployed site (Docs/transport-pwa-smoke.md).
 * Not in CI and not in pre-commit: Playwright e2e there runs on `vite dev`, where the worker is never registered
 * (`shouldRegisterServiceWorker` wants a production build), so this is the only scripted check of the worker itself.
 * Grew out of the phase-6 production check of Docs/transport-pwa-2026-10.md.
 *
 *   npm run pwa:smoke                              # https://malin.kiev.ua
 *   npm run pwa:smoke -- http://localhost:4173     # serve-dist over a fresh dist/ (localhost is a secure context too)
 *   PWA_SMOKE_SHOTS=shots npm run pwa:smoke        # also write a screenshot per checked page into that directory
 *
 * Headless Chromium, 430×900, uk-UA, Europe/Kyiv. The pages come from the data snapshot <base>/transport/dataset.json:
 * the first route that is not `unreliable` (numeric id order) and its first stop.
 *   1. online first visit — worker activated with scope /transport and a BUILD_ID; exactly one
 *      `malin-transport-shell-<id>` cache holding the shell, every /assets/* the shell references, the manifest, the
 *      icons and the snapshot; the localStorage copy `transport-dataset:v1`; after a reload the page is controlled;
 *   2. offline (context.setOffline + every request aborted, worker fetches included) — /transport, the stop board, the
 *      route and the scheme come from the worker with no subresource from the network, render their data and show the
 *      warning bar; /mizhgorodski is outside the scope and fails like in a plain browser;
 *   3. online, backend "down" (only GET …/transport/dataset aborted) — the board shows the local copy with
 *      «Сервер не відповідає…» and «Оновити»; without the copy it falls back to the build snapshot;
 *   4. back online — the bar goes away and the copy is written again; with `navigator.onLine` stubbed to false the
 *      bar reads «Без мережі…».
 * Ends with a PASS/WARN/FAIL table; exit code 1 when anything FAILed (a WARN never fails the run).
 *
 * Caveat: Playwright's offline emulation leaves `navigator.onLine === true`, so fully offline the site shows the
 * «Сервер не відповідає…» branch; real network-loss detection («Без мережі…» without the stub) is a phone-only check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { shellAssetRefs } from './precache.mjs';

const DEFAULT_BASE = 'https://malin.kiev.ua';
const DATASET_KEY = 'transport-dataset:v1';
const SHELL_PREFIX = 'malin-transport-shell-';
const FONTS_CACHE = 'malin-transport-fonts-v1';
const WARN_BAR_RE = /Без мережі|Сервер не відповідає/;
const DATASET_API_RE = /\/transport\/dataset(\?|$)/;
const SHOTS_DIR = process.env.PWA_SMOKE_SHOTS || '';

function usage(code) {
  console.log('usage: node scripts/pwa-smoke.mjs [https://host]   (default https://malin.kiev.ua; PWA_SMOKE_SHOTS=<dir> for screenshots)');
  process.exit(code);
}

function parseBase(arg) {
  if (!arg) return DEFAULT_BASE;
  if (arg === '-h' || arg === '--help') usage(0);
  let url;
  try {
    url = new URL(arg);
  } catch {
    console.error(`pwa-smoke: not a URL: ${arg}`);
    return usage(2);
  }
  if (!/^https?:$/.test(url.protocol)) {
    console.error(`pwa-smoke: ${arg} — http(s) only`);
    return usage(2);
  }
  return url.origin;
}

// ---- results

const results = [];
let currentStep = '';

function record(status, name, detail = '') {
  results.push({ status, step: currentStep, name, detail: String(detail ?? '') });
  console.log(`  ${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, ok, detail) => record(ok ? 'PASS' : 'FAIL', name, detail);
const advise = (name, ok, detail) => record(ok ? 'PASS' : 'WARN', name, detail);
const note = (text) => console.log(`       ${text}`);
function step(label, title) {
  currentStep = label;
  console.log(`\n== ${label}: ${title}`);
}

function printTable() {
  const rows = results.map((r) => ({ ...r, detail: r.detail.replace(/\s+/g, ' ').slice(0, 100) }));
  const head = { status: 'result', step: 'step', name: 'check', detail: 'detail' };
  const width = (key) => Math.max(...[head, ...rows].map((r) => r[key].length));
  const line = (r) => `${r.status.padEnd(width('status'))}  ${r.step.padEnd(width('step'))}  ${r.name.padEnd(width('name'))}  ${r.detail}`;
  console.log(`\n${line(head)}`);
  console.log('-'.repeat(width('status') + width('step') + width('name') + width('detail') + 6));
  for (const r of rows) console.log(line(r));
}

// ---- what to check

async function loadSnapshot(base) {
  const url = `${base}/transport/dataset.json`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !/json/i.test(type)) {
    throw new Error(`${url} → HTTP ${res.status} ${type || '(no content-type)'}; expected the JSON snapshot written by prerender-transport-stops.mjs`);
  }
  return res.json();
}

/** First route that is not hidden as unreliable (numeric id order, «10-old» after «10») and its first stop */
function pickPages(dataset) {
  const num = (id) => {
    const n = parseInt(id, 10);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  const route = [...dataset.routes].sort((a, b) => num(a.id) - num(b.id) || a.id.localeCompare(b.id)).find((r) => !r.unreliable);
  if (!route) throw new Error('the snapshot has no reliable route');
  const chain = dataset.routeStops
    .filter((rs) => rs.routeId === route.id && !rs.mapOnly && typeof rs.orderThere === 'number')
    .sort((a, b) => a.orderThere - b.orderThere);
  const stopId = chain[0]?.stopId ?? dataset.stops[0]?.id;
  if (!stopId) throw new Error(`route ${route.id} has no stops`);
  return { routeId: route.id, stopId };
}

// ---- in-page probes

/** Worker state after `serviceWorker.ready`, BUILD_ID over MessageChannel, every cache's entries, the cached shell */
function probeWorker(page, waitMs) {
  return page.evaluate(
    async ({ waitMs, prefix }) => {
      if (!('serviceWorker' in navigator)) return { error: 'navigator.serviceWorker is missing' };
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), waitMs))]);
      if (!reg) return { error: `serviceWorker.ready did not resolve in ${waitMs} ms — primary domain? production build?` };
      const worker = reg.active;
      if (worker.state !== 'activated') {
        await new Promise((r) => {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') r();
          });
          setTimeout(r, waitMs);
        });
      }
      const buildId = await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => resolve(e.data?.buildId ?? null);
        worker.postMessage({ type: 'GET_BUILD_ID' }, [channel.port2]);
        setTimeout(() => resolve(null), 3000);
      });
      const cacheEntries = {};
      for (const key of await caches.keys()) {
        cacheEntries[key] = (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname);
      }
      const shellKey = `${prefix}${buildId}` in cacheEntries ? `${prefix}${buildId}` : Object.keys(cacheEntries).find((k) => k.startsWith(prefix));
      const shellResponse = shellKey ? await (await caches.open(shellKey)).match('/index.html') : null;
      return {
        scriptURL: worker.scriptURL,
        scope: reg.scope,
        state: worker.state,
        buildId,
        cacheEntries,
        shellHtml: shellResponse ? await shellResponse.text() : '',
        controlled: Boolean(navigator.serviceWorker.controller),
      };
    },
    { waitMs, prefix: SHELL_PREFIX }
  );
}

/** What the page shows — heading, data, status bar — and whether any subresource came from the network */
function probePage(page, pathname) {
  return page.evaluate((p) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fromNetwork = performance
      .getEntriesByType('resource')
      .filter((r) => r.transferSize > 0)
      .map((r) => {
        const u = new URL(r.name);
        return u.host + u.pathname.slice(0, 40);
      });
    const main = document.querySelector('main') || document.body;
    const bar = document.querySelector('.lt-status-bar');
    return {
      path: p,
      title: document.title.slice(0, 70),
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 70) || null,
      rootEmpty: !document.getElementById('root')?.children.length,
      error: document.querySelector('.lt-error')?.textContent?.trim().slice(0, 120) || null,
      barWarn: Boolean(bar && bar.classList.contains('lt-status-bar--warn')),
      barText: bar?.querySelector('.lt-status-bar-text')?.textContent?.trim().slice(0, 140) || null,
      retryButton: Array.from(document.querySelectorAll('.lt-status-bar button')).some((b) => /Оновити/.test(b.textContent || '')),
      navTransfer: nav ? nav.transferSize : null,
      fromNetwork,
      times: (main.innerText.match(/\b\d{1,2}:\d{2}\b/g) || []).length,
      svgPaths: main.querySelectorAll('svg path, svg polyline, svg line').length,
      onLine: navigator.onLine,
    };
  }, pathname);
}

function waitForWarnBar(page, timeout = 25_000) {
  return page
    .waitForFunction((source) => new RegExp(source).test(document.querySelector('.lt-status-bar--warn .lt-status-bar-text')?.textContent || ''), WARN_BAR_RE.source, { timeout })
    .then(() => true)
    .catch(() => false);
}

function waitForStorageKey(page, key, timeout) {
  return page
    .waitForFunction((k) => Boolean(localStorage.getItem(k)), key, { timeout })
    .then(() => true)
    .catch(() => false);
}

// ---- the run

async function run(base) {
  const dataset = await loadSnapshot(base);
  const { routeId, stopId } = pickPages(dataset);
  const stopPath = `/transport/stop/${stopId}`;
  console.log(`pwa-smoke: ${base} — snapshot revision ${dataset.revision ?? '(none)'}, ${dataset.routes.length} routes; route ${routeId}, stop ${stopId}`);
  if (SHOTS_DIR) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'uk-UA', timezoneId: 'Europe/Kyiv' });
  const page = await context.newPage();
  const pageErrors = [];
  let consoleErrors = 0;
  page.on('pageerror', (e) => pageErrors.push(`${currentStep}: ${String(e).slice(0, 160)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors += 1;
  });
  const shot = async (name) => {
    if (SHOTS_DIR) await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
  };

  try {
    step('1 online', 'first visit');
    await page.goto(`${base}/transport`, { waitUntil: 'load' });
    const sw = await probeWorker(page, 30_000);
    check('worker registered and activated', !sw.error && sw.state === 'activated', sw.error || sw.scriptURL);
    if (sw.error) throw new Error('no service worker — nothing else to check');
    check('worker script and scope', sw.scriptURL === `${base}/transport-sw.js` && sw.scope === `${base}/transport`, `${sw.scriptURL}, scope ${sw.scope}`);
    check('BUILD_ID answers over MessageChannel', /^[0-9a-f]{12}$/.test(sw.buildId || ''), sw.buildId || 'no answer');
    const shellKeys = Object.keys(sw.cacheEntries).filter((k) => k.startsWith(SHELL_PREFIX));
    check('exactly one shell cache, named after the build', shellKeys.length === 1 && shellKeys[0] === `${SHELL_PREFIX}${sw.buildId}`, shellKeys.join(', ') || 'none');
    const shell = sw.cacheEntries[shellKeys[0]] || [];
    const assets = shell.filter((p) => p.startsWith('/assets/'));
    const icons = shell.filter((p) => p.startsWith('/icons/'));
    const missing = ['/index.html', '/transport.webmanifest', '/transport/dataset.json'].filter((p) => !shell.includes(p));
    check(
      'shell cache: shell, manifest, snapshot, assets, icons',
      !missing.length && assets.length > 0 && icons.length > 0,
      `${shell.length} entries, ${assets.length} assets, ${icons.length} icons${missing.length ? `; missing ${missing.join(' ')}` : ''}`
    );
    const refs = shellAssetRefs(sw.shellHtml);
    const uncovered = refs.filter((u) => !shell.includes(u));
    check('every asset the shell references is precached', refs.length > 0 && !uncovered.length, uncovered.length ? `missing ${uncovered.join(' ')}` : `${refs.length} references`);

    const copySaved = await waitForStorageKey(page, DATASET_KEY, 20_000);
    const copy = copySaved
      ? await page.evaluate((key) => {
          const raw = localStorage.getItem(key) || '';
          return { revision: JSON.parse(raw).revision, kb: Math.round(raw.length / 1024) };
        }, DATASET_KEY)
      : null;
    check('localStorage copy of the dataset saved', Boolean(copy), copy ? `revision ${copy.revision}, ${copy.kb} KB` : 'not written within 20 s');
    if (copy && copy.revision !== dataset.revision) note(`API revision ${copy.revision} ≠ snapshot ${dataset.revision}: the data changed after the last deploy (fine)`);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    check('page controlled by the worker after reload', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
    const online = await probePage(page, '/transport');
    check('no warning bar while online', !online.barWarn, online.barText || 'bar silent');
    const cacheKeys = await page.evaluate(() => caches.keys());
    advise('Google Fonts cached by the worker', cacheKeys.includes(FONTS_CACHE), cacheKeys.join(', '));
    // serve-dist sends no-cache (NO_CACHE_FILES); a CDN TTL on top delays a new build for installed apps by that TTL
    const swRes = await fetch(`${base}/transport-sw.js`);
    await swRes.arrayBuffer();
    const cacheControl = swRes.headers.get('cache-control') || '(none)';
    advise('worker script not frozen in HTTP caches (no-cache)', /no-cache|no-store|max-age=0/.test(cacheControl), `cache-control: ${cacheControl}`);

    step('2 offline', 'setOffline + every request aborted');
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    const pages = [
      ['/transport', 'planner'],
      [stopPath, 'times'],
      [`/transport/route/${routeId}`, 'times'],
      ['/transport/scheme', 'svg'],
    ];
    let onLineUnderEmulation = null;
    for (const [p, expects] of pages) {
      let response;
      try {
        response = await page.goto(`${base}${p}`, { waitUntil: 'load', timeout: 30_000 });
      } catch (e) {
        check(`${p}: served by the worker`, false, String(e).split('\n')[0].slice(0, 120));
        continue;
      }
      await page.waitForTimeout(1200);
      const info = await probePage(page, p);
      onLineUnderEmulation = info.onLine;
      check(
        `${p}: served by the worker`,
        response.status() === 200 && response.fromServiceWorker(),
        `status ${response.status()}, fromServiceWorker ${response.fromServiceWorker()}, navigation transferSize ${info.navTransfer}`
      );
      check(`${p}: no subresource from the network`, info.fromNetwork.length === 0, info.fromNetwork.join(' ') || 'none');
      const hasData = expects === 'times' ? info.times > 0 : expects === 'svg' ? info.svgPaths > 0 : true;
      check(`${p}: renders`, Boolean(info.h1) && !info.rootEmpty && !info.error && hasData, info.error || `h1 «${info.h1}», ${info.times} times, ${info.svgPaths} svg paths`);
      check(`${p}: warning bar`, info.barWarn && WARN_BAR_RE.test(info.barText || ''), info.barText || 'no bar');
      await shot(`offline${p.replace(/\W+/g, '_')}`);
    }
    note(`navigator.onLine under setOffline = ${onLineUnderEmulation} (Playwright caveat — hence «Сервер не відповідає…», not «Без мережі…»)`);
    const outOfScope = '/mizhgorodski offline not served by the worker (out of scope)';
    try {
      const r = await page.goto(`${base}/mizhgorodski`, { waitUntil: 'commit', timeout: 15_000 });
      check(outOfScope, !(r && r.fromServiceWorker()), r ? `status ${r.status()}, fromServiceWorker ${r.fromServiceWorker()}` : 'no response');
    } catch (e) {
      check(outOfScope, true, `browser error, as in a plain tab: ${String(e).split('\n')[0].slice(0, 80)}`);
    }

    step('3 backend down', 'online, only GET …/transport/dataset aborted');
    await context.unroute('**/*');
    await context.setOffline(false);
    await context.route(DATASET_API_RE, (route) => route.abort('failed'));
    await page.goto(`${base}${stopPath}`, { waitUntil: 'load' });
    const downBar = await waitForWarnBar(page);
    const down = await probePage(page, stopPath);
    check('board from the local copy', Boolean(down.h1) && !down.error && down.times > 0, down.error || `h1 «${down.h1}», ${down.times} times`);
    check('bar «Сервер не відповідає…» with «Оновити»', downBar && /Сервер не відповідає/.test(down.barText || '') && down.retryButton, down.barText || 'no bar within 25 s');
    await shot('backend-down_stop');
    await page.evaluate((key) => localStorage.removeItem(key), DATASET_KEY);
    await page.reload({ waitUntil: 'load' });
    const snapBar = await waitForWarnBar(page);
    const snap = await probePage(page, stopPath);
    check('board from the build snapshot when the copy is gone', snapBar && !snap.error && snap.times > 0, snap.error || `${snap.times} times; ${snap.barText || 'no bar'}`);

    step('4 back online', 'the API answers again');
    await context.unroute(DATASET_API_RE);
    await page.goto(`${base}${stopPath}`, { waitUntil: 'load' });
    const barGone = await page
      .waitForFunction(() => !document.querySelector('.lt-status-bar--warn'), null, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    const back = await probePage(page, stopPath);
    check('warning bar disappears once the API answers', barGone && !back.barWarn, back.barText || 'bar silent');
    check('localStorage copy written again', await waitForStorageKey(page, DATASET_KEY, 10_000));
    await shot('online_stop');
    // The wording for a real network loss is reachable here only by stubbing navigator.onLine (see the caveat above)
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await page.reload({ waitUntil: 'load' });
    const stubbedBar = await waitForWarnBar(page, 10_000);
    const stubbed = await probePage(page, stopPath);
    check('navigator.onLine=false → bar «Без мережі…»', stubbedBar && /^Без мережі/.test(stubbed.barText || '') && stubbed.times > 0, stubbed.barText || 'no bar');
    await shot('offline-wording_stop');

    step('all', 'whole run');
    check('no uncaught page errors', !pageErrors.length, pageErrors.slice(0, 3).join(' | ') || 'none');
    note(`${consoleErrors} console errors in total (offline, every aborted tile, gtag and API call logs one)`);
  } finally {
    await browser.close();
  }
}

const base = parseBase(process.argv[2]);
try {
  await run(base);
} catch (e) {
  record('FAIL', 'run aborted', e instanceof Error ? e.message : String(e));
}
printTable();
const count = (status) => results.filter((r) => r.status === status).length;
const failed = count('FAIL');
console.log(`\npwa-smoke ${base}: ${results.length} checks — ${count('PASS')} PASS, ${count('WARN')} WARN, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
