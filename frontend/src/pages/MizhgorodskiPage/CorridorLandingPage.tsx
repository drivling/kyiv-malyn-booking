import { Link, Navigate, useParams } from 'react-router-dom';
import { usePageSeo } from '@/hooks';
import { TELEGRAM_BOT_URL, TELEGRAM_BOT_USERNAME } from '@/pages/SupportPage/supportContent';
import {
  CORRIDOR_LANDINGS,
  corridorPath,
  corridorSearchHref,
  getCorridorLanding,
} from './corridorLandings';
import './CorridorLandingPage.css';

export function CorridorLandingPage() {
  const { corridorSlug } = useParams<{ corridorSlug: string }>();
  const landing = getCorridorLanding(corridorSlug);

  usePageSeo(
    landing
      ? {
          title: landing.title,
          canonicalUrl: `https://malin.kiev.ua${corridorPath(landing.slug)}`,
          description: landing.description,
          jsonLdId: `corridor-jsonld-${landing.slug}`,
          jsonLd: {
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  {
                    '@type': 'ListItem',
                    position: 1,
                    name: 'Міжміські',
                    item: 'https://malin.kiev.ua/mizhgorodski',
                  },
                  {
                    '@type': 'ListItem',
                    position: 2,
                    name: `${landing.fromLabel} — ${landing.toLabel}`,
                    item: `https://malin.kiev.ua${corridorPath(landing.slug)}`,
                  },
                ],
              },
              {
                '@type': 'FAQPage',
                mainEntity: landing.faq.map((item) => ({
                  '@type': 'Question',
                  name: item.q,
                  acceptedAnswer: { '@type': 'Answer', text: item.a },
                })),
              },
            ],
          },
        }
      : {
          title: 'Напрямок не знайдено | malin.kiev.ua',
          canonicalUrl: 'https://malin.kiev.ua/mizhgorodski',
        }
  );

  if (!landing) {
    return <Navigate to="/mizhgorodski" replace />;
  }

  const reverse = getCorridorLanding(landing.reverseSlug)!;
  const searchHref = corridorSearchHref(landing);

  return (
    <div className="corridor-page">
      <article className="corridor-article">
        <nav className="corridor-crumbs" aria-label="Навігація">
          <Link to="/mizhgorodski">Міжміські</Link>
          <span aria-hidden="true"> / </span>
          <span>
            {landing.fromLabel} — {landing.toLabel}
          </span>
        </nav>

        <header className="corridor-hero">
          <h1>{landing.h1}</h1>
          <p className="corridor-lead">{landing.lead}</p>
          <div className="corridor-cta-row">
            <Link className="corridor-cta corridor-cta--primary" to={searchHref}>
              Шукати зараз {landing.fromLabel} → {landing.toLabel}
            </Link>
            <a
              className="corridor-cta corridor-cta--ghost"
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Бот @{TELEGRAM_BOT_USERNAME}
            </a>
          </div>
        </header>

        <section className="corridor-section" aria-labelledby="corridor-ways">
          <h2 id="corridor-ways">Як доїхати</h2>
          <ul className="corridor-ways">
            {landing.ways.map((w) => (
              <li key={w.title}>
                <strong>{w.title}.</strong> {w.text}
              </li>
            ))}
          </ul>
        </section>

        <section className="corridor-section" aria-labelledby="corridor-board">
          <h2 id="corridor-board">Посадка й час у дорозі</h2>
          <p>{landing.boarding}</p>
          <p className="corridor-muted">{landing.travelTimeHint}</p>
        </section>

        <section className="corridor-section" aria-labelledby="corridor-faq">
          <h2 id="corridor-faq">Часті питання</h2>
          <dl className="corridor-faq">
            {landing.faq.map((item) => (
              <div key={item.q} className="corridor-faq__item">
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="corridor-section" aria-labelledby="corridor-more">
          <h2 id="corridor-more">Інші напрямки</h2>
          <p>
            Зворотний:{' '}
            <Link to={corridorPath(reverse.slug)}>
              {reverse.fromLabel} — {reverse.toLabel}
            </Link>
          </p>
          <ul className="corridor-dir-list">
            {CORRIDOR_LANDINGS.filter((c) => c.slug !== landing.slug).map((c) => (
              <li key={c.slug}>
                <Link to={corridorPath(c.slug)}>
                  {c.fromLabel} → {c.toLabel}
                </Link>
              </li>
            ))}
          </ul>
          <p className="corridor-muted">
            Міський транспорт Малина — <Link to="/transport">/transport</Link>. Довідка —{' '}
            <Link to="/support">/support</Link>.
          </p>
        </section>
      </article>
    </div>
  );
}
