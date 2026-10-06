import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { FaqAnswerText } from '@/components/FaqAnswerText';
import { usePageSeo } from '@/hooks';
import { TELEGRAM_BOT_URL, TELEGRAM_BOT_USERNAME } from '@/pages/SupportPage/supportContent';
import type { Schedule } from '@/types';
import { ROUTES } from '@/utils/constants';
import { weekdaysLabel } from '@/utils/weekdays';
import { corridorPath } from './corridorLandings';
import { PhoneOnlyNotice } from './PhoneOnlyNotice';
import { ZUBASTYK_MAIN_PHONE, zubastykTelHref } from './phoneOnlyBooking';
import {
  ZUBASTYK_BOARDING,
  ZUBASTYK_CANONICAL,
  ZUBASTYK_PHONES,
  buildZubastykFaq,
  scheduleRange,
} from './zubastykContent';
import './CorridorLandingPage.css';

type Direction = { key: 'toKyiv' | 'toMalyn'; from: string; to: string; label: string; searchHref: string };

const DIRECTIONS: Direction[] = [
  { key: 'toKyiv', from: 'Malyn', to: 'Kyiv', label: 'Малин → Київ', searchHref: '/mizhgorodski?from=Malyn&to=Kyiv&type=bus' },
  { key: 'toMalyn', from: 'Kyiv', to: 'Malyn', label: 'Київ → Малин', searchHref: '/mizhgorodski?from=Kyiv&to=Malyn&type=bus' },
];

const sortRows = (rows: Schedule[]) =>
  rows
    .filter((s) => (s.vehicleType ?? 'marshrutka') !== 'elektrichka')
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime) || a.route.localeCompare(b.route));

