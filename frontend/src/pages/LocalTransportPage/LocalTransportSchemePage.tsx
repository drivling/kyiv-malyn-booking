import { TransportFooter } from './TransportFooter';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { transportProfile, type TransportProfile } from '@/site/transportCity';
import { usePageSeo } from '@/hooks';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { LocalTransportSubNav } from './LocalTransportSubNav';
import { useTransportDataset } from './dataset/useTransportDataset';
import { TransportStatusBar } from './TransportStatusBar';
import { TransportPrefsPanel } from './TransportPrefsPanel';
import { routeScheduleStats } from './schemeStats';
import { routesAtNode, routesAtStop, schemeNodeForStop, stopsOfNode } from './schemeStops';
import { schemeColorVars } from './routeColors';
import { schemeFor, type CityScheme } from './scheme/registry';
import './LocalTransportPage.css';
import './scheme/scheme-svg.css';
import './LocalTransportSchemePage.css';
import { routeNo } from '@/utils/routeNames';
import { formatDataAsOf } from './dataAsOf';
import {
  CHANGES_RSS_URL,
  DATASET_JSON_FILENAME,
  DATASET_JSON_URL,
  GTFS_FEED_URL,
  OPENAPI_URL,
  OPEN_DATA_DOC_URL,
  OPEN_DATA_LICENSE,
  type OpenDataFormat,
} from './openData';

const SITE = 'https://malin.kiev.ua';
const ZOOM_STEPS = [1, 1.5, 2, 3];

/** SEO сторінки схеми Малина — рядки незмінні (статичний пререндер); інше місто — з профілю (schemeSeo) */
const SCHEME_SEO = {
  title: 'Схема маршрутів Малина — міські автобуси №2–12 | malin.kiev.ua',
  canonicalUrl: `${SITE}/transport/scheme`,
  description:
    'Схема міських автобусних маршрутів Малина у стилі метро: 9 ліній, кінцеві та пересадкові зупинки, річка Ірша. Натисніть на лінію — побачите маршрут і розклад, на зупинку — табло відправлень.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Схема маршрутів Малина',
    url: `${SITE}/transport/scheme`,
    inLanguage: 'uk',
    isPartOf: { '@type': 'WebSite', name: 'malin.kiev.ua', url: SITE },
    about: { '@type': 'Thing', name: 'Міський транспорт Малина' },
  },
};

function schemeSeo(profile: TransportProfile, scheme: CityScheme) {
  if (scheme.city === 'Malyn') return SCHEME_SEO;
  const url = `${profile.siteUrl}/transport/scheme`;
  const name = `Схема маршрутів ${profile.nameGenitive}`;
  return {
    title: `${name} — міські автобуси | ${profile.domain}`,
    canonicalUrl: url,
    description: `Схема міських автобусних маршрутів ${profile.nameGenitive} у стилі метро: ${scheme.routes.length} ліній, кінцеві та пересадкові зупинки, рейси іншим шляхом. Натисніть на лінію — побачите маршрут і розклад, на зупинку — табло відправлень.`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name,
      url,
      inLanguage: 'uk',
      isPartOf: { '@type': 'WebSite', name: profile.domain, url: profile.siteUrl },
      about: { '@type': 'Thing', name: `Міський транспорт ${profile.nameGenitive}` },
    },
  };
}

/** Група зупинки/вузла на схемі, якій належить зупинка: за data-stops (усі зупинки вузла), інакше за data-stop. */
function stopGroupFor(root: ParentNode, stopId: string): SVGGraphicsElement | null {
  const groups = Array.from(root.querySelectorAll<SVGGraphicsElement>('.lts-stop'));
  return (
    groups.find((g) => (g.getAttribute('data-stops') || '').split(' ').includes(stopId)) ||
    groups.find((g) => g.getAttribute('data-stop') === stopId) ||
    null
  );
}

