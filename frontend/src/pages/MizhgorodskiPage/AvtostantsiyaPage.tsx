import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { FaqAnswerText } from '@/components/FaqAnswerText';
import { usePageSeo } from '@/hooks';
import { useTransportDataset } from '@/pages/TransportPage/useTransportDataset';
import type { Schedule } from '@/types';
import { getRouteLabel } from '@/utils/constants';
import { vehicleLabel } from '@/utils/vehicleLabel';
import { weekdaysLabel } from '@/utils/weekdays';
import { corridorPath } from './corridorLandings';
import {
  AVTOSTANTSIYA_CANONICAL,
  AVTOSTANTSIYA_PHONES,
  ZHYTOMYR_AS1,
  arrivalsFromZhytomyr,
  buildAvtostantsiyaFaq,
  cityRoutesAtAutostation,
  groupDepartures,
  type BoardGroup,
} from './avtostantsiyaContent';
import './CorridorLandingPage.css';

const label = (s: Schedule) => s.tripRoute?.labelUk ?? getRouteLabel(s.route);

function BoardTable({ rows, arrivals = false }: { rows: Schedule[]; arrivals?: boolean }) {
  return (
    <div className="corridor-table-wrap">
      <table className="corridor-table">
        <thead>
          <tr>
            <th scope="col">{arrivals ? 'Відправлення з Житомира' : 'Відправлення'}</th>
            <th scope="col">Маршрут</th>
            {arrivals && <th scope="col">Прибуття</th>}
            <th scope="col">Дні</th>
            <th scope="col">Ціна</th>
            <th scope="col">{arrivals ? 'Примітка' : 'Посадка'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={`${s.route}-${s.departureTime}-${s.id}`}>
              <td>
                <strong>{s.departureTime}</strong>
              </td>
              <td>
                {label(s)}
                {vehicleLabel(s) !== 'Маршрутка' ? ` · ${vehicleLabel(s)}` : ''}
              </td>
              {arrivals && <td>{s.arrivalTime ?? <span className="corridor-muted">—</span>}</td>}
              <td>{weekdaysLabel(s.activeWeekdays)}</td>
              <td>{s.priceUah != null ? <strong>{s.priceUah} грн</strong> : <span className="corridor-muted">—</span>}</td>
              <td>{s.boardingPlace ?? <span className="corridor-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AvtostantsiyaPage() {
  const [all, setAll] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getSchedules()
      .then((rows) => {
        if (!cancelled) setAll(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Не вдалося завантажити розклад. Спробуйте пізніше або зателефонуйте в касу.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { dataset } = useTransportDataset();
  const groups: BoardGroup[] = useMemo(() => groupDepartures(all), [all]);
  const arrivals = useMemo(() => arrivalsFromZhytomyr(all), [all]);
  const cityRoutes = useMemo(() => cityRoutesAtAutostation(dataset), [dataset]);
  const faq = useMemo(() => buildAvtostantsiyaFaq(groups, arrivals, cityRoutes), [groups, arrivals, cityRoutes]);
  const totalDepartures = groups.reduce((n, g) => n + g.rows.length, 0);

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BusStation',
          name: 'Автостанція Малин',
          url: AVTOSTANTSIYA_CANONICAL,
          telephone: AVTOSTANTSIYA_PHONES.map((p) => `+${p.digits}`),
          address: { '@type': 'PostalAddress', addressLocality: 'Малин', addressRegion: 'Житомирська область', addressCountry: 'UA' },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Міжміські', item: 'https://malin.kiev.ua/mizhgorodski' },
            { '@type': 'ListItem', position: 2, name: 'Автостанція Малин', item: AVTOSTANTSIYA_CANONICAL },
          ],
        },
        {
          '@type': 'FAQPage',
          mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
        },
        ...groups.map((g) => ({
          '@type': 'ItemList',
          name: `Відправлення з автостанції Малин: ${g.title}`,
          numberOfItems: g.rows.length,
          itemListElement: g.rows.map((s, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: `${s.departureTime} · ${label(s)} · ${weekdaysLabel(s.activeWeekdays)}${s.priceUah != null ? ` · ${s.priceUah} грн` : ''}`,
          })),
        })),
      ],
    }),
    [faq, groups]
  );

  usePageSeo({
    title: 'Автостанція Малин: розклад автобусів, телефони каси, напрямки | malin.kiev.ua',
    canonicalUrl: AVTOSTANTSIYA_CANONICAL,
    description: `Автостанція Малин: телефони каси ${AVTOSTANTSIYA_PHONES.map((p) => p.label).join(', ')}, розклад відправлень на Житомир (через Потіївку та Радомишль), Бердичів, Вінницю, Хмільник, маршрутки на Київ${totalDepartures ? ` — ${totalDepartures} рейсів у базі` : ''}, прибуття з Житомира.`,
    jsonLdId: 'avtostantsiya-jsonld',
    jsonLd,
  });

  return (
    <div className="corridor-page">
      <article className="corridor-article">
        <nav className="corridor-crumbs" aria-label="Навігація">
          <Link to="/mizhgorodski">Міжміські</Link>
          <span aria-hidden="true"> / </span>
          <span>Автостанція Малин</span>
        </nav>

        <header className="corridor-hero">
          <h1>Автостанція Малин: розклад автобусів, телефони, напрямки</h1>
          <p className="corridor-lead">
            Усі відправлення з автостанції Малина в одній таблиці: автобуси на Житомир через Потіївку та Радомишль,
            рейси на Бердичів, Вінницю й Хмільник, маршрутки на Київ до метро. Телефони каси для довідок і бронювання,
            час прибуття автобусів із Житомира. Дані з нашої бази бронювання; графік звіряємо з дошкою автостанції.
          </p>
          <div className="corridor-cta-row">
            <Link className="corridor-cta corridor-cta--primary" to={corridorPath('malyn-zhytomyr')}>
              Малин → Житомир
            </Link>
            <Link className="corridor-cta corridor-cta--ghost" to="/zubastyk">
              Маршрутки на Київ
            </Link>
            <Link className="corridor-cta corridor-cta--ghost" to="/transport">
              Міські маршрутки
            </Link>
          </div>
        </header>

        <section className="corridor-section" aria-labelledby="as-phones">
          <h2 id="as-phones">Телефони каси автостанції Малин</h2>
          <ul className="corridor-ways">
            {AVTOSTANTSIYA_PHONES.map((p) => (
              <li key={p.digits}>
                <a href={`tel:+${p.digits}`}>
                  <strong>{p.label}</strong>
                </a>
              </li>
            ))}
          </ul>
          <p className="corridor-muted">
            Довідки про рух автобусів, попередній продаж квитків і бронювання місць на рейси до Житомира. Маршрутки на Київ
            бронюють за іншими номерами — див. <Link to="/zubastyk">сторінку «Зубастик»</Link>.
          </p>
        </section>

        <section className="corridor-section" aria-labelledby="as-board">
          <h2 id="as-board">Відправлення з автостанції</h2>
          {loading && <p className="corridor-muted">Завантаження розкладу…</p>}
          {error && <p className="corridor-error">{error}</p>}
          {!loading && !error && groups.length === 0 && (
            <p className="corridor-muted">Рейсів у базі поки немає — зателефонуйте в касу.</p>
          )}
          {groups.map((g) => (
            <div key={g.key}>
              <h3>{g.title}</h3>
              <BoardTable rows={g.rows} />
            </div>
          ))}
          {groups.some((g) => g.key === 'zhytomyr') && (
            <p className="corridor-muted">
              «Транзит з Базару» — автобус Базар → Житомир, що проходить через Малин у вказаний час. Через Потіївку —
              коротший шлях, через Радомишль — довший. Ціни на рейси Малин — Житомир уточнюйте в касі; з Житомира до
              Малина — 283–299 грн за табло автовокзалу Житомир-1.
            </p>
          )}
        </section>

        {arrivals.length > 0 && (
          <section className="corridor-section" aria-labelledby="as-arrivals">
            <h2 id="as-arrivals">Прибуття з Житомира</h2>
            <p className="corridor-muted">
              {ZHYTOMYR_AS1.name}, {ZHYTOMYR_AS1.address}. Телефони:{' '}
              {ZHYTOMYR_AS1.phones.map((p, i) => (
                <span key={p.digits}>
                  <a href={`tel:+${p.digits}`}>{p.label}</a> ({p.note}){i < ZHYTOMYR_AS1.phones.length - 1 ? ', ' : ''}
                </span>
              ))}
              .
            </p>
            <BoardTable rows={arrivals} arrivals />
          </section>
        )}

        {cityRoutes.length > 0 && (
          <section className="corridor-section" aria-labelledby="as-city">
            <h2 id="as-city">Як дістатися до автостанції містом</h2>
            <p>
              Автостанція — зупинка міських маршруток «Автостанція» (у зворотний бік — «Автостанція (навпроти)»),
              вул. Винниченка, 61.
            </p>
            <ul className="corridor-ways">
              {cityRoutes.map((r) =>
                r.published ? (
                  <li key={r.id}>
                    <Link to={`/transport/route/${encodeURIComponent(r.id)}`}>
                      <strong>№{r.id}</strong>
                    </Link>
                    {r.line ? ` — ${r.line}` : ''}
                  </li>
                ) : (
                  <li key={r.id}>
                    <strong>№{r.id}</strong> — маршрут готуємо до запуску: час відправлення саме від «Автостанції»
                    ще звіряємо, тому розкладу тут поки немає.
                  </li>
                )
              )}
            </ul>
            {/* Табло зупинки має сенс лише коли через неї ходить опублікований маршрут:
                сторінки зупинок будуються тільки для зупинок з активними маршрутами. */}
            <p className="corridor-muted">
              {cityRoutes.some((r) => r.published) ? (
                <>
                  Табло зупинки: <Link to="/transport/stop/st_0004">«Автостанція»</Link> ·{' '}
                  <Link to="/transport/stop/st_0005">«Автостанція (навпроти)»</Link>. Планер «З → До» —{' '}
                  <Link to="/transport">/transport</Link>.
                </>
              ) : (
                <>
                  Табло зупинки зʼявиться разом із запуском маршруту. Усі міські маршрути й планер «З → До» —{' '}
                  <Link to="/transport">/transport</Link>.
                </>
              )}
            </p>
          </section>
        )}

        <section className="corridor-section" aria-labelledby="as-faq">
          <h2 id="as-faq">Часті питання</h2>
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

        <section className="corridor-section" aria-labelledby="as-more">
          <h2 id="as-more">Сторінки напрямків</h2>
          <ul className="corridor-dir-list">
            <li>
              <Link to={corridorPath('malyn-zhytomyr')}>Малин → Житомир: автобус і попутка</Link>
            </li>
            <li>
              <Link to={corridorPath('zhytomyr-malyn')}>Житомир → Малин: автобус і попутка</Link>
            </li>
            <li>
              <Link to={corridorPath('malyn-kyiv')}>Малин → Київ: маршрутки та попутки</Link>
            </li>
            <li>
              <Link to={corridorPath('malyn-korosten')}>Малин → Коростень: електричка, потяг, попутка</Link>
            </li>
          </ul>
          <p className="corridor-muted">
            Телефони каси взято з довідки автостанції; якщо ви помітили розбіжність у розкладі — напишіть нам у{' '}
            <Link to="/support/contact">контакти</Link>, і ми оновимо базу.
          </p>
        </section>
      </article>
    </div>
  );
}
