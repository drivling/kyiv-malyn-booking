import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Combobox } from '@/components/Combobox';
import { usePageSeo } from '@/hooks';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import type { TransportData } from './types';
import { buildRoutesFromData, buildStopDepartures, formatMinsClock } from './stopDepartures';
import { buildSortedStopIds, displayNameForStopKey, getStopsCatalog, resolveStopIdInList } from './stopCatalog';
import { LocalTransportSubNav } from './LocalTransportSubNav';
import { VERIFIED_ROUTE_IDS, isVerifiedRoute } from './routeTiming';
import { buildRouteLines } from './routeGeometry';
import { SCHEME_NODES } from './scheme/malyn-scheme-nodes';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';
import { routeColorStyle } from './routeColors';
import { routesAtNode, routesAtStop, schemeNodeForStop, stopsOfNode } from './schemeStops';
import { LocalTransportSchemeMini } from './LocalTransportSchemeMini';
import { buildSchemeUrl } from './schemeMini';
import { formatDateUrl, parseDateUrl } from './dateUrl';
import { getKyivMinutesNow, searchDateKyivOffsetDays } from './kyivTime';
import { useTransportDataset } from '../TransportPage/useTransportDataset';
import { datasetToLocalViewModel } from '../TransportPage/datasetAdapter';
import { hiddenTransportRouteIds } from '@/api/transportDataset';
// Плоский ESM, спільний із prerender-transport-stops.mjs (як site-hosts.mjs)
import { relatedPagesForStop } from '../../../scripts/stop-related-pages.mjs';
import { configureSegmentDurations } from './segmentDurations';
import { getStopArticle, stopArticlePlainText } from '@/content/stops';
import { RouteMap } from './RouteMap';
import { DateTimeControls } from './DateTimeControls';
import { formatDistance, useNearestStops } from './useNearestStops';
import './LocalTransportPage.css';

/**
 * Підпис під міні-схемою: зупинка поза схемою, зупинка-вузол або зупинка з вузла, що обʼєднує кілька
 * фізичних зупинок (тоді підсвічено лінії всього вузла).
 */
function schemeMiniNote(node: { name: string; size: number; stops: string[] } | null, routeIds: string[]): string {
  const lines = routeIds.map((id) => `№${id}`).join(', ');
  if (!node) return `Зупинка між вузлами схеми — підсвічено лінії, що проходять через неї: ${lines}.`;
  if (node.size > 1) {
    const list = node.stops.length > 1 ? ` обʼєднує зупинки ${node.stops.join(', ')}` : '';
    return `Вузол «${node.name}»${list} — підсвічено лінії всього вузла${lines ? `: ${lines}` : ''}.`;
  }
  return lines ? `Ваша зупинка позначена на схемі, підсвічено її лінії: ${lines}.` : 'Ваша зупинка позначена на схемі.';
}

/** Порядок ліній як у легенді схеми; маршрути поза схемою — за номером у кінці */
const SCHEME_ORDER = new Map(SCHEME_ROUTES.map((r, i) => [r.id, i]));
function compareLineIds(a: string, b: string): number {
  return (SCHEME_ORDER.get(a) ?? 999) - (SCHEME_ORDER.get(b) ?? 999) || Number(a) - Number(b);
}

/** Пересадкові та кінцеві вузли схеми — більші маркери з постійним підписом на карті (орієнтири — звичайні зупинки) */
const NODE_STOP_IDS = SCHEME_NODES.filter((n) => n.kind !== 'waypoint').map((n) => n.id);

const STOP_BOARD_HUB_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Як подивитися розклад з зупинки в Малині?',
    a: 'Відкрийте malin.kiev.ua/transport/stop, оберіть зупинку — побачите наступні відправлення всіх маршрутів. Або перейдіть за прямим посиланням /transport/stop/st_…',
  },
  {
    q: 'Чим табло відрізняється від планера «Звідки → Куди»?',
    a: 'Табло показує всі рейси з однієї зупинки. Планер /transport шукає прямі маршрути між двома зупинками.',
  },
];

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
  let m = x.match(/^(\d{1,2})[\u003A\uFF1A\uFE55\uFF0E.](\d{2})(?::\d{2})?/);
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

