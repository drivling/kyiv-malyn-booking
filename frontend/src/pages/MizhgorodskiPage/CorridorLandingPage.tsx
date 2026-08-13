import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { FaqAnswerText } from '@/components/FaqAnswerText';
import { usePageSeo } from '@/hooks';
import { TELEGRAM_BOT_URL, TELEGRAM_BOT_USERNAME } from '@/pages/SupportPage/supportContent';
import type { Schedule } from '@/types';
import {
  ROUTES,
  formatPhoneDisplay,
  splitSupportPhones,
} from '@/utils/constants';
import {
  CORRIDOR_LANDINGS,
  corridorPath,
  corridorSearchHref,
  getCorridorLanding,
  type CorridorLanding,
} from './corridorLandings';
import './CorridorLandingPage.css';

function buildScheduleFaq(
  landing: CorridorLanding,
  schedules: Schedule[]
): Array<{ q: string; a: string }> {
  const times = schedules.map((s) => s.departureTime).sort();
  const first = times[0];
  const last = times[times.length - 1];
  const dynamic: Array<{ q: string; a: string }> = [];

  if (first && last) {
    dynamic.push({
      q: `О котрій перша та остання маршрутка ${landing.fromLabel} — ${landing.toLabel}?`,
      a: `За актуальним розкладом на malin.kiev.ua: перший рейс о ${first}, останній о ${last}. Усього ${schedules.length} відправлень; точний список — у таблиці на цій сторінці.`,
    });
  }

  dynamic.push({
    q: `Де взяти розклад маршруток ${landing.fromLabel} — ${landing.toLabel}?`,
    a: `Офіційний розклад рейсів, якими можна забронювати місце, публікується тут і в пошуку на malin.kiev.ua/mizhgorodski. Графік рідко змінюється; перед поїздкою оберіть дату в пошуку.`,
  });

  return [...dynamic, ...landing.faq];
}

export function CorridorLandingPage() {
  const { corridorSlug } = useParams<{ corridorSlug: string }>();
  const landing = getCorridorLanding(corridorSlug);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(Boolean(landing));
  const [schedulesError, setSchedulesError] = useState('');

  useEffect(() => {
    if (!landing) {
      setSchedules([]);
      setSchedulesLoading(false);
      return;
    }
    let cancelled = false;
    setSchedulesLoading(true);
    setSchedulesError('');
    apiClient
      .getSchedules(undefined, { fromCode: landing.from, toCode: landing.to })
      .then((rows) => {
        if (cancelled) return;
        const merged = rows
          .slice()
          .sort((a, b) => a.departureTime.localeCompare(b.departureTime) || a.route.localeCompare(b.route));
        setSchedules(merged);
      })
      .catch(() => {
        if (!cancelled) setSchedulesError('Не вдалося завантажити розклад. Спробуйте пошук на головній.');
      })
      .finally(() => {
        if (!cancelled) setSchedulesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [landing]);

  const faq = useMemo(
    () => (landing ? buildScheduleFaq(landing, schedules) : []),
    [landing, schedules]
  );

  const searchHref = landing ? corridorSearchHref(landing) : '/mizhgorodski';

  const jsonLd = useMemo(() => {
    if (!landing) return undefined;
    const graph: object[] = [
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
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ];
    if (schedules.length > 0) {
      graph.push({
        '@type': 'ItemList',
        name: `Розклад маршруток ${landing.fromLabel} — ${landing.toLabel}`,
        numberOfItems: schedules.length,
        itemListElement: schedules.map((s, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${s.departureTime} · ${ROUTES[s.route] ?? s.route}${
            s.priceUah != null ? ` · ${s.priceUah} грн` : ''
          }`,
        })),
      });
    }
    return { '@context': 'https://schema.org', '@graph': graph };
  }, [landing, faq, schedules]);

  usePageSeo(
    landing
      ? {
          title: landing.title,
          canonicalUrl: `https://malin.kiev.ua${corridorPath(landing.slug)}`,
          description: schedules.length
            ? `${landing.description} Розклад: ${schedules.length} рейсів, з ${schedules[0].departureTime} до ${schedules[schedules.length - 1].departureTime}.`
            : landing.description,
          jsonLdId: `corridor-jsonld-${landing.slug}`,
          jsonLd,
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
  const busHref = (() => {
    const params = new URLSearchParams();
    params.set('from', landing.from);
    params.set('to', landing.to);
    params.set('type', 'bus');
    return `/mizhgorodski?${params.toString()}`;
  })();

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
            <Link className="corridor-cta corridor-cta--ghost" to={busHref}>
              Лише маршрутки
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

        <section className="corridor-section" aria-labelledby="corridor-schedule">
          <h2 id="corridor-schedule">Розклад маршруток</h2>
          <p className="corridor-muted">
            Фіксований графік з нашої бази бронювання. Змінюється рідко — перед поїздкою оберіть дату в пошуку й
            забронюйте місце.
          </p>
          {schedulesLoading && <p className="corridor-muted">Завантаження розкладу…</p>}
          {schedulesError && <p className="corridor-error">{schedulesError}</p>}
          {!schedulesLoading && !schedulesError && schedules.length === 0 && (
            <p className="corridor-muted">
              Рейсів у базі поки немає. Перевірте{' '}
              <Link to={busHref}>пошук маршруток</Link> або попутки на головній.
            </p>
          )}
          {schedules.length > 0 && (
            <div className="corridor-table-wrap">
              <table className="corridor-table">
                <thead>
                  <tr>
                    <th scope="col">Відправлення</th>
                    <th scope="col">Маршрут</th>
                    <th scope="col">Ціна</th>
                    <th scope="col">Контакт</th>
                    <th scope="col">
                      <span className="visually-hidden">Дія</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={`${s.route}-${s.departureTime}-${s.id}`}>
                      <td>
                        <strong>{s.departureTime}</strong>
                      </td>
                      <td>{ROUTES[s.route] ?? s.route}</td>
                      <td>
                        {s.priceUah != null ? (
                          <strong>{s.priceUah} грн</strong>
                        ) : (
                          <span className="corridor-muted">—</span>
                        )}
                      </td>
                      <td>
                        {s.supportPhone ? (
                          <span className="corridor-phones">
                            {splitSupportPhones(s.supportPhone).map((digits, i, arr) => (
                              <span key={digits}>
                                <a href={`tel:${digits}`}>{formatPhoneDisplay(digits)}</a>
                                {i < arr.length - 1 ? ', ' : ''}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="corridor-muted">—</span>
                        )}
                      </td>
                      <td>
                        <Link className="corridor-table-book" to={busHref}>
                          Забронювати
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="corridor-section" aria-labelledby="corridor-ways">
          <h2 id="corridor-ways">Як доїхати</h2>
          <ul className="corridor-ways">
            {landing.ways.map((w) => (
              <li key={w.title}>
                <strong>{w.title}.</strong> <FaqAnswerText text={w.text} />
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
            {faq.map((item) => (
              <div key={item.q} className="corridor-faq__item">
                <dt>{item.q}</dt>
                <dd>
                  <FaqAnswerText text={item.a} />
                </dd>
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
            <Link to="/support/travel">Як доїхати</Link>
            {' · '}
            <Link to="/support/prices">Скільки коштує</Link>.
          </p>
        </section>
      </article>
    </div>
  );
}
