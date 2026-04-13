/** ID вимірювання GA4 (той самий, що в index.html) */
export const GA_MEASUREMENT_ID = 'G-F0Q1HQJMZ8' as const;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function gaMeasurementId(): string | undefined {
  return GA_MEASUREMENT_ID;
}

/** Не збираємо перегляди адмінки в тій самій вітрині звітів */
export function gaShouldTrackPath(pathname: string): boolean {
  if (pathname.startsWith('/admin')) return false;
  return true;
}

/**
 * Подія page_view для GA4 (SPA). gtag ініціалізується в index.html.
 */
export function gaTrackPageView(pathname: string, search: string, hash: string): void {
  if (typeof window.gtag !== 'function') return;
  if (!gaShouldTrackPath(pathname)) return;

  const page_path = `${pathname}${search || ''}${hash || ''}` || '/';

  window.gtag('event', 'page_view', {
    page_title: document.title,
    page_location: window.location.href,
    page_path,
  });
}

export function ensureAndTrackPage(pathname: string, search: string, hash: string): void {
  if (!gaShouldTrackPath(pathname)) return;
  gaTrackPageView(pathname, search, hash);
}