/** Час відправлення зі зупинки в хвилинах від півночі (цілі хв — дроби лише в сирих даних). */
function roundedDepartureMins(mins: number): number {
  return Math.round(mins);
}

/** «12 хв», «1 год 5 хв» — підпис відліку до відправлення (як у планувальнику) */
function formatWaitMins(mins: number): string {
  if (mins < 60) return `${mins} хв`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

export const LocalTransportStopBoardPage: React.FC = () => {
  const { stopSlug } = useParams<{ stopSlug?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { dataset, loading, error } = useTransportDataset();
  const viewModel = useMemo(() => {
    if (!dataset) return null;
    const vm = datasetToLocalViewModel(dataset);
    // Синхронно, у тому ж рендері: ефект спрацював би вже після першого розкладу, і той рахувався б
    // зі старими тривалостями сегментів (а перерендера після цього може й не бути).
    configureSegmentDurations(vm.segmentDurations, vm.defaultSec);
    return vm;
  }, [dataset]);
  const data: TransportData | null = viewModel?.data ?? null;

  const dParam = searchParams.get('d') ?? '';
  const hParam = searchParams.get('h') ?? '';
  const lineParam = searchParams.get('line') ?? '';

  const [searchDate, setSearchDate] = useState(() => dParam || formatDateUrl(new Date()));
  const [searchTime, setSearchTime] = useState(() => {
    const fromUrl = hParam ? normalizeTimeInput(hParam) : '';
    if (fromUrl) return fromUrl;
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });

  /**
   * Текст у полі «Зупинка» — окремо від обраної зупинки. URL, заголовок, title/canonical і
   * розклад міняються лише після вибору зі списку (як `resolvedFrom` у планувальнику), а не на
   * кожне натискання клавіші.
   */
  const [stopInput, setStopInput] = useState<string | null>(null);
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

  /** Координати лише зупинок зі списку табло — щоб «Поруч зі мною» завжди відкривало табло зупинки */
  const boardStopsCoords = useMemo(() => {
    const src = viewModel?.coords.stops;
    if (!src) return null;
    const out: Record<string, [number, number]> = {};
    for (const id of stops) if (src[id]) out[id] = src[id];
    return out;
  }, [viewModel, stops]);
  const {
    geoLoading,
    geoError,
    nearestStops,
    findNearest,
    clear: clearNearestStops,
  } = useNearestStops(boardStopsCoords, { page: 'board' });

  const decodedSlug = stopSlug ? decodeURIComponent(stopSlug) : '';
  const matchedStopId = useMemo(() => {
    if (!decodedSlug || !stops.length) return '';
    const id = resolveStopIdInList(decodedSlug, stops, stopsCatalog);
    return id && stops.includes(id) ? id : '';
  }, [decodedSlug, stops, stopsCatalog]);

  /** Обрана зупинка — це зупинка з URL (джерело істини); порожній slug → табло без зупинки. */
  const selectedStop = matchedStopId;
  /** Вузол схеми, якому належить обрана зупинка (вузол = кілька фізичних зупинок), або null */
  const schemeNode = useMemo(() => schemeNodeForStop(selectedStop), [selectedStop]);
  /** Лінії схеми через обрану зупинку (через весь вузол, якщо вона його частина) — для міні-схеми під табло */
  const schemeRouteIds = useMemo(() => {
    if (!dataset || !selectedStop) return [];
    return schemeNode ? routesAtNode(dataset, schemeNode) : routesAtStop(dataset, selectedStop);
  }, [dataset, selectedStop, schemeNode]);
  /** Назва вузла і назви його зупинок (лише ті, що є в датасеті) — для підпису під міні-схемою */
  const schemeNodeInfo = useMemo(
    () =>
      schemeNode && dataset
        ? { name: schemeNode.name, size: schemeNode.stopIds.length, stops: stopsOfNode(dataset, schemeNode).map((s) => s.name) }
        : null,
    [schemeNode, dataset]
  );
  const stopInputResolved = stopInput ? resolveStopIdInList(stopInput, stops, stopsCatalog) : '';
  /** У полі є текст, що не відповідає жодній зупинці (людина ще друкує) */
  const stopInputUnresolved = stopInput != null && stopInput !== '' && !stopInputResolved;

  useEffect(() => {
    setShowFullDay(false);
    setStopInput(null);
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


  const departures = useMemo(() => {
    if (!selectedStop || !stopsByRoute) return [];
    return buildStopDepartures(selectedStop, routes, stopsByRoute, stopsCatalog);
  }, [selectedStop, routes, stopsByRoute, stopsCatalog]);

  /** Усі маршрути з відправленнями на зупинці за день — чіпи-фільтри під заголовком */
  const lineIdsAtStop = useMemo(
    () => [...new Set(departures.map((r) => r.routeId))].sort(compareLineIds),
    [departures]
  );
  /** Фільтр за лінією з `?line=` (лише коли така лінія справді проходить через зупинку) */
  const lineFilter = lineIdsAtStop.includes(lineParam) ? lineParam : '';

  const selectedStopTitle = useMemo(
    () => (selectedStop ? displayNameForStopKey(selectedStop, stopsCatalog) : ''),
    [selectedStop, stopsCatalog]
  );

  /** Статична стаття про зупинку без ненадійних (прихованих) маршрутів у чипах/описі */
  const stopArticle = useMemo(() => {
    const article = getStopArticle(selectedStop);
    if (!article?.routeIds?.length || !dataset) return article;
    const hidden = hiddenTransportRouteIds(dataset);
    if (hidden.size === 0) return article;
    return { ...article, routeIds: article.routeIds.filter((r) => !hidden.has(r)) };
  }, [selectedStop, dataset]);

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
    const byLine = lineFilter ? departures.filter((r) => r.routeId === lineFilter) : departures;
    if (!byLine.length || showFullDay) return byLine;
    return byLine.filter((r) => roundedDepartureMins(r.departureMins) >= referenceMins);
  }, [departures, lineFilter, showFullDay, referenceMins]);

  /** Підсвітка: у режимі «з часу» — перший рядок; у «весь день» — перший ≥ часу. */
  const highlightIndex = useMemo(() => {
    if (!visibleDepartures.length) return -1;
    if (!showFullDay) return 0;
    const idx = visibleDepartures.findIndex((r) => roundedDepartureMins(r.departureMins) >= referenceMins);
    return idx >= 0 ? idx : -1;
  }, [visibleDepartures, showFullDay, referenceMins]);

  const syncUrl = (stop: string, date: string, time: string, line = '') => {
    const params = new URLSearchParams();
    if (date) params.set('d', date.trim());
    const hNorm = normalizeTimeInput(time);
    if (hNorm) params.set('h', hNorm);
    if (line) params.set('line', line);
    const search = params.toString() ? `?${params.toString()}` : '';
    const pathname = stop ? `/transport/stop/${encodeURIComponent(stop)}` : '/transport/stop';
    navigate({ pathname, search }, { replace: true });
  };

  const handleStopChange = (v: string) => {
    const id = v ? resolveStopIdInList(v, stops, stopsCatalog) : '';
    if (id && stops.includes(id)) {
      // Вибір зі списку → URL (а з нього — заголовок, розклад, SEO)
      setStopInput(null);
      if (id !== selectedStop) syncUrl(id, searchDate, searchTime);
      return;
    }
    setStopInput(v);
  };

  /** Лише кнопка «×»: табло без зупинки; стирання тексту клавіатурою нічого не навігує */
  const handleStopClear = () => {
    setStopInput(null);
    syncUrl('', searchDate, searchTime);
  };

  /**
   * Дата/час застосовуються одразу, без «Застосувати» (як у планувальнику): URL — replace з
   * невеликим debounce, щоб набір часу не спамив навігацією.
   */
  const dateTimeSyncTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (dateTimeSyncTimer.current) window.clearTimeout(dateTimeSyncTimer.current);
    },
    []
  );
  const handleDateTimeChange = ({ date, time }: { date: string; time: string }) => {
    const t = normalizeTimeInput(time) || time;
    setShowFullDay(false);
    setSearchDate(date);
    setSearchTime(t);
    if (dateTimeSyncTimer.current) window.clearTimeout(dateTimeSyncTimer.current);
    if (!parseDateUrl(date) || !normalizeTimeInput(t)) return;
    dateTimeSyncTimer.current = window.setTimeout(() => syncUrl(selectedStop, date, t, lineFilter), 300);
  };

  /** Чіп лінії під заголовком: фільтр карток, стан у `?line=` (повторний тап знімає) */
  const toggleLine = (id: string) => {
    const on = lineFilter !== id;
    gaTrackEvent('transport_line_filter', { stop: selectedStop, line: id, on });
    syncUrl(selectedStop, searchDate, searchTime, on ? id : '');
  };

  /** Зупинка з геолокації або з маркера на карті → табло цієї зупинки */
  const openStopBoard = (id: string) => {
    clearNearestStops();
    setStopInput(null);
    if (id !== selectedStop) syncUrl(id, searchDate, searchTime);
  };

  const mapCoordsData = useMemo(
    () => (viewModel ? { center: viewModel.coords.center, stops: viewModel.coords.stops } : null),
    [viewModel]
  );
  /** Полілінії всіх перевірених маршрутів у кольорах схеми — огляд міста на карті табло */
  const overviewLines = useMemo(
    () => (viewModel ? buildRouteLines(viewModel.coords.stops, viewModel.data.supplement?.stops?.stops_by_route, VERIFIED_ROUTE_IDS) : []),
    [viewModel]
  );

  const fareAmount =
    typeof data?.supplement?.fare?.amount === 'number' ? data.supplement.fare.amount : null;

  /** Підзаголовок секції відправлень: дата, проїзд, режим («з HH:MM» або «весь день») */
  const boardMeta = [
    'Відправлення',
    parseDateUrl(searchDate) ? searchDate : '',
    fareAmount != null ? `проїзд ${fareAmount} ₴` : '',
    showFullDay ? 'весь день' : `з ${searchTime}`,
  ]
    .filter(Boolean)
    .join(' · ');

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
            {selectedStop && lineIdsAtStop.length > 0 && (
              <div className="lt-line-chips" role="group" aria-label="Маршрути через зупинку">
                {lineIdsAtStop.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="lt-chip lt-line-chip"
                    style={routeColorStyle(id)}
                    aria-pressed={lineFilter === id}
                    onClick={() => toggleLine(id)}
                    title={lineFilter === id ? 'Показати всі маршрути' : `Лише маршрут №${id}`}
                  >
                    №{id}
                  </button>
                ))}
              </div>
            )}
          </header>

          <LocalTransportSubNav searchDate={searchDate} searchTime={searchTime} fromStopId={selectedStop || undefined} />

          <div className="lt-search lt-search--jakdojade lt-stop-board-search">
            <div className="lt-from-to-block">
              <div className="lt-from-to-row lt-stop-board-row">
                <div className="lt-from-to-cell lt-from-to-cell--from">
                  <label className="lt-from-to-label lt-from-to-label--with-icon" htmlFor="lt-stop-board-stop">
                    <span className="lt-from-to-dot lt-from-to-dot--from" aria-hidden /> Зупинка
                  </label>
                  <Combobox
                    id="lt-stop-board-stop"
                    label=""
                    options={[
                      { value: '', label: '— Оберіть зупинку —' },
                      ...stops.map((s: string) => ({ value: s, label: displayNameForStopKey(s, stopsCatalog) })),
                    ]}
                    value={stopInput ?? selectedStop}
                    onChange={handleStopChange}
                    onClear={handleStopClear}
                    placeholder="Наприклад Малинівка"
                    emptyMessage="Зупинок не знайдено"
                    clearable
                  />
                  {stopInputUnresolved && (
                    <p className="lt-routes-hint lt-routes-hint--inline" role="status">
                      Оберіть зупинку зі списку.
                    </p>
                  )}
                </div>
              </div>
              <div className="lt-search-chips">
                <DateTimeControls
                  idPrefix="lt-board"
                  page="board"
                  date={searchDate}
                  time={searchTime}
                  onChange={handleDateTimeChange}
                />
                <button
                  type="button"
                  className="lt-chip"
                  aria-pressed={showFullDay}
                  disabled={!selectedStop}
                  onClick={() => {
                    gaTrackEvent('transport_full_day', { stop: selectedStop, on: !showFullDay });
                    setShowFullDay(!showFullDay);
                  }}
                  title="Усі відправлення з 00:00, а не лише з обраного часу"
                >
                  Весь день
                </button>
                <button
                  type="button"
                  className="lt-chip"
                  onClick={findNearest}
                  disabled={geoLoading}
                  aria-busy={geoLoading}
                  aria-label="Знайти найближчі зупинки за геолокацією"
                  title="Найближчі зупинки за вашою геолокацією"
                >
                  {geoLoading ? 'Шукаємо…' : 'Поруч зі мною'}
                </button>
              </div>
                {/* Live-region завжди в DOM: скрінрідер озвучує помилку геолокації */}
                <p className="lt-geo-error" role="status" aria-live="polite">
                  {geoError}
                </p>
                {nearestStops && nearestStops.length > 0 && (
                  <div className="lt-geo-results" aria-live="polite">
                    <div className="lt-nearest">
                      <p className="lt-nearest-title">Найближчі зупинки:</p>
                      <ul className="lt-nearest-list">
                        {nearestStops.map(({ name, distance }) => (
                          <li key={name} className="lt-nearest-item-row">
                            <button type="button" className="lt-nearest-item" onClick={() => {
                                gaTrackEvent('transport_nearest_pick', { page: 'board', stop: name, distance_m: Math.round(distance) });
                                openStopBoard(name);
                              }}>
                              {displayNameForStopKey(name, stopsCatalog)} — {formatDistance(distance)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
            </div>
          </div>

          {!selectedStop ? (
            <p className="lt-empty lt-stop-board-empty">Оберіть зупинку, щоб побачити розклад відправлень.</p>
          ) : departures.length === 0 ? (
            <p className="lt-empty">Для цієї зупинки немає розкладу в даних.</p>
          ) : visibleDepartures.length === 0 && !showFullDay ? (
            <section className="lt-stop-board" aria-label="Відправлення">
              <p className="lt-stop-board-meta">{boardMeta}</p>
              <p className="lt-empty">
                Після {searchTime} на цій зупинці{lineFilter ? ` маршрут №${lineFilter}` : ''} в розкладі не має відправлень.
              </p>
              <button type="button" className="lt-btn lt-stop-board-show-all" onClick={() => {
                  gaTrackEvent('transport_full_day', { stop: selectedStop, on: true });
                  setShowFullDay(true);
                }}>
                Показати весь день
              </button>
            </section>
          ) : (
            <section className="lt-stop-board" aria-label="Відправлення">
              <p className="lt-stop-board-meta">{boardMeta}</p>
              <ul className="lt-jd-cards">
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
                  // Відлік лише для сьогоднішньої дати (за Києвом), як на картках планувальника
                  let waitLabel = 'відправлення';
                  let waitMod = '';
                  if (travelDayOffsetDays === 0) {
                    let deltaMins = depMins - countdownBaselineMins;
                    if (deltaMins < 0 && countdownBaselineMins >= 22 * 60 && depMins < 4 * 60) {
                      deltaMins += 24 * 60;
                    }
                    if (deltaMins > 0) {
                      waitLabel = `через ${formatWaitMins(deltaMins)}`;
                      waitMod = 'lt-jd-card__wait--soon';
                    } else if (deltaMins === 0) {
                      waitLabel = 'зараз';
                      waitMod = 'lt-jd-card__wait--now';
                    } else {
                      waitLabel = 'вже вирушив';
                    }
                  }
                  const aria = `Маршрут ${row.routeId}, відправлення ${depClock}, ${row.destination}`;
                  return (
                    <li key={`${row.tripId}-${depMins}-${i}`}>
                      <Link
                        className={`lt-jd-card ${isNext ? 'lt-jd-card--next' : ''}`}
                        to={toRoute}
                        aria-label={aria}
                        onClick={() => gaTrackEvent('transport_board_card_click', { route_id: row.routeId, dir: row.direction })}
                      >
                        <div className="lt-jd-card__time" aria-hidden>
                          <span className="lt-jd-card__clock">{depClock}</span>
                          <span className={`lt-jd-card__wait ${waitMod}`}>{waitLabel}</span>
                        </div>
                        <div className="lt-jd-card__body">
                          <span
                            className={`lt-jd-card__route-num ${isVerifiedRoute(row.routeId) ? 'lt-jd-card__route-num--verified' : ''}`}
                            style={routeColorStyle(row.routeId)}
                          >
                            №{row.routeId}
                          </span>
                          <span className="lt-jd-card__destination">
                            <span aria-hidden>→ </span>
                            {row.destination}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {selectedStop && (schemeRouteIds.length > 0 || schemeNode) && (
            <LocalTransportSchemeMini
              source="board"
              routeIds={schemeRouteIds}
              stopIds={schemeNode ? [schemeNode.id] : []}
              href={buildSchemeUrl({ stop: selectedStop, date: searchDate, time: searchTime })}
              label={`Відкрити схему маршрутів: зупинка «${selectedStopTitle}»`}
              note={schemeMiniNote(schemeNodeInfo, schemeRouteIds)}
            />
          )}

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
                            <Link
                              className="lt-stop-article-route"
                              style={routeColorStyle(r)}
                              to={`/transport/route/${encodeURIComponent(r)}`}
                            >
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
              {relatedPagesForStop(selectedStop).length > 0 ? (
                <ul className="lt-stop-article-tips">
                  {relatedPagesForStop(selectedStop).map((link) => (
                    <li key={link.to}>
                      <Link to={link.to}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <aside className="lt-stop-article-howto" aria-label="Як користуватися">
                <p>
                  Розклад — у картках вище. Маршрут до іншої зупинки — у{' '}
                  <Link to={selectedStop ? `/transport?from=${encodeURIComponent(selectedStop)}` : '/transport'}>
                    планері «Звідки → Куди»
                  </Link>
                  .
                </p>
              </aside>
            </section>
          ) : null}

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
              Планер <Link to="/transport">Звідки → Куди</Link>
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
          {/* Усі зупинки міста, обрана — підсвічена; тап по маркеру відкриває табло цієї зупинки */}
          <RouteMap
            stopNames={stops}
            markerStopNames={stops}
            fromStopName={selectedStop || undefined}
            routeLines={overviewLines}
            nodeStopIds={NODE_STOP_IDS}
            onStopMarkerClick={openStopBoard}
            coordsData={mapCoordsData}
            resolveStopLabel={(k) => displayNameForStopKey(k, stopsCatalog)}
          />
        </div>
      </div>
    </div>
  );
};
