/**
 * true, коли сторінку рендерить `scripts/prerender-spa.mjs` (статичний HTML для пошуковиків і ІІ;
 * прапорець ставить `src/prerender-entry.tsx`). У браузері — завжди false: клієнт монтує SPA
 * через createRoot поверх статичного HTML.
 */
export function isPrerendering(): boolean {
  return typeof window !== 'undefined' && (window as Window & { __MALIN_PRERENDER__?: boolean }).__MALIN_PRERENDER__ === true;
}
