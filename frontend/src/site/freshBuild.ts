import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { SW_BUILD_PREFIX, applyNewBuild, checkForNewBuild, isControlled, setUpdateReady } from '@/pwa/serviceWorker';
import { isPrerendering } from '@/utils/prerender';

/**
 * Автооновлення застарілої вкладки. Chrome на телефоні роками тримає вкладку в пам'яті й,
 * повертаючись до неї, не завантажує сайт заново — людина бачить стару збірку без нових функцій
 * (так було з «Фактом прибуття»: утримання не працювало, бо вкладка була відкрита до деплою).
 *
 * Збірку видає хеш у назві головного скрипта (`/assets/index-<hash>.js`). Коли вкладка знову стає
 * видимою, тихо беремо свіжий `/` (HTML без кешу) і порівнюємо скрипт:
 * - нова збірка, а вкладку не відкривали ≥ 30 хв і людина нічого не заповнює — перезавантажуємо одразу;
 * - інакше — на наступному переході на іншу сторінку робимо повне завантаження замість SPA-переходу.
 * Адмінку не чіпаємо (там бувають незбережені зміни). Одна спроба на збірку за сесію — без циклів.
 *
 * Під service worker транспорту (Docs/transport-pwa-2026-10.md, фаза 4) політика та сама, але примітиви інші:
 * замість `fetch('/')` — `reg.update()` (нова збірка ставиться у фоні й чекає), замість `location.reload()` —
 * SKIP_WAITING, після якого перезавантажує слухач `controllerchange`. Reload під старим воркером лише віддав би
 * стару оболонку з кешу. Коли нова збірка відома, але зараз не безпечно — банер «Доступна нова версія».
 */

const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
/** Не частіше за раз на 10 хв */
export const CHECK_EVERY_MS = 10 * 60 * 1000;
/** Вкладку «покинули» — можна оновити одразу при поверненні */
export const STALE_HIDDEN_MS = 30 * 60 * 1000;
const RELOADED_KEY = 'fresh-build-reloaded:';

export interface BuildUpdater {
  /** Сторінка під service worker — перевірка і застосування йдуть через нього */
  controlled(): boolean;
  /** 'sw:<buildId>', коли нова збірка встановлена й чекає; null — нема (або мережі нема) */
  check(): Promise<string | null>;
  /** true — нову збірку запущено, перезавантаження зробить controllerchange */
  apply(): boolean;
}

const defaultUpdater: BuildUpdater = { controlled: isControlled, check: checkForNewBuild, apply: applyNewBuild };

/** Головний скрипт збірки, з якою працює сторінка; у dev (`/src/main.tsx`) — null */
export function loadedBundle(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))) {
    const m = BUNDLE_RE.exec(s.getAttribute('src') ?? '');
    if (m) return m[0];
  }
  return null;
}

export function bundleInHtml(html: string): string | null {
  return BUNDLE_RE.exec(html)?.[0] ?? null;
}

/** Скрипт збірки, яку зараз віддає сервер; помилка мережі — null (нічого не робимо) */
export async function fetchLatestBundle(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl('/', { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return null;
    return bundleInHtml(await res.text());
  } catch {
    return null;
  }
}

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * Можна перезавантажити зараз: не адмінка, немає відкритого модального вікна (бронювання, «Факт
 * прибуття», карта), курсор не в полі вводу. Банер cookies і картка зупинки на карті — `role="dialog"`
 * без `aria-modal`, вони не заважають.
 */
export function safeToReload(doc: Document = document, pathname = window.location.pathname): boolean {
  if (isAdminPath(pathname)) return false;
  if (doc.querySelector('[aria-modal="true"]')) return false;
  const el = doc.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return false;
  return true;
}

function alreadyReloadedFor(bundle: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY + bundle)) return true;
    sessionStorage.setItem(RELOADED_KEY + bundle, '1');
  } catch {
    /* без sessionStorage — все одно одна спроба, бо після перезавантаження збірка вже нова */
  }
  return false;
}

export function useFreshBuild(
  opts: { fetchImpl?: typeof fetch; reload?: () => void; now?: () => number; updater?: BuildUpdater } = {}
): void {
  const { pathname } = useLocation();
  const ready = useRef<string | null>(null);
  const firstPath = useRef(pathname);
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Нова збірка з воркера — SKIP_WAITING; інакше (або якщо воркер не має що запускати) — повне завантаження */
  const doReload = (latest: string) => {
    const o = optsRef.current;
    if (latest.startsWith(SW_BUILD_PREFIX) && (o.updater ?? defaultUpdater).apply()) return;
    (o.reload ?? (() => window.location.reload()))();
  };
  const doReloadRef = useRef(doReload);
  doReloadRef.current = doReload;

  // Нова збірка вже відома — перехід на іншу сторінку робимо повним завантаженням
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    const next = ready.current;
    if (!next || isAdminPath(pathname) || alreadyReloadedFor(next)) return;
    doReloadRef.current(next);
  }, [pathname]);

  useEffect(() => {
    // dev-сервер (`/src/main.tsx`) і пререндер — без збірки, нічого не перевіряємо
    const loaded = isPrerendering() ? null : loadedBundle();
    if (!loaded) return;
    const now = () => (optsRef.current.now ?? Date.now)();
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? now() : null;
    let lastCheck = now();
    let busy = false;

    const check = async (hiddenFor: number) => {
      if (busy || now() - lastCheck < CHECK_EVERY_MS) return;
      busy = true;
      lastCheck = now();
      const o = optsRef.current;
      const updater = o.updater ?? defaultUpdater;
      // Рішення «під воркером чи ні» — на кожну перевірку: перший візит стає контрольованим після clients.claim()
      const latest = updater.controlled() ? await updater.check() : await fetchLatestBundle(o.fetchImpl ?? fetch);
      busy = false;
      if (!latest || latest === loaded) return;
      ready.current = latest;
      if (hiddenFor >= STALE_HIDDEN_MS && safeToReload(document, currentPath.current) && !alreadyReloadedFor(latest)) {
        doReloadRef.current(latest);
        return;
      }
      // Зараз не час — банер «Доступна нова версія» (src/pwa/UpdateBanner.tsx); перехід усе одно застосує
      setUpdateReady(latest);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = now();
        return;
      }
      const hiddenFor = hiddenAt === null ? 0 : now() - hiddenAt;
      hiddenAt = null;
      void check(hiddenFor);
    };
    // Сторінка повернулась із bfcache (кнопка «назад», відновлена вкладка)
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check(STALE_HIDDEN_MS);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}
