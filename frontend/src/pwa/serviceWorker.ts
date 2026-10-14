/**
 * Реєстрація service worker транспорту і нова збірка (Docs/transport-pwa-2026-10.md, фаза 4).
 *
 * Воркер при install НЕ кличе skipWaiting — нова збірка ставиться у фоні й чекає. Політика «коли застосувати»
 * лишається в `src/site/freshBuild.ts` (30 хв покинутої вкладки, safeToReload, наступний перехід); звідси вона
 * бере три примітиви: `isControlled`, `checkForNewBuild` (замість fetch('/')) і `applyNewBuild`
 * (SKIP_WAITING → controllerchange → reload). Справжній reload робить лише слухач `controllerchange` і лише
 * коли ми самі попросили: перший install теж кидає цю подію, коли воркер забирає сторінку через clients.claim().
 */
import { useSyncExternalStore } from 'react';
import { getCurrentSite } from '@/site/siteConfig';
import { isPrerendering } from '@/utils/prerender';

export const SW_URL = '/transport-sw.js';
export const SW_SCOPE = '/transport';
/** Префікс «нової збірки», яку знає воркер (на відміну від хеша бандла з HTML) */
export const SW_BUILD_PREFIX = 'sw:';
/** Скільки чекати, поки нова збірка докачає precache (~1 МБ) */
export const INSTALL_WAIT_MS = 60_000;
const BUILD_ID_WAIT_MS = 2_000;

export interface ServiceWorkerLike {
  controller: ServiceWorker | null;
  register(url: string, options?: RegistrationOptions): Promise<ServiceWorkerRegistration>;
  getRegistration(scope?: string): Promise<ServiceWorkerRegistration | undefined>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

let registration: ServiceWorkerRegistration | null = null;
let registered = false;
let applying = false;
let refreshing = false;

// ---- «нова версія чекає» — для банера
let updateReady: string | null = null;
const listeners = new Set<() => void>();

export function setUpdateReady(value: string | null): void {
  if (updateReady === value) return;
  updateReady = value;
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** 'sw:<buildId>' або хеш бандла, коли нова збірка відома, але її ще не застосували; null — нема */
export function useUpdateReady(): string | null {
  return useSyncExternalStore(subscribe, () => updateReady, () => null);
}

export function isTransportPath(pathname: string): boolean {
  return pathname === '/transport' || pathname.startsWith('/transport/');
}

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** Лише прод, лише головний домен, не пререндер, і лише коли людина вже на сторінці транспорту */
export function shouldRegisterServiceWorker(pathname: string): boolean {
  return import.meta.env.PROD && serviceWorkerSupported() && !isPrerendering() && getCurrentSite().isPrimary && isTransportPath(pathname);
}

/** Сторінка під контролем воркера (після першого install — лише після clients.claim()) */
export function isControlled(): boolean {
  return serviceWorkerSupported() && Boolean(navigator.serviceWorker.controller);
}

/** BUILD_ID воркера через MessageChannel; 'waiting', якщо він не відповів (старий шаблон) */
export function buildIdOf(worker: ServiceWorker, timeoutMs = BUILD_ID_WAIT_MS): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (id: string) => {
      if (done) return;
      done = true;
      resolve(id);
    };
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e: MessageEvent<{ buildId?: string }>) => finish(String(e.data?.buildId || 'waiting'));
      worker.postMessage({ type: 'GET_BUILD_ID' }, [channel.port2]);
    } catch {
      finish('waiting');
    }
    setTimeout(() => finish('waiting'), timeoutMs);
  });
}

function waitForInstalled(worker: ServiceWorker, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (worker.state !== 'installing') {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installing') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/** Воркер, що встановився і чекає за живою сторінкою — нова збірка; без controller це перший install */
async function waitingBuild(reg: ServiceWorkerRegistration, sw: ServiceWorkerLike): Promise<string | null> {
  if (!reg.waiting || !sw.controller) return null;
  return `${SW_BUILD_PREFIX}${await buildIdOf(reg.waiting)}`;
}

/**
 * Реєструє воркер (ідемпотентно). Якщо нова збірка вже чекає (інша вкладка її докачала) — лише банер, не reload.
 * `deps` — для тестів (jsdom не має navigator.serviceWorker).
 */
export function registerTransportServiceWorker(
  deps: { sw?: ServiceWorkerLike; reload?: () => void } = {}
): Promise<ServiceWorkerRegistration | null> {
  if (registered) return Promise.resolve(registration);
  registered = true;
  const sw = deps.sw ?? (serviceWorkerSupported() ? navigator.serviceWorker : null);
  if (!sw) return Promise.resolve(null);
  const reload = deps.reload ?? (() => window.location.reload());

  sw.addEventListener('controllerchange', () => {
    if (!applying || refreshing) return;
    refreshing = true;
    reload();
  });

  return sw
    .register(SW_URL, { scope: SW_SCOPE })
    .then(async (reg) => {
      registration = reg;
      const already = await waitingBuild(reg, sw);
      if (already) setUpdateReady(already);
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state !== 'installed') return;
          void waitingBuild(reg, sw).then((next) => {
            if (next) setUpdateReady(next);
          });
        });
      });
      return reg;
    })
    .catch(() => null);
}

/**
 * Замість fetch('/') під контролем воркера: reg.update() → дочекатись install → 'sw:<id>', якщо нова збірка
 * чекає; null — нема (або це перший install, або мережі нема — reg.update() тоді відхиляється).
 */
export async function checkForNewBuild(timeoutMs = INSTALL_WAIT_MS, sw: ServiceWorkerLike | null = serviceWorkerSupported() ? navigator.serviceWorker : null): Promise<string | null> {
  if (!sw) return null;
  const reg = registration ?? (await sw.getRegistration(SW_SCOPE).catch(() => undefined)) ?? null;
  if (!reg) return null;
  try {
    await reg.update();
  } catch {
    return null;
  }
  if (reg.installing) await waitForInstalled(reg.installing, timeoutMs);
  return waitingBuild(reg, sw);
}

/** true — нову збірку запущено; reload зробить controllerchange, коли вона забере сторінку */
export function applyNewBuild(): boolean {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  applying = true;
  waiting.postMessage('SKIP_WAITING');
  return true;
}

/** «Оновити» з банера: воркер — через SKIP_WAITING, звичайна збірка — повне завантаження */
export function applyReadyUpdate(reload: () => void = () => window.location.reload()): void {
  const value = updateReady;
  if (!value) return;
  if (value.startsWith(SW_BUILD_PREFIX) && applyNewBuild()) return;
  reload();
}

export function resetServiceWorkerForTests(): void {
  registration = null;
  registered = false;
  applying = false;
  refreshing = false;
  setUpdateReady(null);
}
