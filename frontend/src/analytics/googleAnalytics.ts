import { hasCookieConsent } from '@/analytics/cookieConsent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let scriptInjected = false;
let gtagConfigured = false;

export function gaMeasurementId(): string | undefined {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
  return id || undefined;
}

/** Не збираємо перегляди адмінки в тій самій вітрині звітів */
export function gaShouldTrackPath(pathname: string): boolean {
  if (pathname.startsWith('/admin')) return false;
  return true;
}

/**
 * Один раз підвантажує gtag.js і викликає config (без автоматичного page_view).
 */
export function ensureGoogleAnalytics(): void {
  const id = gaMeasurementId();
  if (!id || !hasCookieConsent()) return;

  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
  }

  if (!scriptInjected) {
    scriptInjected = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
  }

  if (!gtagConfigured) {
    gtagConfigured = true;
    window.gtag('js', new Date());
    const config: Record<string, unknown> = { send_page_view: false };
    if (import.meta.env.DEV) {
      config.debug_mode = true;
    }
    window.gtag('config', id, config);
  }
}

/**
 * Подія page_view для GA4 (рекомендований спосіб для SPA).
 */
export function gaTrackPageView(pathname: string, search: string, hash: string): void {
  const id = gaMeasurementId();
  if (!id || !hasCookieConsent() || typeof window.gtag !== 'function') return;
  if (!gaShouldTrackPath(pathname)) return;

  const page_path = `${pathname}${search || ''}${hash || ''}` || '/';

  window.gtag('event', 'page_view', {
    page_title: document.title,
    page_location: window.location.href,
    page_path,
  });
}

export function ensureAndTrackPage(pathname: string, search: string, hash: string): void {
  if (!gaMeasurementId() || !hasCookieConsent()) return;
  if (!gaShouldTrackPath(pathname)) return;
  ensureGoogleAnalytics();
  gaTrackPageView(pathname, search, hash);
}
