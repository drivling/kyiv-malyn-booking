import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Combobox } from '@/components/Combobox';
import { usePageSeo } from '@/hooks';
import type { TransportData } from './types';
import { buildRoutesFromData, buildStopDepartures, formatMinsClock } from './stopDepartures';
import { buildSortedStopIds, displayNameForStopKey, getStopsCatalog, resolveStopIdInList } from './stopCatalog';
import { LocalTransportSubNav } from './LocalTransportSubNav';
import { isVerifiedRoute } from './routeTiming';
import { useTransportDataset } from '../TransportPage/useTransportDataset';
import { datasetToLocalViewModel } from '../TransportPage/datasetAdapter';
import { configureSegmentDurations } from './segmentDurations';
import { getStopArticle, stopArticlePlainText } from '@/content/stops';
import { RouteMap } from './RouteMap';
import './LocalTransportPage.css';

const STOP_BOARD_HUB_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Як подивитися розклад з зупинки в Малині?',
    a: 'Відкрийте malin.kiev.ua/transport/stop, оберіть зупинку — побачите наступні відправлення всіх маршрутів. Або перейдіть за прямим посиланням /transport/stop/st_…',
  },
  {
    q: 'Чим табло відрізняється від планера З → До?',
    a: 'Табло показує всі рейси з однієї зупинки. Планер /transport шукає прямі маршрути між двома зупинками.',
  },
];

function formatDateUrl(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = String(date.getFullYear()).slice(-2);
  return `${d.toString().padStart(2, '0')}.${m.toString().padStart(2, '0')}.${y}`;
}

