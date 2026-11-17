import type { TransportProfile } from '@/site/transportCity';

/**
 * Підвал сторінок транспорту (хаб, маршрут, табло, схема): у Малина — набір data.gov.ua і телефон, в іншого міста —
 * джерела його даних (розклад ради, OpenStreetMap; site-hosts.mjs `transportSources`, фаза 11.1)
 */
export function TransportFooter({ profile }: { profile: TransportProfile }) {
  if (profile.hasOpenData) {
    return (
      <footer className="lt-footer">
        <a href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36" target="_blank" rel="noopener noreferrer">
          data.gov.ua
        </a>
        {' · '}
        <a href="tel:+380687771590">(068) 77-71-590</a>
      </footer>
    );
  }
  if (!profile.sourceLinks.length) return <footer className="lt-footer" />;
  return (
    <footer className="lt-footer">
      {profile.sourceLinks.map((link, i) => (
        <span key={link.href}>
          {i > 0 ? ' · ' : null}
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        </span>
      ))}
    </footer>
  );
}
