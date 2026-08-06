import { Link, useLocation } from 'react-router-dom';
import './LocalTransportPage.css';

type Props = {
  /** Параметри дати/часу для збереження контексту при перемиканні */
  searchDate: string;
  searchTime: string;
};

/**
 * Міні-навігація між пошуком «З→До» та табло зупинки (як окремі режими одного розділу).
 * Режим маршруту (`/localtransport/route/...`) вважається частиною «Маршрути».
 */
export function LocalTransportSubNav({ searchDate, searchTime }: Props) {
  const location = useLocation();
  const qs = new URLSearchParams();
  if (searchDate) qs.set('d', searchDate);
  if (searchTime) qs.set('h', searchTime);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const isStop = location.pathname.startsWith('/localtransport/stop');
  const isSearch = !isStop;

  return (
    <nav className="lt-subnav" aria-label="Режим розкладу">
      <Link
        className={`lt-subnav-link ${isSearch ? 'lt-subnav-link--active' : ''}`}
        to={`/localtransport${suffix}`}
      >
        Маршрути (З → До)
      </Link>
      <Link
        className={`lt-subnav-link ${isStop ? 'lt-subnav-link--active' : ''}`}
        to={`/localtransport/stop${suffix}`}
      >
        Зупинка (табло)
      </Link>
    </nav>
  );
}