/** Онлайн-бронювання «Зубастика» поки не працює — дія в рядку розкладу = дзвінок. */
function ScheduleTable({ rows }: { rows: Schedule[] }) {
  return (
    <div className="corridor-table-wrap">
      <table className="corridor-table">
        <thead>
          <tr>
            <th scope="col">Відправлення</th>
            <th scope="col">Маршрут</th>
            <th scope="col">Дні</th>
            <th scope="col">Посадка</th>
            <th scope="col">Ціна</th>
            <th scope="col">
              <span className="visually-hidden">Дія</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={`${s.route}-${s.departureTime}-${s.id}`}>
              <td>
                <strong>{s.departureTime}</strong>
              </td>
              <td>{ROUTES[s.route] ?? s.tripRoute?.labelUk ?? '—'}</td>
              <td>{weekdaysLabel(s.activeWeekdays)}</td>
              <td>{s.boardingPlace || <span className="corridor-muted">—</span>}</td>
              <td>{s.priceUah != null ? <strong>{s.priceUah} грн</strong> : <span className="corridor-muted">—</span>}</td>
              <td>
                <a className="corridor-table-book" href={zubastykTelHref()}>
                  Подзвонити
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ZubastykPage() {
  const [rows, setRows] = useState<Record<Direction['key'], Schedule[]>>({ toKyiv: [], toMalyn: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all(
      DIRECTIONS.map((d) =>
        apiClient.getSchedules(undefined, { fromCode: d.from, toCode: d.to, vehicleType: 'marshrutka' }).then(sortRows)
      )
    )
      .then(([toKyiv, toMalyn]) => {
        if (!cancelled) setRows({ toKyiv, toMalyn });
      })
      .catch(() => {
        if (!cancelled) setError('Не вдалося завантажити розклад. Спробуйте пошук на головній.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const faq = useMemo(() => buildZubastykFaq(rows.toKyiv, rows.toMalyn), [rows]);
  const rangeToKyiv = scheduleRange(rows.toKyiv);

  const jsonLd = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Міжміські', item: 'https://malin.kiev.ua/mizhgorodski' },
            { '@type': 'ListItem', position: 2, name: 'Маршрутка «Зубастик» Малин — Київ', item: ZUBASTYK_CANONICAL },
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
        ...DIRECTIONS.filter((d) => rows[d.key].length).map((d) => ({
          '@type': 'ItemList',
          name: `Розклад маршруток ${d.label} («Зубастик»)`,
          numberOfItems: rows[d.key].length,
          itemListElement: rows[d.key].map((s, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: `${s.departureTime} · ${ROUTES[s.route] ?? s.tripRoute?.labelUk ?? d.label} · ${weekdaysLabel(s.activeWeekdays)}${s.priceUah != null ? ` · ${s.priceUah} грн` : ''}`,
          })),
        })),
      ],
    }),
    [faq, rows]
  );

  usePageSeo({
    title: 'Зубастик Малин — Київ: розклад маршруток і номер телефону | malin.kiev.ua',
    canonicalUrl: ZUBASTYK_CANONICAL,
    description: `Маршрутка «Зубастик» Малин — Київ: телефони бронювання ${ZUBASTYK_PHONES.slice(0, 3)
      .map((p) => p.label)
      .join(', ')}${rangeToKyiv ? `, рейси з ${rangeToKyiv.first} до ${rangeToKyiv.last}` : ''}, посадка на Академмістечку та Святошині. Онлайн-бронювання поки не працює — лише за телефоном.`,
    jsonLdId: 'zubastyk-jsonld',
    jsonLd,
  });

  return (
    <div className="corridor-page">
      <article className="corridor-article">
        <nav className="corridor-crumbs" aria-label="Навігація">
          <Link to="/mizhgorodski">Міжміські</Link>
          <span aria-hidden="true"> / </span>
          <span>Маршрутка «Зубастик»</span>
        </nav>

        <header className="corridor-hero">
          <h1>Маршрутка «Зубастик» Малин — Київ: розклад і телефони для бронювання</h1>
          <p className="corridor-lead">
            «Зубастик» — так у Малині досі називають маршрутки Малин — Київ до метро «Академмістечко» та «Святошин».
            Тут актуальний розклад цих рейсів в обох напрямках і телефони для бронювання.
          </p>
          <PhoneOnlyNotice />
          <div className="corridor-cta-row">
            <a className="corridor-cta corridor-cta--primary" href={zubastykTelHref()}>
              Подзвонити {ZUBASTYK_MAIN_PHONE.label}
            </a>
            <Link className="corridor-cta corridor-cta--ghost" to={DIRECTIONS[0].searchHref}>
              Рейси Малин → Київ
            </Link>
            <Link className="corridor-cta corridor-cta--ghost" to={DIRECTIONS[1].searchHref}>
              Київ → Малин
            </Link>
            <a className="corridor-cta corridor-cta--ghost" href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
              Бот @{TELEGRAM_BOT_USERNAME}
            </a>
          </div>
        </header>

        <section className="corridor-section" aria-labelledby="zubastyk-phones">
          <h2 id="zubastyk-phones">Номери телефону для бронювання</h2>
          <ul className="corridor-ways">
            {ZUBASTYK_PHONES.map((p) => (
              <li key={p.digits}>
                <a href={`tel:+${p.digits}`}>
                  <strong>{p.label}</strong>
                </a>
                {p.note ? <span className="corridor-muted"> — {p.note}</span> : null}
              </li>
            ))}
          </ul>
          <p className="corridor-muted">
            Онлайн-бронювання поки не працює — місце на конкретний рейс бронюється <strong>лише за телефоном</strong>.
            Назвіть дату, час відправлення й кількість місць. Розклад рейсів — нижче і в{' '}
            <Link to="/mizhgorodski">пошуку на malin.kiev.ua</Link>.
          </p>
        </section>

        {DIRECTIONS.map((d) => (
          <section key={d.key} className="corridor-section" aria-labelledby={`zubastyk-${d.key}`}>
            <h2 id={`zubastyk-${d.key}`}>Розклад {d.label}</h2>
            {loading && <p className="corridor-muted">Завантаження розкладу…</p>}
            {error && <p className="corridor-error">{error}</p>}
            {!loading && !error && rows[d.key].length === 0 && (
              <p className="corridor-muted">
                Рейсів у базі поки немає — перевірте <Link to={d.searchHref}>пошук маршруток</Link>.
              </p>
            )}
            {rows[d.key].length > 0 && <ScheduleTable rows={rows[d.key]} />}
          </section>
        ))}

        <section className="corridor-section" aria-labelledby="zubastyk-board">
          <h2 id="zubastyk-board">Посадка й час у дорозі</h2>
          <p>{ZUBASTYK_BOARDING.kyiv}</p>
          <p>
            Місце посадки біля «Академмістечка»:{' '}
            <a href={ZUBASTYK_BOARDING.akademMap} target="_blank" rel="noopener noreferrer">
              на карті
            </a>
            {' · '}
            <a href={ZUBASTYK_BOARDING.akademStreetView} target="_blank" rel="noopener noreferrer">
              подивитися на Street View
            </a>
            .
          </p>
          <p>{ZUBASTYK_BOARDING.malyn}</p>
          <p className="corridor-muted">{ZUBASTYK_BOARDING.travelTime}</p>
        </section>

        <section className="corridor-section" aria-labelledby="zubastyk-faq">
          <h2 id="zubastyk-faq">Часті питання</h2>
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

        <section className="corridor-section" aria-labelledby="zubastyk-more">
          <h2 id="zubastyk-more">Сторінки напрямків</h2>
          <ul className="corridor-dir-list">
            <li>
              <Link to={corridorPath('malyn-kyiv')}>Малин → Київ: попутки та маршрутки</Link>
            </li>
            <li>
              <Link to={corridorPath('kyiv-malyn')}>Київ → Малин: попутки та маршрутки</Link>
            </li>
          </ul>
          <p className="corridor-muted">
            Ціни та порівняння з автобусами й електричкою — <Link to="/support/prices">Скільки коштує Малин — Київ</Link>.
            Міський транспорт Малина — <Link to="/transport">/transport</Link>.
          </p>
        </section>
      </article>
    </div>
  );
}
