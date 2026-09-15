import { Link, useLocation } from 'react-router-dom';
import './LocalTransportPage.css';

type Props = {
  /** Параметри дати/часу для збереження контексту при перемиканні */
  searchDate: string;
  searchTime: string;
  /**
   * Обрана зупинка «З» (планувальник / сторінка маршруту) або зупинка табло —
   * переноситься між режимами, щоб не обирати її заново.
   */
  fromStopId?: string;
};

/**
 * Міні-навігація між пошуком «З→До» та табло зупинки.
 * Режим маршруту (`/transport/route/...`) вважається частиною «Маршрути».
 * Дані обох режимів — з GET /transport/dataset.
 */
export function LocalTransportSubNav({ searchDate, searchTime, fromStopId }: Props) {
  const location = useLocation();
  const qs = new URLSearchParams();
  if (searchDate) qs.set('d', searchDate);
  if (searchTime) qs.set('h', searchTime);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const isStop = location.pathname.startsWith('/transport/stop');
  const isSearch = !isStop;

  // З табло у планувальник — обрана зупинка стає «З» (?from=); на самому планувальнику
  // активний таб веде на /transport без from=, щоб не скинути «До».
  let routesHref = `/transport${suffix}`;
  if (isStop && fromStopId) {
    const withFrom = new URLSearchParams(qs);
    withFrom.set('from', fromStopId);
    routesHref = `/transport?${withFrom.toString()}`;
  }
  const boardHref = fromStopId
    ? `/transport/stop/${encodeURIComponent(fromStopId)}${suffix}`
    : `/transport/stop${suffix}`;

  return (
    <nav className="lt-subnav" aria-label="Режим розкладу">
      <Link
        className={`lt-subnav-link ${isSearch ? 'lt-subnav-link--active' : ''}`}
        to={routesHref}
        aria-current={isSearch ? 'page' : undefined}
      >
        Маршрути (З → До)
      </Link>
      <Link
        className={`lt-subnav-link ${isStop ? 'lt-subnav-link--active' : ''}`}
        to={boardHref}
        aria-current={isStop ? 'page' : undefined}
      >
        Зупинка (табло)
      </Link>
    </nav>
  );
}
