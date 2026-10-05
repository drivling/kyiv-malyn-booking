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
 * Міні-навігація між пошуком «З→До», табло зупинки та схемою маршрутів.
 * Режим маршруту (`/transport/route/...`) вважається частиною «Маршрути».
 * Дані всіх режимів — з GET /transport/dataset (схема — статичний SVG + датасет для картки).
 */
export function LocalTransportSubNav({ searchDate, searchTime, fromStopId }: Props) {
  const location = useLocation();
  const qs = new URLSearchParams();
  if (searchDate) qs.set('d', searchDate);
  if (searchTime) qs.set('h', searchTime);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const isStop = location.pathname.startsWith('/transport/stop');
  const isScheme = location.pathname.startsWith('/transport/scheme');
  const isSearch = !isStop && !isScheme;

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

  // Три вкладки мають вміститися в панель 380px / екран телефона одним рядком, тому видимі
  // підписи короткі; повні назви лишаються в aria-label (їх читають скрінрідери й тести).
  return (
    <nav className="lt-subnav" aria-label="Режим розкладу">
      <Link
        className={`lt-subnav-link ${isSearch ? 'lt-subnav-link--active' : ''}`}
        to={routesHref}
        aria-current={isSearch ? 'page' : undefined}
        aria-label="Маршрути (З → До)"
      >
        Маршрути
      </Link>
      <Link
        className={`lt-subnav-link ${isStop ? 'lt-subnav-link--active' : ''}`}
        to={boardHref}
        aria-current={isStop ? 'page' : undefined}
        aria-label="Зупинка (табло)"
      >
        Зупинка
      </Link>
      <Link
        className={`lt-subnav-link ${isScheme ? 'lt-subnav-link--active' : ''}`}
        to={`/transport/scheme${suffix}`}
        aria-current={isScheme ? 'page' : undefined}
      >
        Схема
      </Link>
    </nav>
  );
}
