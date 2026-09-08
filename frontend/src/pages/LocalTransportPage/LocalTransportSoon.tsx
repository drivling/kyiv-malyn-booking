import { Link } from 'react-router-dom';
import { usePageSeo } from '@/hooks/usePageSeo';
import { getCurrentSite, primaryUrl } from '@/site/siteConfig';
import './LocalTransportPage.css';
import './LocalTransportSoon.css';

/**
 * Заглушка для міст, у яких локального транспорту ще немає
 * (прапорець TripPoint.hasLocalTransport знятий в адмінці).
 */
export const LocalTransportSoon: React.FC = () => {
  const site = getCurrentSite();

  usePageSeo({
    title: `Транспорт ${site.cityNameUkGenitive} — скоро | ${site.domain}`,
    canonicalUrl: primaryUrl('/transport'),
    description: `Розклад міських маршруток ${site.cityNameUkGenitive} готуємо. Поки що доступні міжміські поїздки: маршрутки, попутки, потяги.`,
    robots: 'noindex, follow',
  });

  return (
    <div className="lt-page lt-theme-jakdojade lt-layout-dark">
      <div className="lt-container">
        <div className="lt-soon">
          <p className="lt-soon-badge">Скоро</p>
          <h1 className="lt-soon-title">Локальний транспорт {site.cityNameUkGenitive}</h1>
          <p className="lt-soon-text">
            Ми ще збираємо маршрути та розклад міських маршруток {site.cityNameUkGenitive}. Щойно дані будуть
            готові — пошук «З → До» і табло зупинок з’являться тут.
          </p>
          <p className="lt-soon-text">
            А міжміські поїздки працюють уже зараз: маршрутки, попутки та потяги.
          </p>
          <Link className="lt-soon-cta" to="/mizhgorodski">
            Перейти до міжміських
          </Link>
        </div>
      </div>
    </div>
  );
};