function parseDateUrl(s: string): Date | null {
  const m = s?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const [, day, month, year] = m;
  const y = year.length === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
  const d = new Date(y, parseInt(month, 10) - 1, parseInt(day, 10));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Браузерний `<input type="time">`: HH:mm:ss; Safari/локалі — крапка замість двокрапки; Unicode.
 * Для стану й URL завжди `HH:mm`.
 */
function normalizeTimeInput(s: string): string {
  if (!s?.trim()) return '';
  let x = s.trim();
  x = x.replace(/[\u200B-\u200D\uFEFF]/g, '');
  x = x.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  x = x.replace(/\s/g, '');
  let m = x.match(/^(\d{1,2})[\u003A\uFF1A\uFE55\uFF0E\.](\d{2})(?::\d{2})?/);
  if (!m && /^\d{4}$/.test(x)) {
    m = [x, x.slice(0, 2), x.slice(2)] as unknown as RegExpMatchArray;
  }
  if (!m) return '';
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

/** Хвилини з опівночі (опорний час для табло). */
function parseClockToMins(s: string): number {
  const t = normalizeTimeInput(s);
  if (t) {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length <= 4) {
    const pad = digits.length === 3 ? `0${digits}` : digits;
    const h = Math.min(23, parseInt(pad.slice(0, 2), 10));
    const min = Math.min(59, parseInt(pad.slice(2), 10));
    if (!Number.isNaN(h) && !Number.isNaN(min)) return h * 60 + min;
  }
  return 0;
}

/** Поточний час у Києві (хвилини від півночі) — як у LocalTransportPage */
function getKyivMinutesNow(): number {
  const str = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function getKyivCalendarDate(): { d: number; m: number; y: number } {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  return { d, m: mo, y };
}

/** Час відправлення зі зупинки в хвилинах від півночі (цілі хв — дроби лише в сирих даних). */
function roundedDepartureMins(mins: number): number {
  return Math.round(mins);
}

/**
 * Скільки календарних днів між обраною датою поїздки (поле «Дата») і сьогодні за Києвом.
 * 0 — сьогодні, 1 — завтра, -1 — вчора; null — некоректний формат.
 */
function searchDateKyivOffsetDays(searchDateStr: string): number | null {
  const m = searchDateStr?.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const k = getKyivCalendarDate();
  const msSearch = Date.UTC(year, month - 1, day, 12, 0, 0);
  const msKyiv = Date.UTC(k.y, k.m - 1, k.d, 12, 0, 0);
  return Math.round((msSearch - msKyiv) / 86400000);
}

export const LocalTransportStopBoardPage: React.FC = () => {
  const { stopSlug } = useParams<{ stopSlug?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { dataset, loading, error } = useTransportDataset();
  const viewModel = useMemo(
    () => (dataset ? datasetToLocalViewModel(dataset) : null),
    [dataset]
  );
  const data: TransportData | null = viewModel?.data ?? null;

  useEffect(() => {
    if (!viewModel) return;
    configureSegmentDurations(viewModel.segmentDurations, viewModel.defaultSec);
  }, [viewModel]);

  const dParam = searchParams.get('d') ?? '';
  const hParam = searchParams.get('h') ?? '';

  const [searchDate, setSearchDate] = useState(() => dParam || formatDateUrl(new Date()));
  const [searchTime, setSearchTime] = useState(() => {
    const fromUrl = hParam ? normalizeTimeInput(hParam) : '';
    if (fromUrl) return fromUrl;
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });

  const [selectedStop, setSelectedStop] = useState('');
  /** Показати повний день замість «з обраного часу» */
  const [showFullDay, setShowFullDay] = useState(false);
  /** Оновлення «через N хв» раз на хвилину (київський час) */
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const kyivNowMins = useMemo(() => getKyivMinutesNow(), [nowTick]);

  useEffect(() => {
    if (dParam) setSearchDate(dParam);
  }, [dParam]);

  useEffect(() => {
    if (!hParam) return;
    const n = normalizeTimeInput(hParam);
    if (n) setSearchTime(n);
  }, [hParam]);

  const routes = useMemo(() => (data ? buildRoutesFromData(data) : []), [data]);
  const stopsByRoute = data?.supplement?.stops?.stops_by_route;
  const stopsCatalog = useMemo(() => getStopsCatalog(data), [data]);
  const stops = useMemo(
    () => buildSortedStopIds(routes, stopsByRoute, stopsCatalog),
    [routes, stopsByRoute, stopsCatalog]
  );

  const decodedSlug = stopSlug ? decodeURIComponent(stopSlug) : '';
  const matchedStopId = useMemo(() => {
    if (!decodedSlug || !stops.length) return '';
    const id = resolveStopIdInList(decodedSlug, stops, stopsCatalog);
    return id && stops.includes(id) ? id : '';
  }, [decodedSlug, stops, stopsCatalog]);

  useEffect(() => {
    if (matchedStopId) setSelectedStop(matchedStopId);
  }, [matchedStopId]);

  useEffect(() => {
    setShowFullDay(false);
  }, [matchedStopId]);

  const referenceMins = useMemo(() => parseClockToMins(searchTime), [searchTime]);

  /** Зсув обраної дати поїздки від «сьогодні» за календарем Києва (для відліку та текстів). */
  const travelDayOffsetDays = useMemo(() => searchDateKyivOffsetDays(searchDate), [searchDate]);

  /**
   * Лише для **день поїздки = сьогодні (Київ)** і не «весь день»: база = max(зараз у Києві, орієнтовний час).
   * Для майбутнього дня відлік = зміщення по датах + час відправлення − зараз у Києві.
   */
  const countdownBaselineMins = useMemo(() => {
    if (travelDayOffsetDays !== 0 || showFullDay) return kyivNowMins;
    return Math.max(kyivNowMins, referenceMins);
  }, [travelDayOffsetDays, showFullDay, kyivNowMins, referenceMins]);

  const showDepartureCountdown = travelDayOffsetDays !== null && travelDayOffsetDays >= 0;

  const departures = useMemo(() => {
    if (!selectedStop || !stopsByRoute) return [];
    return buildStopDepartures(selectedStop, routes, stopsByRoute, stopsCatalog);
  }, [selectedStop, routes, stopsByRoute, stopsCatalog]);

  const selectedStopTitle = useMemo(
    () => (selectedStop ? displayNameForStopKey(selectedStop, stopsCatalog) : ''),
    [selectedStop, stopsCatalog]
  );

  const stopArticle = useMemo(() => getStopArticle(selectedStop), [selectedStop]);

  const stopSeo = useMemo(() => {
    if (selectedStop && selectedStopTitle) {
      const routeIds = [
        ...new Set(departures.map((d) => d.routeId)),
      ].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
      const sample = departures
        .slice()
        .sort((a, b) => a.departureMins - b.departureMins)
        .slice(0, 8)
        .map((d) => `${formatMinsClock(Math.round(d.departureMins))} №${d.routeId}`);
      const faq = [
        {
          q: `Які маршрутки зупиняються на «${selectedStopTitle}»?`,
          a: routeIds.length
            ? `На зупинці «${selectedStopTitle}» у Малині: ${routeIds.map((r) => `№${r}`).join(', ')}. Табло: malin.kiev.ua/transport/stop/${selectedStop}.`
            : `Відкрийте табло зупинки «${selectedStopTitle}» на malin.kiev.ua/transport/stop/${selectedStop}.`,
        },
        {
          q: `О котрій найближчі рейси з «${selectedStopTitle}»?`,
          a: sample.length
            ? `Приклади з розкладу: ${sample.join('; ')}. Повний список — на сторінці табло.`
            : 'Оберіть дату й час на сторінці табло, щоб побачити відправлення.',
        },
        ...STOP_BOARD_HUB_FAQ.slice(1),
      ];
      const description = stopArticle
        ? stopArticlePlainText(stopArticle)
        : `Табло зупинки «${selectedStopTitle}» у Малині${
            routeIds.length ? `: маршрути ${routeIds.map((r) => `№${r}`).join(', ')}` : ''
          }. Наступні відправлення міського транспорту.`;
      return {
        title: `Зупинка «${selectedStopTitle}» — розклад маршруток Малина | malin.kiev.ua`,
        canonicalUrl: `https://malin.kiev.ua/transport/stop/${encodeURIComponent(selectedStop)}`,
        description,
        jsonLdId: `transport-stop-jsonld-${selectedStop}`,
        jsonLd: {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                {
                  '@type': 'ListItem',
                  position: 1,
                  name: 'Транспорт Малина',
                  item: 'https://malin.kiev.ua/transport',
                },
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: selectedStopTitle,
                  item: `https://malin.kiev.ua/transport/stop/${encodeURIComponent(selectedStop)}`,
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
            ...(departures.length
              ? [
                  {
                    '@type': 'ItemList',
                    name: `Відправлення зі зупинки ${selectedStopTitle}`,
                    numberOfItems: Math.min(departures.length, 40),
                    itemListElement: departures
                      .slice()
                      .sort((a, b) => a.departureMins - b.departureMins)
                      .slice(0, 40)
                      .map((d, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        name: `${formatMinsClock(Math.round(d.departureMins))} · №${d.routeId} → ${d.destination}`,
                      })),
                  },
                ]
              : []),
          ],
        },
      };
    }

    return {
      title: 'Табло зупинок Малина — розклад відправлень | malin.kiev.ua',
      canonicalUrl: 'https://malin.kiev.ua/transport/stop',
      description:
        'Розклад з будь-якої зупинки міського транспорту Малина: наступні маршрутки в усіх напрямках. Оберіть зупинку на malin.kiev.ua/transport/stop.',
      jsonLdId: 'transport-stop-hub-jsonld',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: STOP_BOARD_HUB_FAQ.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    };
  }, [selectedStop, selectedStopTitle, departures, stopArticle]);

  usePageSeo(stopSeo);

  /** За замовчуванням — лише рейси з обраного часу або пізніше (як «наступні відправлення»). */
  const visibleDepartures = useMemo(() => {
    if (!departures.length || showFullDay) return departures;
    return departures.filter((r) => roundedDepartureMins(r.departureMins) >= referenceMins);
  }, [departures, showFullDay, referenceMins]);

  /** Підсвітка: у режимі «з часу» — перший рядок; у «весь день» — перший ≥ часу. */
  const highlightIndex = useMemo(() => {
    if (!visibleDepartures.length) return -1;
    if (!showFullDay) return 0;
    const idx = visibleDepartures.findIndex((r) => roundedDepartureMins(r.departureMins) >= referenceMins);
    return idx >= 0 ? idx : -1;
  }, [visibleDepartures, showFullDay, referenceMins]);

  const syncUrl = (stop: string, date: string, time: string) => {
    const params = new URLSearchParams();
    if (date) params.set('d', date.trim());
    const hNorm = normalizeTimeInput(time);
    if (hNorm) params.set('h', hNorm);
    const search = params.toString() ? `?${params.toString()}` : '';
    const pathname = stop ? `/transport/stop/${encodeURIComponent(stop)}` : '/transport/stop';
    navigate({ pathname, search }, { replace: true });
  };

  const handleStopChange = (v: string) => {
    setSelectedStop(v);
    setShowFullDay(false);
    const t = normalizeTimeInput(searchTime);
    setSearchTime(t);
    syncUrl(v, searchDate, t);
  };

  const handleDateTimeApply = () => {
    setShowFullDay(false);
    const d = searchDate.trim();
    const t = normalizeTimeInput(searchTime);
    setSearchDate(d);
    setSearchTime(t || searchTime);
    if (selectedStop) syncUrl(selectedStop, d, t);
    else {
      const params = new URLSearchParams();
      if (d) params.set('d', d);
      if (t) params.set('h', t);
      const search = params.toString() ? `?${params.toString()}` : '';
      navigate({ pathname: '/transport/stop', search }, { replace: true });
    }
  };

  const mapCoordsData = viewModel
    ? { center: viewModel.coords.center, stops: viewModel.coords.stops }
    : null;

  const fare = data?.supplement?.fare ? `${data.supplement.fare.amount} грн` : null;

  if (loading) {
    return (
      <div className="lt-page lt-theme-jakdojade lt-layout-dark">
        <div className="lt-container">
          <p className="lt-loading">Завантаження...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="lt-page lt-theme-jakdojade lt-layout-dark">
        <div className="lt-container">
          <div className="lt-error">
            <p>{error || 'Дані не завантажені'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lt-page lt-theme-jakdojade lt-layout-dark lt-page--stop-board">
      <div className="lt-container lt-split-layout">
        <div className="lt-panel">
          <header className="lt-header lt-header--jakdojade">
            <h1 className="lt-title">
              {selectedStopTitle ? `Зупинка «${selectedStopTitle}»` : 'Табло зупинок'}
            </h1>
            <p className="lt-subtitle">
              {selectedStopTitle ? 'Малин · розклад відправлень' : 'Малин · місцевий транспорт'}
            </p>
          </header>

          <LocalTransportSubNav searchDate={searchDate} searchTime={searchTime} />

          <section className="lt-stop-board-intro lt-stop-board-intro--jd" aria-labelledby="lt-stop-board-h">
            <h2 id="lt-stop-board-h" className="lt-section-title lt-stop-board-title lt-stop-board-title--jd">
              Розклад з зупинки
            </h2>
            <p className="lt-stop-board-lead">
              Наступні відправлення в усіх напрямках. Якщо дата збігається з сьогоднішньою (Київ), зліва — зворотний
              відлік «через скільки хвилин» до відправлення. Натисніть картку, щоб відкрити маршрут.
            </p>
          </section>

          <div className="lt-search lt-search--jakdojade lt-stop-board-search">
            <div className="lt-from-to-block">
              <div className="lt-from-to-row lt-stop-board-row">
                <div className="lt-from-to-cell lt-from-to-cell--from" style={{ flex: 1 }}>
                  <label className="lt-from-to-label lt-from-to-label--with-icon">
                    <span className="lt-from-to-dot lt-from-to-dot--from" aria-hidden /> Зупинка
                  </label>
                  <Combobox
                    label=""
                    options={[
                      { value: '', label: '— Оберіть зупинку —' },
                      ...stops.map((s: string) => ({ value: s, label: displayNameForStopKey(s, stopsCatalog) })),
                    ]}
                    value={selectedStop}
                    onChange={handleStopChange}
                    placeholder="Наприклад Малинівка"
                    emptyMessage="Зупинок не знайдено"
                    clearable
                  />
                </div>
              </div>
              <div className="lt-datetime-row">
                <div className="lt-datetime-field">
                  <label className="lt-datetime-label">Дата</label>
                  <input
                    type="text"
                    className="lt-datetime-input"
                    value={searchDate}
                    onChange={(e) => setSearchDate(e.target.value)}
                    placeholder="ДД.ММ.РР"
                    maxLength={8}
                  />
                </div>
                <div className="lt-datetime-field">
                  <label className="lt-datetime-label">Орієнтовний час</label>
                  <input
                    type="time"
                    step={60}
                    className="lt-datetime-input"
                    value={searchTime}
                    onChange={(e) => setSearchTime(normalizeTimeInput(e.target.value))}
                    title="Підказка: список відсортований за часом; перший рейс після цього часу підсвічується"
                  />
                </div>
                <button type="button" className="lt-search-btn" onClick={handleDateTimeApply}>
                  Застосувати
                </button>
              </div>
            </div>
          </div>

          {stopArticle ? (
            <section className="lt-stop-article" aria-labelledby="lt-stop-article-h">
              <h2 id="lt-stop-article-h" className="lt-aeo-title">
                Про зупинку
              </h2>
              {stopArticle.place ? (
                <div className="lt-stop-article-body">
                  <p className="lt-stop-article-p">
                    Зупинка <strong className="lt-stop-article-name">«{stopArticle.name}»</strong> у Малині —{' '}
                    {stopArticle.place}.
                  </p>
                  {stopArticle.routeIds && stopArticle.routeIds.length > 0 ? (
                    <div className="lt-stop-article-routes">
                      <span className="lt-stop-article-routes-label">Маршрути:</span>
                      <ul className="lt-stop-article-route-list">
                        {stopArticle.routeIds.map((r) => (
                          <li key={r}>
                            <Link className="lt-stop-article-route" to={`/transport/route/${encodeURIComponent(r)}`}>
                              №{r}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {stopArticle.coords ? (
                    <p className="lt-stop-article-p lt-stop-article-coords">
                      <span className="lt-stop-article-coords-label">Координати</span>
                      <code className="lt-stop-article-coords-value">
                        {stopArticle.coords[0].toFixed(5)}, {stopArticle.coords[1].toFixed(5)}
                      </code>
                      <a
                        className="lt-stop-article-coords-map"
                        href={`https://www.openstreetmap.org/?mlat=${stopArticle.coords[0]}&mlon=${stopArticle.coords[1]}#map=17/${stopArticle.coords[0]}/${stopArticle.coords[1]}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        на карті
                      </a>
                    </p>
                  ) : null}
                </div>
              ) : stopArticle.lead ? (
                <p className="lt-stop-article-lead">{stopArticle.lead}</p>
              ) : null}
              {stopArticle.tips && stopArticle.tips.length > 0 ? (
                <ul className="lt-stop-article-tips">
                  {stopArticle.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              ) : null}
              <aside className="lt-stop-article-howto" aria-label="Як користуватися">
                <p>
                  Розклад — у картках нижче. Маршрут до іншої зупинки — у{' '}
                  <Link to={selectedStop ? `/transport?from=${encodeURIComponent(selectedStop)}` : '/transport'}>
                    планері «З → До»
                  </Link>
                  .
                </p>
              </aside>
            </section>
          ) : null}

          {!selectedStop ? (
            <p className="lt-empty lt-stop-board-empty">Оберіть зупинку, щоб побачити розклад відправлень.</p>
          ) : departures.length === 0 ? (
            <p className="lt-empty">Для цієї зупинки немає розкладу в даних.</p>
          ) : visibleDepartures.length === 0 && !showFullDay ? (
            <section className="lt-stop-board" aria-labelledby="lt-stop-board-table-h">
              <div className="lt-stop-board-meta">
                <h3 id="lt-stop-board-table-h" className="lt-stop-board-table-title">
                  {selectedStopTitle}
                </h3>
                {parseDateUrl(searchDate) && (
                  <span className="lt-stop-board-date">
                    {searchDate}
                    {fare && <span className="lt-stop-board-fare"> · Проїзд {fare}</span>}
                  </span>
                )}
              </div>
              <p className="lt-empty">
                Після {searchTime} на цій зупинці в розкладі немає відправлень.
              </p>
              <button type="button" className="lt-stop-board-show-all-btn" onClick={() => setShowFullDay(true)}>
                Показати весь день
              </button>
            </section>
          ) : (
            <section className="lt-stop-board" aria-labelledby="lt-stop-board-table-h">
              <div className="lt-stop-board-meta">
                <h3 id="lt-stop-board-table-h" className="lt-stop-board-table-title">
                  {selectedStopTitle}
                </h3>
                {parseDateUrl(searchDate) && (
                  <span className="lt-stop-board-date">
                    {searchDate}
                    {fare && <span className="lt-stop-board-fare"> · Проїзд {fare}</span>}
                  </span>
                )}
              </div>
              <div className="lt-stop-board-toolbar">
                <label className="lt-stop-board-checkbox">
                  <input
                    type="checkbox"
                    checked={showFullDay}
                    onChange={(e) => setShowFullDay(e.target.checked)}
                  />
                  <span>Показати весь день (усі відправлення з 00:00)</span>
                </label>
              </div>
              <p className="lt-stop-board-hint">
                {showFullDay
                  ? `Повний день. Орієнтовний час ${searchTime} — найближчий рейс після нього виділено.`
                  : `Лише рейси з ${searchTime} або пізніше. Дата поїздки — з поля «Дата» (порівняння з календарем Києва). Якщо це сьогодні — «через … хв» від пізнішого з: зараз у Києві та орієнтовного часу (узгоджено з фільтром). Якщо майбутній день — відлік до обраної дати та часу відправлення від поточного часу в Києві.`}
              </p>
              <div className="lt-jd-cards" role="list">
                {visibleDepartures.map((row, i) => {
                  const isNext = highlightIndex >= 0 && i === highlightIndex;
                  const depMins = roundedDepartureMins(row.departureMins);
                  const depClock = formatMinsClock(depMins);
                  const qs = new URLSearchParams();
                  qs.set('stop', selectedStop);
                  qs.set('dir', row.direction);
                  qs.set('time', depClock);
                  if (searchDate) qs.set('d', searchDate);
                  qs.set('h', depClock);
                  const toRoute = `/transport/route/${row.routeId}?${qs.toString()}`;
                  let deltaMins = 0;
                  if (travelDayOffsetDays === 0) {
                    deltaMins = depMins - countdownBaselineMins;
                    if (deltaMins < 0 && countdownBaselineMins >= 22 * 60 && depMins < 4 * 60) {
                      deltaMins += 24 * 60;
                    }
                  } else if (travelDayOffsetDays !== null && travelDayOffsetDays > 0) {
                    deltaMins = travelDayOffsetDays * 24 * 60 + depMins - kyivNowMins;
                  }
                  const aria = `Маршрут ${row.routeId}, відправлення ${depClock}, ${row.destination}`;
                  const waitHours = deltaMins >= 60 ? Math.floor(deltaMins / 60) : 0;
                  const waitMinsRem = deltaMins >= 60 ? deltaMins % 60 : deltaMins;
                  return (
                    <Link
                      key={`${row.tripId}-${depMins}-${i}`}
                      className={`lt-jd-card ${isNext ? 'lt-jd-card--next' : ''}`}
                      to={toRoute}
                      role="listitem"
                      aria-label={aria}
                    >
                      <div className="lt-jd-card__countdown" aria-hidden>
                        {showDepartureCountdown ? (
                          deltaMins > 0 ? (
                            <>
                              <span className="lt-jd-card__countdown-label">Відправлення через</span>
                              <div
                                className={`lt-jd-card__countdown-big ${deltaMins >= 60 ? 'lt-jd-card__countdown-big--hm' : ''}`}
                              >
                                {deltaMins < 60 ? (
                                  <>
                                    <span className="lt-jd-card__countdown-num">{deltaMins}</span>
                                    <span className="lt-jd-card__countdown-unit">хв</span>
                                  </>
                                ) : (
                                  <span className="lt-jd-card__countdown-hm">
                                    {waitHours}
                                    <span className="lt-jd-card__countdown-hm-suffix"> год</span>
                                    {waitMinsRem > 0 ? (
                                      <>
                                        {' '}
                                        {waitMinsRem}
                                        <span className="lt-jd-card__countdown-hm-suffix"> хв</span>
                                      </>
                                    ) : null}
                                  </span>
                                )}
                              </div>
                              {deltaMins >= 60 ? (
                                <span className="lt-jd-card__countdown-at">о {depClock}</span>
                              ) : null}
                            </>
                          ) : deltaMins === 0 ? (
                            <span className="lt-jd-card__countdown-now">Зараз</span>
                          ) : (
                            <span className="lt-jd-card__countdown-past">Вже минуло</span>
                          )
                        ) : (
                          <>
                            <span className="lt-jd-card__countdown-label">Відправлення о</span>
                            <div className="lt-jd-card__countdown-big lt-jd-card__countdown-big--static">
                              <span className="lt-jd-card__countdown-time">{depClock}</span>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="lt-jd-card__body">
                        <div className="lt-jd-card__route-row">
                          <span
                            className={`lt-jd-card__route-num ${isVerifiedRoute(row.routeId) ? 'lt-jd-card__route-num--verified' : ''}`}
                          >
                            №{row.routeId}
                          </span>
                          <span className="lt-jd-card__route-arrow" aria-hidden>
                            →
                          </span>
                          <span className="lt-jd-card__destination">{row.destination}</span>
                        </div>
                        <div className="lt-jd-card__time-line">
                          <span className="lt-jd-card__pill lt-jd-card__pill--dep">{depClock}</span>
                          <span className="lt-jd-card__pill-hint">відправлення з зупинки</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="lt-aeo" aria-labelledby="lt-stop-aeo-faq">
            <h2 id="lt-stop-aeo-faq" className="lt-aeo-title">
              Часті питання
            </h2>
            <dl className="lt-aeo-faq">
              {(selectedStopTitle
                ? [
                    {
                      q: `Які маршрутки зупиняються на «${selectedStopTitle}»?`,
                      a: (() => {
                        const ids = [...new Set(departures.map((d) => d.routeId))];
                        return ids.length
                          ? `Маршрути: ${ids.map((r) => `№${r}`).join(', ')}. Картки вище — час відправлення зі зупинки.`
                          : 'Оберіть зупинку з розкладом у даних.';
                      })(),
                    },
                    STOP_BOARD_HUB_FAQ[1],
                  ]
                : STOP_BOARD_HUB_FAQ
              ).map((item) => (
                <div key={item.q} className="lt-aeo-faq__item">
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
            <p className="lt-aeo-more">
              Планер <Link to="/transport">З → До</Link>
              {selectedStop ? (
                <>
                  {' · '}
                  <Link to={`/transport?from=${encodeURIComponent(selectedStop)}`}>
                    Звідси в планер
                  </Link>
                </>
              ) : null}
              {' · '}
              <Link to="/mizhgorodski">Міжміські</Link>
            </p>
          </section>

          <footer className="lt-footer">
            <a
              href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36"
              target="_blank"
              rel="noopener noreferrer"
            >
              data.gov.ua
            </a>
            {' · '}
            <a href="tel:+380687771590">(068) 77-71-590</a>
          </footer>
        </div>
        <div className="lt-map-column">
          <RouteMap
            routeId=""
            stopNames={selectedStop ? [selectedStop] : []}
            fromStopName={selectedStop || undefined}
            dark
            hideRadialPicker
            coordsData={mapCoordsData}
            resolveStopLabel={(k) => displayNameForStopKey(k, stopsCatalog)}
          />
        </div>
      </div>
    </div>
  );
};
