/**
 * Реєструє service worker транспорту, щойно людина опиняється на `/transport*` (Docs/transport-pwa-2026-10.md):
 * відвідувач міжміського табло precache не качає. Після `load`, щоб не змагатись із першим рендером за мережу.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { registerTransportServiceWorker, shouldRegisterServiceWorker } from './serviceWorker';

export function useTransportServiceWorker(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!shouldRegisterServiceWorker(pathname)) return;
    const run = () => void registerTransportServiceWorker();
    if (document.readyState === 'complete') {
      run();
      return;
    }
    window.addEventListener('load', run, { once: true });
    return () => window.removeEventListener('load', run);
  }, [pathname]);
}
