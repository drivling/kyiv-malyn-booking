/**
 * «Доступна нова версія» (Docs/transport-pwa-2026-10.md, фаза 4): нова збірка відома, але застосовувати її зараз
 * небезпечно (модалка, поле вводу, коротка відсутність) — людина сама тисне «Оновити», або все станеться на
 * наступному переході / запуску. Не на /admin (там freshBuild взагалі нічого не чіпає).
 */
import { useLocation } from 'react-router-dom';
import { applyReadyUpdate, setUpdateReady, useUpdateReady } from './serviceWorker';
import './UpdateBanner.css';

/** `reload` — лише для тестів (jsdom не вміє location.reload) */
export function UpdateBanner({ reload }: { reload?: () => void } = {}) {
  const ready = useUpdateReady();
  const { pathname } = useLocation();
  if (!ready || pathname === '/admin' || pathname.startsWith('/admin/')) return null;
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">Доступна нова версія сайту</span>
      <button type="button" className="update-banner__btn update-banner__btn--primary" onClick={() => applyReadyUpdate(reload)}>
        Оновити
      </button>
      <button type="button" className="update-banner__btn" onClick={() => setUpdateReady(null)}>
        Пізніше
      </button>
    </div>
  );
}