/** Найближчий предок із data-route / data-stop (лінії, плашки, зупинки всередині SVG). */
function closestData(target: EventTarget | null, attr: 'route' | 'stop'): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(`[data-${attr}]`);
  return el?.getAttribute(`data-${attr}`) || null;
}

/**
 * «Схема» — третій режим розділу транспорту: інтерактивна схема в стилі метро.
 * SVG згенеровано скриптом Docs/malyn-transit-scheme/build_scheme.py (--site-dir; інше місто — з --city):
 * лінії несуть data-route, зупинки — data-stop; сторінка лише делегує кліки та підсвічує.
 * Обраний маршрут живе в URL (?route=3), щоб на нього можна було дати посилання; ?stop=<id>
 * (з табло) ставить маркер «ви тут» і, поки маршрут не обрано, підсвічує лінії через цю зупинку.
 */
/**
 * Схема міста з реєстру (scheme/registry.ts); місто без схеми веде на планувальник. Блок відкритих даних —
 * лише в міста з відкритими даними (фід GTFS / RSS / ICS поки малинський).
 */
export function LocalTransportSchemePage() {
  const profile = useMemo(() => transportProfile(), []);
  const scheme = profile.hasScheme ? schemeFor(profile.cityCode) : null;
  return scheme ? <CitySchemePage profile={profile} scheme={scheme} /> : <Navigate to="/transport" replace />;
}

