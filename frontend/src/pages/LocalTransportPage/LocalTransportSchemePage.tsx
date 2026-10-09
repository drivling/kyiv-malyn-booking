import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePageSeo } from '@/hooks';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { LocalTransportSubNav } from './LocalTransportSubNav';
import { useTransportDataset } from './dataset/useTransportDataset';
import { routeScheduleStats } from './schemeStats';
import { routesAtNode, routesAtStop, schemeNodeForStop, stopsOfNode } from './schemeStops';
import { SCHEME_COLOR_VARS } from './routeColors';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';
import schemeSvg from './scheme/malyn-scheme.svg?raw';
import './LocalTransportPage.css';
import './scheme/scheme-svg.css';
import './LocalTransportSchemePage.css';

const SITE = 'https://malin.kiev.ua';
/** Статика з frontend/public (генерується build_scheme.py --poster-dir; PDF — Chromium print, див. README) */
const POSTER_PDF = '/transport/scheme/malyn-transit-scheme-poster.pdf';
const POSTER_SVG = '/transport/scheme/malyn-transit-scheme-poster.svg';
const ZOOM_STEPS = [1, 1.5, 2, 3];

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
 * SVG згенеровано скриптом Docs/malyn-transit-scheme/build_scheme.py (--site-dir):
 * лінії несуть data-route, зупинки — data-stop; сторінка лише делегує кліки та підсвічує.
 * Обраний маршрут живе в URL (?route=3), щоб на нього можна було дати посилання; ?stop=<id>
 * (з табло) ставить маркер «ви тут» і, поки маршрут не обрано, підсвічує лінії через цю зупинку.
 */
export function LocalTransportSchemePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchDate = searchParams.get('d') || '';
  const searchTime = searchParams.get('h') || '';
  const activeRoute = searchParams.get('route') || '';
  const hereStop = searchParams.get('stop') || '';
  const { dataset } = useTransportDataset();
  const [zoomIdx, setZoomIdx] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);

  usePageSeo(SCHEME_SEO);

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
  const hereNode = useMemo(() => schemeNodeForStop(hereStop), [hereStop]);
  /** Лінії через зупинку (через весь вузол, якщо вона його частина) — підсвічуються, поки не обрано маршрут */
  const hereRoutes = useMemo(() => {
    if (!hereStop || !dataset) return [];
    return hereNode ? routesAtNode(dataset, hereNode) : routesAtStop(dataset, hereStop);
  }, [hereStop, hereNode, dataset]);
  const hereRoutesKey = hereRoutes.join(',');
  /** Зупинки вузла з лініями кожної — для рядка «Зупинки вузла» на картці */
  const hereNodeStops = useMemo(
    () => (hereNode && dataset ? stopsOfNode(dataset, hereNode) : []),
    [hereNode, dataset]
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

  // Перший кадр на телефоні: прокрутити полотно до зупинки з ?stop=, інакше — так, щоб вузол
  // «Центр» (≈40 % ширини схеми) був посередині, а не лівий край із Лісотехнікумом.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    let fraction = 0.4;
    const here = hereStop ? stopGroupFor(el, hereStop) : null;
    if (here && typeof here.getBBox === 'function') {
      const b = here.getBBox();
      if (b.width > 0) fraction = (b.x + b.width / 2) / 1400; // ширина viewBox схеми
    }
    el.scrollLeft = Math.max(0, el.scrollWidth * fraction - el.clientWidth / 2);
  }, [hereStop]);

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

  const active = SCHEME_ROUTES.find((r) => r.id === activeRoute);
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

  let metaLine = 'Розклад: дивіться сторінку маршруту';
  if (active?.unconfirmed) metaLine = 'Розклад уточнюється';
  else if (stats) metaLine = `${stats.tripsPerDirection} рейсів у кожен бік · ${stats.first}–${stats.last}`;

  return (
    <div className="lt-page lt-layout lt-scheme-page" style={SCHEME_COLOR_VARS}>
      <div className="lt-container">
        <div className="lt-panel lts-panel">
          <header className="lt-header lts-header">
            <h1 className="lt-title">Схема маршрутів</h1>
            <p className="lt-subtitle">Малин · 9 міських маршрутів · не в масштабі</p>
          </header>

          <LocalTransportSubNav searchDate={searchDate} searchTime={searchTime} />

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
              {SCHEME_ROUTES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`lts-chip ${activeRoute === r.id ? 'lts-chip--active' : ''}`}
                  style={{ '--lts-chip': `var(--lts-r${r.id})` } as React.CSSProperties}
                  aria-pressed={activeRoute === r.id}
                  aria-label={`Маршрут №${r.id}: ${r.from} — ${r.to}`}
                  onClick={() => toggleRoute(r.id)}
                >
                  {r.id}
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
                  ? `Лінії через ${hereNode && hereNode.stopIds.length > 1 ? 'вузол' : 'зупинку'}: ${hereRoutes.map((id) => `№${id}`).join(', ')}`
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
                <span className="lts-card-num" style={{ background: `var(--lts-r${active.id})` }} aria-hidden>
                  {active.id}
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
                    Розклад №{active.id}
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
              dangerouslySetInnerHTML={{ __html: schemeSvg }}
            />
          </div>

          <p className="lts-hint">
            Натисніть на лінію або номер — побачите маршрут і його розклад; на зупинку — табло відправлень. Дрібні
            сірі підписи — орієнтири на розгалуженнях, не всі зупинки.
          </p>
          <p className="lts-poster">
            Плакат для друку з QR-кодом: <a href={POSTER_PDF}>PDF</a> · <a href={POSTER_SVG}>SVG</a>
          </p>
        </div>
      </div>
    </div>
  );
}
