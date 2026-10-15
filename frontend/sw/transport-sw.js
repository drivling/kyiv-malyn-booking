/* eslint-env serviceworker */
/* global __PRECACHE__ */
// @ts-check
/// <reference lib="webworker" />

/**
 * Service worker застосунку «Як доїхати» (Docs/transport-pwa-2026-10.md, фаза 4). ШАБЛОН:
 * `scripts/build-sw.mjs` підставляє список precache і BUILD_ID (sha256 списку + вмісту нехешованих файлів)
 * і пише `dist/transport-sw.js`. Реєструється з `src/pwa/serviceWorker.ts` зі scope `/transport`, тож решта
 * сайту і адмінка на тому ж origin ніколи не під його контролем.
 *
 * Що робить і чого свідомо не робить:
 *   - оболонка (`/index.html`), хешовані `/assets/**`, маніфест, іконки і знімок даних `/transport/dataset.json`
 *     лежать у precache і віддаються cache-first: табло має відкритись миттєво і без мережі; нова збірка
 *     встановлюється у фоні й ЧЕКАЄ (без `skipWaiting()` при install) — її застосовує сторінка, коли безпечно
 *     (`src/site/freshBuild.ts`), або людина з банера;
 *   - навігація на сторінку транспорту отримує оболонку з кешу; інша навігація (`/mizhgorodski`, `/admin`,
 *     постер схеми) іде повз;
 *   - Google Fonts (CSS і woff2) — cache-first в окремому кеші: без них перший рендер без мережі чекав би на
 *     шрифт, що ніколи не прийде;
 *   - крос-доменний API (Railway), тайли OSM, gtag — не чіпає: копію датасету тримає сама сторінка
 *     (localStorage), а відповідь API з кешу воркера була б брехнею із зеленою галочкою.
 */

const BUILD_ID = '__BUILD_ID__';
/** @type {string[]} */
const PRECACHE = __PRECACHE__;

const SHELL_PREFIX = 'malin-transport-shell-';
const SHELL_CACHE = `${SHELL_PREFIX}${BUILD_ID}`;
const FONTS_CACHE = 'malin-transport-fonts-v1';
const SHELL_URL = '/index.html';
const PRECACHE_SET = new Set(PRECACHE);
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

/** Сторінка транспорту: `/transport` або `/transport/...` без розширення в останньому сегменті */
function isTransportPage(pathname) {
  if (pathname !== '/transport' && !pathname.startsWith('/transport/')) return false;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !/\.[a-z0-9]+$/i.test(last);
}

/** Нехешовані записи (оболонка, маніфест, іконки, знімок) беремо повз HTTP-кеш: їх URL не змінюються між збірками */
function precacheRequest(url) {
  return new Request(url, { cache: url.startsWith('/assets/') ? 'default' : 'reload' });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          fetch(precacheRequest(url)).then((res) => {
            if (!res.ok) throw new Error(`precache ${url}: ${res.status}`);
            return cache.put(url, res);
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data && data.type === 'GET_BUILD_ID') {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ buildId: BUILD_ID });
  }
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Не-GET (sticker-scans, arrival-reports, PUT адмінки) не відповідаємо взагалі: їх шле сама сторінка
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (FONT_HOSTS.has(url.hostname)) event.respondWith(cacheFirst(FONTS_CACHE, request));
    return;
  }

  if (request.mode === 'navigate') {
    if (!isTransportPage(url.pathname)) return;
    event.respondWith(
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.match(SHELL_URL))
        .then((hit) => hit || fetch(request))
    );
    return;
  }

  // Лише те, що є в precache: `/` від freshBuild, sitemap, routes.json і решта сайту йдуть повз
  if (PRECACHE_SET.has(url.pathname)) event.respondWith(cacheFirst(SHELL_CACHE, request));
});