function CitySchemePage({ profile, scheme }: { profile: TransportProfile; scheme: CityScheme }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchDate = searchParams.get('d') || '';
  const searchTime = searchParams.get('h') || '';
  const activeRoute = searchParams.get('route') || '';
  const hereStop = searchParams.get('stop') || '';
  const { dataset, error, reload, source, online, dataAsOf } = useTransportDataset();
  const [zoomIdx, setZoomIdx] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);

  usePageSeo(useMemo(() => schemeSeo(profile, scheme), [profile, scheme]));

  const suffix = useMemo(() => {
    const qs = new URLSearchParams();
    if (searchDate) qs.set('d', searchDate);
    if (searchTime) qs.set('h', searchTime);
    const s = qs.toString();
    return s ? `?${s}` : '';
  }, [searchDate, searchTime]);

  const setActiveRoute = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('route', id);
      else next.delete('route');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const toggleRoute = useCallback(
    (id: string) => {
      const on = activeRoute !== id;
      gaTrackEvent('transport_scheme_route', { route_id: id, on });
      setActiveRoute(on ? id : null);
    },
    [activeRoute, setActiveRoute]
  );

  const clearHereStop = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('stop');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const hereStopName = (hereStop && dataset?.stops.find((s) => s.id === hereStop)?.name) || '';
  /** Вузол схеми, якому належить зупинка з ?stop= (вузол = кілька фізичних зупинок) */
  const hereNode = useMemo(() => schemeNodeForStop(hereStop, scheme), [hereStop, scheme]);
  /** Лінії через зупинку (через весь вузол, якщо вона його частина) — підсвічуються, поки не обрано маршрут */
  const hereRoutes = useMemo(() => {
    if (!hereStop || !dataset) return [];
    return hereNode ? routesAtNode(dataset, hereNode, scheme) : routesAtStop(dataset, hereStop, scheme);
  }, [hereStop, hereNode, dataset, scheme]);
  const hereRoutesKey = hereRoutes.join(',');
  /** Зупинки вузла з лініями кожної — для рядка «Зупинки вузла» на картці */
  const hereNodeStops = useMemo(
    () => (hereNode && dataset ? stopsOfNode(dataset, hereNode, scheme) : []),
    [hereNode, dataset, scheme]
  );

  // Підсвічування: обрана лінія (або лінії зупинки) лишається, решта тьмяніє. Класи ставляться
  // прямо в SVG, бо він вставлений як рядок (dangerouslySetInnerHTML), а не як React-дерево.
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const lit = activeRoute ? [activeRoute] : hereRoutesKey ? hereRoutesKey.split(',') : null;
    const isLit = (id: string | null) => !lit || lit.includes(id || '');
    root.querySelectorAll('.lts-route').forEach((g) => {
      const id = g.getAttribute('data-route');
      g.classList.toggle('lts-route--dim', !isLit(id));
      g.classList.toggle('lts-route--active', !!activeRoute && id === activeRoute);
    });
    root.querySelectorAll('.lts-badge').forEach((g) => {
      g.classList.toggle('lts-badge--dim', !isLit(g.getAttribute('data-route')));
    });
    const hereGroup = hereStop ? stopGroupFor(root, hereStop) : null;
    root.querySelectorAll('.lts-stop').forEach((g) => {
      g.classList.toggle('lts-stop--here', g === hereGroup);
    });
  }, [activeRoute, hereRoutesKey, hereStop]);

  // Перший кадр на телефоні: прокрутити полотно до зупинки з ?stop=, інакше — так, щоб центр міста
  // (у Малина вузол «Центр», ≈40 % ширини схеми) був посередині, а не лівий край.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    let fraction = scheme.initialScroll;
    const here = hereStop ? stopGroupFor(el, hereStop) : null;
    if (here && typeof here.getBBox === 'function') {
      const b = here.getBBox();
      if (b.width > 0) fraction = (b.x + b.width / 2) / scheme.viewBox.w; // ширина viewBox схеми
    }
    el.scrollLeft = Math.max(0, el.scrollWidth * fraction - el.clientWidth / 2);
  }, [hereStop, scheme]);

  const activate = useCallback(
    (target: EventTarget | null): boolean => {
      const route = closestData(target, 'route');
      if (route) {
        toggleRoute(route);
        return true;
      }
      const stop = closestData(target, 'stop');
      if (stop) {
        gaTrackEvent('transport_scheme_stop', { stop });
        navigate(`/transport/stop/${encodeURIComponent(stop)}${suffix}`);
        return true;
      }
      return false;
    },
    [toggleRoute, navigate, suffix]
  );

  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    activate(e.target);
  };

  const onCanvasKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (activate(e.target)) e.preventDefault();
  };

  const active = scheme.routes.find((r) => r.id === activeRoute);
  const stats = useMemo(
    () => (active && dataset ? routeScheduleStats(dataset.trips, active.id) : null),
    [active, dataset]
  );
  const datasetRoute = active && dataset ? dataset.routes.find((r) => r.id === active.id) : undefined;
  // Сторінка розкладу є лише в маршрутів із заповненим розкладом; поки датасет не прийшов — довіряємо схемі
  const hasSchedulePage = !!active && !active.unconfirmed && (!dataset || (!!datasetRoute && !datasetRoute.unreliable));

  const zoom = ZOOM_STEPS[zoomIdx];
  const enterFullscreen = () => {
    const el = canvasRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => {
        /* iOS Safari без Fullscreen API — лишаємо скрол і пінч-зум */
      });
    }
  };

  const colorVars = useMemo(() => schemeColorVars(scheme.routes), [scheme]);
  const dataAsOfText = formatDataAsOf(dataAsOf);
  const onDataDownload = (format: OpenDataFormat) => gaTrackEvent('transport_data_download', { format });

  let metaLine = 'Розклад: дивіться сторінку маршруту';
  if (active?.unconfirmed) metaLine = 'Розклад уточнюється';
  else if (stats) metaLine = `${stats.tripsPerDirection} рейсів у кожен бік · ${stats.first}–${stats.last}`;

  return (
    <div className="lt-page lt-layout lt-scheme-page" style={colorVars}>
      <div className="lt-container">
        <div className="lt-panel lts-panel">
          <header className="lt-header lts-header">
            <h1 className="lt-title">Схема маршрутів</h1>
            <p className="lt-subtitle">
              {profile.name} · {scheme.routes.length} міських маршрутів · не в масштабі
            </p>
          </header>

          <LocalTransportSubNav searchDate={searchDate} searchTime={searchTime} />
          <TransportStatusBar online={online} source={source} dataAsOf={dataAsOf} error={error} onRetry={() => void reload()} />

          <div className="lts-toolbar">
            <div className="lts-chips" role="group" aria-label="Маршрути" data-active={activeRoute || undefined}>
              <button
                type="button"
                className={`lts-chip lts-chip--all ${!activeRoute ? 'lts-chip--active' : ''}`}
                aria-pressed={!activeRoute}
                onClick={() => setActiveRoute(null)}
              >
                Усі
              </button>
              {scheme.routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`lts-chip ${activeRoute === r.id ? 'lts-chip--active' : ''}`}
                  style={
                    { '--lts-chip': `var(--lts-r${r.id})`, '--lts-chip-fg': `var(--lts-r${r.id}-fg)` } as React.CSSProperties
                  }
                  aria-pressed={activeRoute === r.id}
                  aria-label={`Маршрут №${routeNo(r.id)}: ${r.from} — ${r.to}`}
                  onClick={() => toggleRoute(r.id)}
                >
                  {routeNo(r.id)}
                </button>
              ))}
            </div>
            <div className="lts-zoom" role="group" aria-label="Масштаб">
              <button
                type="button"
                className="lts-zoom-btn"
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
                disabled={zoomIdx === 0}
                aria-label="Зменшити"
              >
                −
              </button>
              <span className="lts-zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="lts-zoom-btn"
                onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
                disabled={zoomIdx === ZOOM_STEPS.length - 1}
                aria-label="Збільшити"
              >
                +
              </button>
              <button type="button" className="lts-zoom-btn lts-zoom-btn--full" onClick={enterFullscreen} aria-label="На весь екран">
                ⤢
              </button>
            </div>
          </div>

          {!active && hereStop && (hereNode || hereStopName) && (
            <section className="lts-card" aria-labelledby="lts-card-title">
              <h2 id="lts-card-title" className="lts-card-title">
                <span className="lts-card-here" aria-hidden>
                  ●
                </span>
                <span>Ви тут: {hereNode ? hereNode.name : hereStopName}</span>
              </h2>
              <p className="lts-card-meta">
                {/* «вузол» лише коли він обʼєднує кілька зупинок; вузол з однієї зупинки — просто зупинка */}
                {hereRoutes.length
                  ? `Лінії через ${hereNode && hereNode.stopIds.length > 1 ? 'вузол' : 'зупинку'}: ${hereRoutes.map((id) => `№${routeNo(id)}`).join(', ')}`
                  : `Через ${hereNode && hereNode.stopIds.length > 1 ? 'вузол' : 'зупинку'} не проходить жодна лінія схеми`}
              </p>
              {hereNodeStops.length > 1 && (
                <p className="lts-card-via lts-card-stops">
                  Зупинки вузла:{' '}
                  {hereNodeStops.map((s, i) => (
                    <React.Fragment key={s.stopId}>
                      {i > 0 && ' · '}
                      <Link
                        className={`lts-card-stop ${s.stopId === hereStop ? 'lts-card-stop--here' : ''}`}
                        to={`/transport/stop/${encodeURIComponent(s.stopId)}${suffix}`}
                      >
                        {s.name}
                      </Link>
                      {s.routeIds.length > 0 && ` (${s.routeIds.join(', ')})`}
                    </React.Fragment>
                  ))}
                </p>
              )}
              <div className="lts-card-actions">
                <Link className="lts-btn lts-btn--primary" to={`/transport/stop/${encodeURIComponent(hereStop)}${suffix}`}>
                  Табло зупинки
                </Link>
                <button type="button" className="lts-btn" onClick={clearHereStop}>
                  Показати всі
                </button>
              </div>
            </section>
          )}

          {active && (
            <section className="lts-card" aria-labelledby="lts-card-title">
              <h2 id="lts-card-title" className="lts-card-title">
                <span
                  className="lts-card-num"
                  style={{ background: `var(--lts-r${active.id})`, color: `var(--lts-r${active.id}-fg)` }}
                  aria-hidden
                >
                  {routeNo(active.id)}
                </span>
                <span>
                  {active.from} — {active.to}
                </span>
              </h2>
              <p className="lts-card-via">{active.via}</p>
              <p className="lts-card-meta">{metaLine}</p>
              <div className="lts-card-actions">
                {hasSchedulePage && (
                  <Link className="lts-btn lts-btn--primary" to={`/transport/route/${encodeURIComponent(active.id)}${suffix}`}>
                    Розклад №{routeNo(active.id)}
                  </Link>
                )}
                <button type="button" className="lts-btn" onClick={() => setActiveRoute(null)}>
                  Показати всі
                </button>
              </div>
            </section>
          )}

          {/* Кліки й клавіатура делегуються елементам SVG із data-route / data-stop (role/tabindex стоять там) */}
          <div ref={canvasRef} className="lts-canvas" onClick={onCanvasClick} onKeyDown={onCanvasKeyDown} data-testid="lts-canvas">
            <div
              className="lts-canvas-inner"
              style={{ width: `${zoom * 100}%` }}
              dangerouslySetInnerHTML={{ __html: scheme.svg }}
            />
          </div>

          <p className="lts-hint">
            Натисніть на лінію або номер — побачите маршрут і його розклад; на зупинку — табло відправлень. Дрібні
            сірі підписи — орієнтири на розгалуженнях, не всі зупинки.
          </p>
          <p className="lts-poster">
            Плакат для друку з QR-кодом: <a href={scheme.poster.pdf}>PDF</a> · <a href={scheme.poster.svg}>SVG</a>
          </p>

          {/* Місто без відкритих даних: звідки розклад і координати (фаза 11.1) */}
          {!profile.hasOpenData && <TransportFooter profile={profile} />}

          {/* Дані належать людині (Docs/transport-open-data-2026-10.md): стабільні посилання, без стану браузера */}
          {profile.hasOpenData && (
            <section id="open-data" className="lts-open-data" aria-labelledby="lts-open-data-title">
              <h2 id="lts-open-data-title" className="lts-open-data-title">
                Дані відкриті
              </h2>
              <p className="lts-open-data-text">
                Зупинки, маршрути й розклад можна забрати з собою і відкрити в будь-якому застосунку — у стандартному
                форматі GTFS або як JSON сайту.
              </p>
              <div className="lts-card-actions">
                <a className="lts-btn lts-btn--primary" href={GTFS_FEED_URL} onClick={() => onDataDownload('gtfs')}>
                  Завантажити розклад (GTFS)
                </a>
                <a className="lts-btn" href={DATASET_JSON_URL} download={DATASET_JSON_FILENAME} onClick={() => onDataDownload('json')}>
                  Дані у JSON
                </a>
              </div>
              <p className="lts-open-data-meta">
                Ліцензія{' '}
                <a href={OPEN_DATA_LICENSE.url} rel="license noopener" target="_blank">
                  {OPEN_DATA_LICENSE.name}
                </a>
                {' — '}вільно для людей, міста й бізнесу з доходом до 100 000 USD на рік, з посиланням на джерело; більшим
                компаніям, платним сервісам і перепродажу — за договором
                {dataAsOfText && ` · станом на ${dataAsOfText}`}
                {' · '}
                <a href={OPEN_DATA_DOC_URL} rel="noopener" target="_blank">
                  як відкрити
                </a>
                {' · '}
                <a href={CHANGES_RSS_URL} type="application/rss+xml">
                  RSS змін розкладу
                </a>
                {' · '}
                <a href={OPENAPI_URL}>API</a>
              </p>
              {/* Фаза 4.3: особисті налаштування розділу — файлом, без сервера (transportPrefs.ts) */}
              <TransportPrefsPanel stopNames={dataset ? dataset.stops.map((st) => st.name) : []} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
