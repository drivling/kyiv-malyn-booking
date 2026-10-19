/**
 * Рядок «що саме у вас відкрито» на /about (Docs/transport-verifiable-build-2026-10.md, фаза 2): збірка, воркер,
 * дані — і як це звірити. Під пререндером не рендериться: значення живуть лише в браузері людини. Адреси відносні —
 * сторінка одна на всі домени.
 */
import { BUILD_STAMP_ID, useBuildInfo, workerLabel } from './buildInfo';
import { isPrerendering } from '@/utils/prerender';
import type { ServiceWorkerLike } from './serviceWorker';

export function BuildStamp({ sw }: { sw?: Pick<ServiceWorkerLike, 'getRegistration'> | null } = {}) {
  const info = useBuildInfo(sw === undefined ? {} : { sw });
  if (isPrerendering()) return null;
  return (
    <p className="company-legal-highlight__hint" id={BUILD_STAMP_ID} data-testid="build-stamp">
      Що саме у вас відкрито: збірка <code>{info.bundle ?? 'dev-сервер'}</code>, service worker «Як доїхати»{' '}
      <code>{workerLabel(info.worker)}</code>, дані <code>{info.dataAsOf ?? 'копії ще нема'}</code>. Це можна звірити без
      нас: <code>integrity</code> скрипта й стилів — у джерелі цієї сторінки (той самий файл лежить у <code>/assets/</code>),{' '}
      <code>BUILD_ID</code> — у <a href="/transport-sw.js">/transport-sw.js</a>, ревізія даних — у{' '}
      <a href="/transport/revisions">журналі ревізій</a>.
    </p>
  );
}
