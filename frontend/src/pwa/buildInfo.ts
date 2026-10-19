/**
 * Видима збірка (Docs/transport-verifiable-build-2026-10.md, фаза 2 — П7 «перевірювана архітектура»): три числа, які
 * людина бачить на `/about` і може звірити сама, без нас:
 *   - хеш бандла — з назви головного скрипта сторінки (`/assets/index-<hash>.js`, `loadedBundle()`); той самий файл
 *     і його `integrity` видно в джерелі сторінки;
 *   - BUILD_ID активного service worker транспорту — через `GET_BUILD_ID` (`buildIdOf`); той самий рядок —
 *     `curl -s https://<сайт>/transport-sw.js | grep BUILD_ID`;
 *   - ревізія даних — з локальної копії датасету (`transport-dataset:v1`), а не з мережі: `/about` не має качати
 *     265 КБ заради рядка, а звіряти людина хоче саме те, що лежить у її браузері, з `/transport/revisions`.
 */
import { useEffect, useState } from 'react';
import { readStored } from '@/pages/LocalTransportPage/dataset/datasetStore';
import { loadedBundle } from '@/site/freshBuild';
import { isPrerendering } from '@/utils/prerender';
import { SW_SCOPE, buildIdOf, serviceWorkerSupported, type ServiceWorkerLike } from './serviceWorker';

export interface BuildInfo {
  /** Хеш головного скрипта збірки; null — dev-сервер або пререндер */
  bundle: string | null;
  /** BUILD_ID активного воркера; null — воркера нема (людина не була на /transport, інший домен, dev); undefined — ще питаємо */
  worker: string | null | undefined;
  /** BUILD_ID нової збірки, що встановилась і чекає (воркер не кличе skipWaiting); null — не чекає */
  waiting: string | null;
  /** Ревізія локальної копії даних (ISO) або час її збереження; null — копії нема */
  dataAsOf: string | null;
}

/** id рядка на /about — `/about#build` */
export const BUILD_STAMP_ID = 'build';

export function workerLabel(worker: BuildInfo['worker']): string {
  if (worker === undefined) return 'перевіряємо…';
  if (worker === null) return 'не встановлено (з’являється після відкриття /transport)';
  return worker;
}

const BUNDLE_HASH_RE = /\/assets\/index-([A-Za-z0-9_-]+)\.js$/;

/** '/assets/index-BQ7sKb7V.js' → 'BQ7sKb7V' */
export function bundleHashOf(src: string | null): string | null {
  return BUNDLE_HASH_RE.exec(src ?? '')?.[1] ?? null;
}

/**
 * BUILD_ID активного воркера транспорту (і того, що чекає) з будь-якої сторінки origin; active null — реєстрації чи
 * активного воркера нема. Показуємо саме активний: це він віддає сторінки; `curl …/transport-sw.js` після деплою
 * покаже новий id, поки той лише чекає (`Docs/transport-pwa-2026-10.md`, фаза 4) — тому waiting теж на виду.
 */
export async function workerBuildIds(
  sw: Pick<ServiceWorkerLike, 'getRegistration'> | null = serviceWorkerSupported() ? navigator.serviceWorker : null
): Promise<{ active: string | null; waiting: string | null }> {
  if (!sw) return { active: null, waiting: null };
  const reg = await sw.getRegistration(SW_SCOPE).catch(() => undefined);
  const [active, waiting] = await Promise.all([reg?.active ? buildIdOf(reg.active) : null, reg?.waiting ? buildIdOf(reg.waiting) : null]);
  return { active, waiting };
}

/** Мітка локальної копії датасету — та сама, що показує смужка стану без мережі */
export function storedDataAsOf(): string | null {
  const stored = readStored();
  if (!stored) return null;
  return stored.revision ?? new Date(stored.fetchedAt).toISOString();
}

export function useBuildInfo(deps: { sw?: Pick<ServiceWorkerLike, 'getRegistration'> | null } = {}): BuildInfo {
  const prerender = isPrerendering();
  const [ids, setIds] = useState<{ active: string | null | undefined; waiting: string | null }>({ active: undefined, waiting: null });
  const sw = deps.sw;
  useEffect(() => {
    if (prerender) return;
    let alive = true;
    void workerBuildIds(sw === undefined ? undefined : sw).then((next) => {
      if (alive) setIds(next);
    });
    return () => {
      alive = false;
    };
  }, [prerender, sw]);
  if (prerender) return { bundle: null, worker: null, waiting: null, dataAsOf: null };
  return { bundle: bundleHashOf(loadedBundle()), worker: ids.active, waiting: ids.waiting, dataAsOf: storedDataAsOf() };
}
