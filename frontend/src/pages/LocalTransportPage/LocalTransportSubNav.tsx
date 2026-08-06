import { Link, useLocation } from 'react-router-dom';
import './LocalTransportPage.css';

type Props = {
  /** Параметри дати/часу для збереження контексту при перемиканні */
  searchDate: string;
  searchTime: string;
};

/**
 * Міні-навігація між пошуком «З→До» та табло зупинки.
 * Режим маршруту (`/transport/route/...`) вважається частиною «Маршрути».
 * Дані обох режимів — з GET /transport/dataset.
 */
export function LocalTransportSubNav({ searchDate, searchTime }: Props) {
  const location = useLocation();
  const qs = new URLSearchParams();
  if (searchDate) qs.set('d', searchDate);
  if (searchTime) qs.set('h', searchTime);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const isStop = location.pathname.startsWith('/transport/stop');
  const isSearch = !isStop;

  return (
    <nav className="lt-subnav" aria-label="Режим розкладу">
      <Link
        className={`lt-subnav-link ${isSearch ? 'lt-subnav-link--active' : ''}`}
        to={`/transport${suffix}`}
        aria-current={isSearch ? 'page' : undefined}
      >
        Маршрути (З → До)
      </Link>
      <Link
        className={`lt-subnav-link ${isStop ? 'lt-subnav-link--active' : ''}`}
        to={`/transport/stop${suffix}`}
        aria-current={isStop ? 'page' : undefined}
      >
        Зупинка (табло)
      </Link>
    </nav>
  );
}
