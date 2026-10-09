import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Combobox } from '@/components/Combobox';
import { usePageSeo } from '@/hooks';
import { routeColor, routeColorStyle } from './routeColors';
import { buildRouteLines, routeStopChain } from './routeGeometry';
import { LocalTransportMapOverlay } from './LocalTransportMapOverlay';
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery';
import { routesAtStop } from './schemeStops';
import { SCHEME_NODES, type SchemeNode } from './scheme/malyn-scheme-nodes';
import { SCHEME_ROUTES } from './scheme/malyn-scheme-routes';
import { LocalTransportSchemeMini } from './LocalTransportSchemeMini';
import { buildSchemeUrl } from './schemeMini';
import type { SupplementRoute, TransportData, TransportRecord, RouteStopWithOrder } from './types';
import { RouteMap } from './RouteMap';
import type { StopsCatalog } from './stopCatalog';
import {
  buildSortedStopIds,
  displayNameForStopKey,
  getStopKey,
  getStopsCatalog,
  invertNameToId,
  resolveStopIdInList,
} from './stopCatalog';
import { VERIFIED_ROUTE_IDS, isVerifiedRoute, recordTiming, segSecForRoute } from './routeTiming';
import { computeTripTiming, minutesAtStop, tripServesPair } from '../TransportPage/tripTiming';
import { tripDepartureMinutes, groupTripsByDirection, parseClockToMinutes } from './tripDeparture';
import { findNearestTrip, findUpcomingTrips } from './nearestTrip';
import { tripDestination } from './stopDepartures';
import { useTransportDataset } from '../TransportPage/useTransportDataset';
import { datasetToLocalViewModel } from '../TransportPage/datasetAdapter';
import { configureSegmentDurations } from './segmentDurations';
import './LocalTransportPage.css';
import { LocalTransportSubNav } from './LocalTransportSubNav';
import { routeLine, routeTitle } from './routeLabel';
import { formatDateUrl, nowClock, parseDateUrl, todayDateUrl } from './dateUrl';
import { getKyivMinutesNow, searchDateKyivOffsetDays } from './kyivTime';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { findNearbyAlternatives, haversineDistance } from './nearbyAlternatives';
import { formatDistance, useNearestStops } from './useNearestStops';
import { DateTimeControls } from './DateTimeControls';
import { ArrivalReportSheet } from './ArrivalReportSheet';
import { isReportableStopId, type ArrivalTarget } from './arrivalReport';
import { useLongPress } from './useLongPress';
import { isPrerendering } from '@/utils/prerender';

const FREQUENT_TO_STOPS_KEY = 'lt.frequentToStops';
/** Пересадкові та кінцеві вузли схеми — більші маркери з постійним підписом на карті (орієнтири — звичайні зупинки) */
const NODE_STOP_IDS = SCHEME_NODES.filter((n) => n.kind !== 'waypoint').map((n) => n.id);
/** Чіпи швидкого старту: вузли й кінцеві схеми (без орієнтирів), у порядку схеми */
const QUICK_NODES = SCHEME_NODES.filter((n) => n.kind !== 'waypoint');
/** «через …» з легенди схеми — для каталогу ліній */
const SCHEME_VIA: Record<string, string> = Object.fromEntries(SCHEME_ROUTES.map((s) => [s.id, s.via]));

/** Іконка-приціл для гео-кнопки у полі «Звідки» */
function GeoIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

/** URL планувальника для пари зупинок з датою/часом — єдине місце, де він збирається. */
function buildPlannerUrl(from: string, to: string, date: string, time: string): string {
  const params = new URLSearchParams();
  if (date) params.set('d', date);
  if (time) params.set('h', time);
  const qs = params.toString();
  return `/transport/${encodeURIComponent(from)}/${encodeURIComponent(to)}${qs ? `?${qs}` : ''}`;
}

/** AEO FAQ for city transit hub (pattern: Korosten/Zvyagel official + local news pages) */
const TRANSPORT_HUB_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Як доїхати міським транспортом у Малині?',
    a: 'Відкрийте malin.kiev.ua/transport і оберіть зупинки «Звідки» і «Куди» (у формі або на карті) — прямі маршрути з найближчим відправленням, прибуттям і тривалістю з’являться одразу.',
  },
  {
    q: 'Де подивитися розклад маршруток Малина?',
    a: 'На сторінці маршруту (/transport/route/…) — таблиця відправлень і список зупинок. На головній /transport — планер і перелік ліній.',
  },
  {
    q: 'Які маршрути є в Малині?',
    a: 'Актуальний список ліній з кінцевими зупинками — у блоці «Маршрути Малина» на цій сторінці. Дані з тієї ж бази, що й карта та табло зупинок.',
  },
  {
    q: 'Чим відрізняється від міжміських маршруток?',
    a: 'Тут — місцевий транспорт Малина (зупинки в місті). Міжміські попутки й маршрутки Київ / Житомир / Коростень — на /mizhgorodski.',
  },
];

/** Зі списку зупинок повертає id найближчої до targetKey за координатами (або першу з списку) */
function findNearestStopInList(
  targetKey: string,
  list: RouteStopWithOrder[],
  coords: Record<string, [number, number]> | null
): string | null {
  if (!list.length) return null;
  const target = coords?.[targetKey];
  if (!target) return getStopKey(list[0]);
  const [lat, lon] = target;
  let best = getStopKey(list[0]);
  let bestDist = Infinity;
  for (const s of list) {
    const key = getStopKey(s);
    const c = coords?.[key];
    if (!c) continue;
    const d = haversineDistance(lat, lon, c[0], c[1]);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return best;
}

function buildRoutes(data: TransportData): Array<{
  id: string;
  from: string | null;
  to: string | null;
  trips: TransportRecord[];
  supplement?: SupplementRoute;
}> {
  const byRoute: Record<
    string,
    { from: string | null; to: string | null; trips: TransportRecord[]; supplement?: SupplementRoute }
  > = {};

  for (const r of data.records) {
    const id = r.route_id;
    if (!byRoute[id]) byRoute[id] = { from: null, to: null, trips: [] };
    if (r.direction_id === '0') byRoute[id].from = r.trip_headsign;
    else byRoute[id].to = r.trip_headsign;
    byRoute[id].trips.push(r);
  }

  const supplementRoutes = data.supplement?.routes || {};
  if (supplementRoutes['9'] && !byRoute['9']) {
    byRoute['9'] = {
      from: supplementRoutes['9'].from ?? null,
      to: supplementRoutes['9'].to ?? null,
      trips: [],
      supplement: supplementRoutes['9'],
    };
  }

  return Object.entries(byRoute)
    .map(([id, v]) => {
      const sup = supplementRoutes[id] || v.supplement;
      return {
        id,
        from: (sup?.from ?? v.from) || null,
        to: (sup?.to ?? v.to) || null,
        trips: v.trips,
        supplement: sup,
      };
    })
    .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
}

function getStopNames(stops: string[] | RouteStopWithOrder[]): string[] {
  if (!stops?.length) return [];
  const first = stops[0];
  return typeof first === 'string' ? (stops as string[]) : (stops as RouteStopWithOrder[]).map((s) => s.name);
}

/** Зупинки без map_only — для списку та вибору З/До (точки тільки для карти виключаємо) */
function getRealStops(stops: RouteStopWithOrder[]): RouteStopWithOrder[] {
  return stops.filter((s) => !s.map_only);
}

function getStopKeysFromRouteStops(
  stops: string[] | RouteStopWithOrder[],
  catalog: StopsCatalog | undefined
): string[] {
  if (!stops?.length) return [];
  const first = stops[0];
  const n2i = invertNameToId(catalog);
  if (typeof first === 'string') {
    return (stops as string[]).map((name) => n2i.get(name) ?? name);
  }
  return getRealStops(stops as RouteStopWithOrder[]).map((s) => getStopKey(s));
}

/** order === -1 означає тимчасово недоступну зупинку */
function isStopAvailableInDirection(stop: RouteStopWithOrder, dir: 'there' | 'back'): boolean {
  const order = dir === 'there' ? stop.order_there : stop.order_back;
  return typeof order === 'number' && order > 0;
}

function routeHasStop(
  routeId: string,
  stopKey: string,
  route: { from: string | null; to: string | null },
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>,
  catalog?: StopsCatalog
): boolean {
  const n2i = invertNameToId(catalog);
  const fromKey = route.from ? n2i.get(route.from) ?? route.from : null;
  const toKey = route.to ? n2i.get(route.to) ?? route.to : null;
  if (fromKey === stopKey || toKey === stopKey) return true;
  const routeStops = stopsByRoute?.[routeId];
  if (!routeStops?.length) return false;
  const first = routeStops[0];
  if (typeof first === 'object' && 'order_there' in first) {
    const stop = (routeStops as RouteStopWithOrder[]).find((s) => getStopKey(s) === stopKey);
    if (!stop) return false;
    return isStopAvailableInDirection(stop, 'there') || isStopAvailableInDirection(stop, 'back');
  }
  return getStopNames(routeStops).some((name) => {
    const id = n2i.get(name);
    return id === stopKey || name === stopKey;
  });
}

function getFirstTripTime(trips: TransportRecord[]): number {
  const times = trips.map((t) => tripDepartureMinutes(t)).filter((t) => t > 0);
  return times.length > 0 ? Math.min(...times) : 7 * 60; // 7:00 за замовчуванням
}

function formatTime(minutes: number): string {
  const totalMins = Math.round(minutes);
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** «12 хв», «1 год 5 хв» — підпис відліку до відправлення (як на табло) */
function formatWait(mins: number): string {
  if (mins < 60) return `${mins} хв`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

/** Визначити напрямок (there/back) за парою З→До з порядку зупинок */
function getImpliedDirection(
  fromStop: string,
  toStop: string,
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>,
  routeId?: string
): 'there' | 'back' | null {
  if (!routeId || !stopsByRoute?.[routeId]) return null;
  const routeStops = stopsByRoute[routeId];
  if (!Array.isArray(routeStops) || routeStops.length === 0) return null;
  const first = routeStops[0];
  const withOrder: RouteStopWithOrder[] =
    first && typeof first === 'object' && 'name' in first
      ? (routeStops as RouteStopWithOrder[])
      : (routeStops as string[]).map((name, i) => ({
          name,
          order_there: i + 1,
          order_back: routeStops.length - i,
          belongs_to: 'both' as const,
        }));
  const orderedThere = [...withOrder]
    .filter((s) => (s.belongs_to ?? 'both') !== 'back' && s.order_there > 0)
    .sort((a, b) => a.order_there - b.order_there);
  const orderedBack = [...withOrder]
    .filter((s) => (s.belongs_to ?? 'both') !== 'there' && s.order_back > 0)
    .sort((a, b) => a.order_back - b.order_back);
  const fromOrderThere = orderedThere.find((s) => getStopKey(s) === fromStop)?.order_there;
  const toOrderThere = orderedThere.find((s) => getStopKey(s) === toStop)?.order_there;
  const fromOrderBack = orderedBack.find((s) => getStopKey(s) === fromStop)?.order_back;
  const toOrderBack = orderedBack.find((s) => getStopKey(s) === toStop)?.order_back;
  if (fromOrderThere != null && toOrderThere != null && fromOrderThere < toOrderThere) return 'there';
  if (fromOrderBack != null && toOrderBack != null && fromOrderBack < toOrderBack) return 'back';
  return null;
}

/** Зібрати id зупинок у порядку руху для маршруту та напрямку (з технічними точками map_only) */
function getOrderedStopKeys(
  routeId: string,
  dir: 'there' | 'back',
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>
): string[] {
  return routeStopChain(stopsByRoute, routeId, dir);
}

/** Знайти baseTime (відправлення з початкової) рейсу, що проходить fromStop найближче до depFromStopMins */
function findBaseTimeByDepartureFromStop(
  trips: TransportRecord[],
  depFromStopMins: number,
  fromStop: string,
  dir: 'there' | 'back',
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>,
  routeId?: string
): number | null {
  if (!routeId) return null;
  const chain = getOrderedStopKeys(routeId, dir, stopsByRoute);
  if (chain.length < 2) return null;
  const { dir0, dir1 } = groupTripsByDirection(trips);
  const dirTrips = dir === 'there' ? dir1 : dir0;
  let best: { base: number; diff: number } | null = null;
  for (const t of dirTrips) {
    const m = minutesAtStop(recordTiming(routeId, chain, t), fromStop);
    if (m == null) continue;
    const diff = Math.abs(m - depFromStopMins);
    if (!best || diff < best.diff) best = { base: tripDepartureMinutes(t), diff };
  }
  return best?.base ?? null;
}

/**
 * Формує посилання для QR-коду на зупинці.
 * Відкриває сторінку маршруту з зупинкою та напрямком; час не вказано — показується найближчий рейс за поточним часом.
 * @param routeId — номер маршруту (напр. "9")
 * @param stopName — назва зупинки (напр. "Малинівка")
 * @param direction — напрямок: "there" (туди, до кінцевої) або "back" (назад)
 * @param basePath — базовий шлях (за замовчуванням "/transport")
 */
export function buildStopRouteQrUrl(
  routeId: string,
  stopName: string,
  direction: 'there' | 'back',
  basePath = '/transport'
): string {
  const path = `${basePath}/route/${routeId}`;
  const params = new URLSearchParams();
  params.set('stop', stopName);
  params.set('dir', direction);
  return `${path}?${params.toString()}`;
}

export const LocalTransportPage: React.FC = () => {
  const { routeId, fromStop: fromPath, toStop: toPath } = useParams<{
    routeId?: string;
    fromStop?: string;
    toStop?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStopFromUrl = searchParams.get('stop') ?? '';
  const toFromUrl = searchParams.get('to') ?? '';
  const timeFromUrl = searchParams.get('time') ?? '';
  const rawDir = searchParams.get('dir') ?? '';
  const dirFromUrl = rawDir.toLowerCase().startsWith('there') ? 'there' : rawDir.toLowerCase().startsWith('back') ? 'back' : rawDir;
  const dateFromUrl = searchParams.get('d') ?? '';
  const hourFromUrl = searchParams.get('h') ?? '';
  const { dataset, loading, error } = useTransportDataset();
  const viewModel = useMemo(() => {
    if (!dataset) return null;
    const vm = datasetToLocalViewModel(dataset);
    // Синхронно, у тому ж рендері: ефект спрацював би вже після першого розкладу, і той рахувався б
    // зі старими тривалостями сегментів (а перерендера після цього може й не бути).
    configureSegmentDurations(vm.segmentDurations, vm.defaultSec);
    return vm;
  }, [dataset]);
  const data = viewModel?.data ?? null;
  const stopsCoords = viewModel?.coords.stops ?? null;
  const mapCoordsData = useMemo(
    () => (viewModel ? { center: viewModel.coords.center, stops: viewModel.coords.stops } : null),
    [viewModel]
  );

  const [stopFilter, setStopFilter] = useState('');
  // null — користувач ще не торкався поля (значення береться з URL); '' — свідомо порожнє.
  const [searchFrom, setSearchFrom] = useState<string | null>(null);
  const [searchTo, setSearchTo] = useState<string | null>(null);
  // Остання пара резолвнутих зупинок: від неї рахуються результати, щоб набір тексту в полі
  // не блимав «немає прямого маршруту».
  const [committedPair, setCommittedPair] = useState<{ from: string; to: string } | null>(null);
  const [searchDate, setSearchDate] = useState<string>(() => todayDateUrl());
  const [searchTime, setSearchTime] = useState<string>(() => nowClock());
  const youHereRef = useRef<HTMLLIElement | null>(null);
  const toStopRef = useRef<HTMLLIElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [segmentStyle, setSegmentStyle] = useState<{ top: number; height: number } | null>(null);
  const {
    geoLoading,
    geoError,
    nearestStops,
    findNearest: handleFindNearest,
    clear: clearNearestStops,
  } = useNearestStops(stopsCoords, { page: 'planner' });
  const latestStopRef = useRef<string>('');
  const searchFromInputRef = useRef<HTMLInputElement | null>(null);
  const searchToInputRef = useRef<HTMLInputElement | null>(null);
  const searchCardRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [isSwapAnimating, setIsSwapAnimating] = useState(false);
  /** Оновлення «через N хв» раз на хвилину (київський час), як на табло */
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const kyivNowMins = useMemo(() => getKyivMinutesNow(), [nowTick]);
  /** 0 — дата пошуку сьогодні (за Києвом), 1 — завтра …; відлік показуємо лише для сьогодні */
  const travelDayOffset = useMemo(() => searchDateKyivOffsetDays(searchDate), [searchDate]);
  const [frequentToStops, setFrequentToStops] = useState<string[]>([]);
  // Карта на телефоні — повноекранний overlay за кнопкою «Карта»; на десктопі — колонка праворуч
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapResizeToken, setMapResizeToken] = useState(0);
  /** Overlay карти на телефоні; подія фіксує сторінку і чи вже обрано пару */
  const openMap = useCallback((page: 'planner' | 'route', hasPair: boolean) => {
    gaTrackEvent('transport_map_open', { page, has_pair: hasPair });
    setMapOpen(true);
    setMapResizeToken((t) => t + 1);
  }, []);
  const closeMap = useCallback(() => setMapOpen(false), []);
  /** Повна таблиця розкладу на сторінці маршруту: розгорнута на десктопі, згорнута на телефоні */
  const [timetableOpen, setTimetableOpen] = useState(() => !isPhone);
  /** Довге натискання на час рейсу → «Факт прибуття» (ArrivalReportSheet) */
  const [arrivalTarget, setArrivalTarget] = useState<ArrivalTarget | null>(null);
  const closeArrival = useCallback(() => setArrivalTarget(null), []);
  const longPress = useLongPress();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FREQUENT_TO_STOPS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setFrequentToStops(parsed.filter((v) => typeof v === 'string'));
      }
    } catch {
      setFrequentToStops([]);
    }
  }, []);

  const rememberFrequentToStop = (stopName: string) => {
    if (!stopName) return;
    setFrequentToStops((prev) => {
      const next = [stopName, ...prev.filter((s) => s !== stopName)].slice(0, 5);
      try {
        localStorage.setItem(FREQUENT_TO_STOPS_KEY, JSON.stringify(next));
      } catch {
        // ignore write errors
      }
      return next;
    });
  };

  useEffect(() => {
    if (selectedStopFromUrl) {
      latestStopRef.current = selectedStopFromUrl;
      setStopFilter(selectedStopFromUrl);
    }
  }, [selectedStopFromUrl]);

  const fromPathDecoded = fromPath ? decodeURIComponent(fromPath) : '';
  const toPathDecoded = toPath ? decodeURIComponent(toPath) : '';
  const hasPathSearch = Boolean(fromPathDecoded && toPathDecoded);
  const queryFrom = searchParams.get('from') ?? '';
  const queryTo = searchParams.get('to') ?? '';
  const isMainPage = !routeId;
  const isDetailPage = Boolean(routeId);

  const routes = useMemo(() => (data ? buildRoutes(data) : []), [data]);
  const stopsByRoute = data?.supplement?.stops?.stops_by_route;
  /** Полілінії всіх перевірених маршрутів у кольорах схеми — огляд міста на карті планера */
  const overviewLines = useMemo(
    () => (stopsCoords ? buildRouteLines(stopsCoords, stopsByRoute, VERIFIED_ROUTE_IDS) : []),
    [stopsCoords, stopsByRoute]
  );
  const linesAtStop = useCallback((stopId: string) => (dataset ? routesAtStop(dataset, stopId) : []), [dataset]);
  const boardHrefFor = useCallback(
    (stopId: string) =>
      `/transport/stop/${encodeURIComponent(stopId)}?d=${encodeURIComponent(searchDate)}&h=${encodeURIComponent(searchTime)}`,
    [searchDate, searchTime]
  );
  const stopsCatalog = useMemo(() => getStopsCatalog(data), [data]);
  const stops = useMemo(
    () => buildSortedStopIds(routes, stopsByRoute, stopsCatalog),
    [routes, stopsByRoute, stopsCatalog]
  );

  const effectiveSearchFrom = searchFrom ?? (fromPathDecoded || queryFrom);
  const effectiveSearchTo = searchTo ?? (toPathDecoded || queryTo);
  const resolvedFrom = useMemo(
    () => resolveStopIdInList(effectiveSearchFrom, stops, stopsCatalog),
    [effectiveSearchFrom, stops, stopsCatalog]
  );
  const resolvedTo = useMemo(
    () => resolveStopIdInList(effectiveSearchTo, stops, stopsCatalog),
    [effectiveSearchTo, stops, stopsCatalog]
  );
  const pairIsSame = Boolean(resolvedFrom && resolvedTo && resolvedFrom === resolvedTo);
  const hasResolvedPair = Boolean(resolvedFrom && resolvedTo) && !pairIsSame;

  useEffect(() => {
    if (!isMainPage) return;
    if (hasResolvedPair) {
      setCommittedPair((prev) =>
        prev && prev.from === resolvedFrom && prev.to === resolvedTo ? prev : { from: resolvedFrom, to: resolvedTo }
      );
    } else if (!effectiveSearchFrom && !effectiveSearchTo) {
      setCommittedPair(null);
    }
  }, [isMainPage, hasResolvedPair, resolvedFrom, resolvedTo, effectiveSearchFrom, effectiveSearchTo]);

  // Адресний рядок завжди відповідає видачі: щойно обидві зупинки резолвнуті (вибір зі списку,
  // ⇅, маркер на карті) або змінились дата/час — оновлюємо URL через replace. Порівняння з
  // поточним location захищає від циклу з ефектом URL→state вище.
  useEffect(() => {
    if (!isMainPage || !hasResolvedPair) return;
    if (!parseDateUrl(searchDate) || !/^\d{2}:\d{2}$/.test(searchTime)) return;
    let currentPath = location.pathname;
    try {
      currentPath = decodeURIComponent(location.pathname);
    } catch {
      /* лишаємо як є */
    }
    const current = new URLSearchParams(location.search);
    const same =
      currentPath === `/transport/${resolvedFrom}/${resolvedTo}` &&
      current.get('d') === searchDate &&
      current.get('h') === searchTime;
    if (same) return;
    const target = buildPlannerUrl(resolvedFrom, resolvedTo, searchDate, searchTime);
    const timer = window.setTimeout(() => navigate(target, { replace: true }), 300);
    return () => window.clearTimeout(timer);
  }, [isMainPage, hasResolvedPair, resolvedFrom, resolvedTo, searchDate, searchTime, location.pathname, location.search, navigate]);

  // Лише одна зупинка резолвнута і URL без path-пари (напр. прийшли з табло як /transport?from=…):
  // тримаємо ?from= / ?to= актуальними, щоб адресний рядок не рекламував стару зупинку.
  useEffect(() => {
    if (!isMainPage || hasResolvedPair) return;
    if (fromPathDecoded || toPathDecoded) return;
    if (!resolvedFrom && !resolvedTo) return;
    if (!parseDateUrl(searchDate) || !/^\d{2}:\d{2}$/.test(searchTime)) return;
    const current = new URLSearchParams(location.search);
    const same =
      location.pathname === '/transport' &&
      current.get('from') === (resolvedFrom || null) &&
      current.get('to') === (resolvedTo || null) &&
      current.get('d') === searchDate &&
      current.get('h') === searchTime;
    if (same) return;
    const params = new URLSearchParams();
    if (resolvedFrom) params.set('from', resolvedFrom);
    if (resolvedTo) params.set('to', resolvedTo);
    params.set('d', searchDate);
    params.set('h', searchTime);
    const timer = window.setTimeout(() => navigate(`/transport?${params.toString()}`, { replace: true }), 300);
    return () => window.clearTimeout(timer);
  }, [isMainPage, hasResolvedPair, fromPathDecoded, toPathDecoded, resolvedFrom, resolvedTo, searchDate, searchTime, location.pathname, location.search, navigate]);

  /** У полі є текст, що не відповідає жодній зупинці (людина ще друкує). */
  const hasUnresolvedInput =
    (effectiveSearchFrom !== '' && !resolvedFrom) || (effectiveSearchTo !== '' && !resolvedTo);
  /** Показані результати — для попередньої пари (поле стерли або міняють). */
  const pairIsStale =
    committedPair != null && (committedPair.from !== resolvedFrom || committedPair.to !== resolvedTo);
  const showFormHint = hasUnresolvedInput || pairIsStale || pairIsSame;
  /** Назви пари для заголовка сторінки і title вкладки */
  const pairNames = useMemo(
    () =>
      committedPair
        ? {
            from: displayNameForStopKey(committedPair.from, stopsCatalog),
            to: displayNameForStopKey(committedPair.to, stopsCatalog),
          }
        : null,
    [committedPair, stopsCatalog]
  );

  /** Прямі маршрути між двома зупинками (обидві на маршруті і в одному напрямку) */
  const directRoutesBetween = useCallback(
    (from: string, to: string) =>
      routes.filter((r) => {
        const hasFrom = routeHasStop(r.id, from, r, stopsByRoute, stopsCatalog);
        const hasTo = routeHasStop(r.id, to, r, stopsByRoute, stopsCatalog);
        if (!hasFrom || !hasTo) return false;
        return getImpliedDirection(from, to, stopsByRoute, r.id) != null;
      }),
    [routes, stopsByRoute, stopsCatalog]
  );

  const routesConnectingFromTo = useMemo(() => {
    if (!committedPair || !stops.length) return [];
    return directRoutesBetween(committedPair.from, committedPair.to);
  }, [directRoutesBetween, stops, committedPair]);

  /** «Немає прямого маршруту»: сусідні зупинки (до 400 м), між якими прямий маршрут є */
  const nearbyAlternatives = useMemo(() => {
    if (!committedPair || routesConnectingFromTo.length > 0 || !stopsCoords) return [];
    return findNearbyAlternatives({
      from: committedPair.from,
      to: committedPair.to,
      stopIds: stops,
      coords: stopsCoords,
      directRouteIds: (a, b) => directRoutesBetween(a, b).map((r) => r.id),
    });
  }, [committedPair, routesConnectingFromTo, stopsCoords, stops, directRoutesBetween]);

  // Аналітика: кожна резолвнута пара — один «пошук»; порожня видача — окрема подія.
  // Без PII: лише id зупинок і кількість прямих маршрутів.
  useEffect(() => {
    if (!isMainPage || !committedPair) return;
    const params = { from: committedPair.from, to: committedPair.to, direct_routes: routesConnectingFromTo.length };
    gaTrackEvent('transport_search', params);
    if (routesConnectingFromTo.length === 0) {
      gaTrackEvent('transport_no_route', { from: params.from, to: params.to, nearby: nearbyAlternatives.length });
    }
  }, [isMainPage, committedPair, routesConnectingFromTo, nearbyAlternatives]);

  useEffect(() => {
    if (!isMainPage || !stops.length) return;
    if (fromPathDecoded || toPathDecoded) {
      const fromMatch = fromPathDecoded ? resolveStopIdInList(fromPathDecoded, stops, stopsCatalog) : '';
      const toMatch = toPathDecoded ? resolveStopIdInList(toPathDecoded, stops, stopsCatalog) : '';
      setSearchFrom(fromMatch);
      setSearchTo(toMatch);
    } else if (queryFrom || queryTo) {
      setSearchFrom(queryFrom ? resolveStopIdInList(queryFrom, stops, stopsCatalog) : '');
      setSearchTo(queryTo ? resolveStopIdInList(queryTo, stops, stopsCatalog) : '');
    }
    if (dateFromUrl) {
      const parsed = parseDateUrl(dateFromUrl);
      if (parsed) setSearchDate(formatDateUrl(parsed));
    }
    if (hourFromUrl) setSearchTime(hourFromUrl);
  }, [isMainPage, fromPathDecoded, toPathDecoded, queryFrom, queryTo, dateFromUrl, hourFromUrl, stops.length, stops, stopsCatalog]);

  const effectiveStopFilter = stopFilter || selectedStopFromUrl;

  const detailRoute = useMemo(
    () => (routeId ? routes.find((r) => r.id === routeId) : null),
    [routes, routeId]
  );

  const transportSeo = useMemo(() => {
    if (isDetailPage && detailRoute) {
      const path = routeLine(detailRoute);
      const times = [...detailRoute.trips]
        .map((t) => tripDepartureMinutes(t))
        .filter((m) => m > 0)
        .sort((a, b) => a - b);
      const first = times[0] != null ? formatTime(times[0]) : null;
      const last = times.length ? formatTime(times[times.length - 1]) : null;
      const tripHint =
        first && last
          ? ` Відправлення з кінцевої: з ${first} до ${last} (${times.length} рейсів).`
          : '';
      const faq = [
        {
          q: `Який розклад маршруту №${detailRoute.id} у Малині?`,
          a:
            first && last
              ? `На malin.kiev.ua/transport/route/${detailRoute.id}: рейси з ${first} до ${last}. Повний список зупинок і табло — на сторінці маршруту.`
              : `Відкрийте malin.kiev.ua/transport/route/${detailRoute.id} — таблиця відправлень і список зупинок.`,
        },
        {
          q: `Куди їде маршрутка №${detailRoute.id}?`,
          a: `${path ? `Лінія ${path}. ` : ''}Планер «Звідки → Куди» і карта: malin.kiev.ua/transport.`,
        },
      ];
      return {
        title: `Маршрут ${routeTitle(detailRoute)} | Транспорт Малина | malin.kiev.ua`,
        canonicalUrl: `https://malin.kiev.ua/transport/route/${encodeURIComponent(detailRoute.id)}`,
        description: `Розклад і зупинки маршруту №${detailRoute.id}${path ? ` (${path})` : ''} у Малині.${tripHint}`,
        jsonLdId: `transport-route-jsonld-${detailRoute.id}`,
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
                  name: routeTitle(detailRoute),
                  item: `https://malin.kiev.ua/transport/route/${encodeURIComponent(detailRoute.id)}`,
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
            ...(times.length
              ? [
                  {
                    '@type': 'ItemList',
                    name: `Рейси маршруту №${detailRoute.id}`,
                    numberOfItems: times.length,
                    itemListElement: times.slice(0, 40).map((m, i) => ({
                      '@type': 'ListItem',
                      position: i + 1,
                      name: formatTime(m),
                    })),
                  },
                ]
              : []),
          ],
        },
      };
    }

    const routeCount = routes.length;
    const unknownRoute = isDetailPage && !detailRoute && routeCount > 0;
    return {
      title: pairNames
        ? `${pairNames.from} → ${pairNames.to} — як доїхати у Малині | malin.kiev.ua`
        : 'Транспорт Малина — розклад маршруток і як доїхати | malin.kiev.ua',
      canonicalUrl: 'https://malin.kiev.ua/transport',
      // /transport/route/<невідомий або прихований id> показує планер — не індексуємо як дубль хаба.
      // /transport/:from/:to — SPA-only варіанти з canonical на хаб (SEO-план 1.3), теж noindex.
      ...(unknownRoute || pairNames ? { robots: 'noindex, follow' } : {}),
      description: pairNames
        ? `Прямі маршрути міського транспорту Малина від зупинки ${pairNames.from} до ${pairNames.to}: найближче відправлення, прибуття і тривалість. Планер на malin.kiev.ua/transport.`
        : routeCount > 0
          ? `Міський транспорт Малина: ${routeCount} маршрутів, планер «Звідки → Куди», карта й табло зупинок. Актуальний розклад на malin.kiev.ua/transport.`
          : 'Міський транспорт Малина: планер «Звідки → Куди», карта, розклад маршрутів і табло зупинок на malin.kiev.ua/transport.',
      jsonLdId: 'transport-hub-jsonld',
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebPage',
            name: 'Транспорт Малина',
            url: 'https://malin.kiev.ua/transport',
            description:
              'Місцеві маршрутки Малина: як доїхати між зупинками, розклад і карта.',
            inLanguage: 'uk-UA',
          },
          {
            '@type': 'FAQPage',
            mainEntity: TRANSPORT_HUB_FAQ.map((item) => ({
              '@type': 'Question',
              name: item.q,
              acceptedAnswer: { '@type': 'Answer', text: item.a },
            })),
          },
          ...(routeCount
            ? [
                {
                  '@type': 'ItemList',
                  name: 'Маршрути міського транспорту Малина',
                  numberOfItems: routeCount,
                  itemListElement: routes.map((r, i) => ({
                    '@type': 'ListItem',
                    position: i + 1,
                    name: routeTitle(r),
                    url: `https://malin.kiev.ua/transport/route/${encodeURIComponent(r.id)}`,
                  })),
                },
              ]
            : []),
        ],
      },
    };
  }, [isDetailPage, detailRoute, routes, pairNames]);

  usePageSeo(transportSeo);

  // ---- Сторінка маршруту: URL — єдине джерело пари («Звідки»/«Куди»), напрямку й обраного рейсу ----
  const detailRouteStopIds = useMemo(() => {
    if (!detailRoute || !stopsByRoute?.[detailRoute.id]) return [];
    return getStopKeysFromRouteStops(stopsByRoute[detailRoute.id], stopsCatalog);
  }, [detailRoute, stopsByRoute, stopsCatalog]);
  /** Пара з URL (`stop`/`to`), резолвнута в зупинки маршруту; «Куди» рахується лише разом зі «Звідки» */
  const detailPair = useMemo(() => {
    if (!detailRoute || !detailRouteStopIds.length) return { from: '', to: '' };
    const pick = (raw: string) => {
      if (!raw) return '';
      const id = resolveStopIdInList(raw, detailRouteStopIds, stopsCatalog);
      return id && detailRouteStopIds.includes(id) ? id : '';
    };
    const from = pick(selectedStopFromUrl);
    return { from, to: from ? pick(toFromUrl) : '' };
  }, [detailRoute, detailRouteStopIds, selectedStopFromUrl, toFromUrl, stopsCatalog]);
  const fromStop = detailPair.from;
  const toStop = detailPair.to;
  /** Напрямок: `dir` з URL → випливає з пари → belongs_to «Звідки» → «туди» */
  const stopsDirection: 'there' | 'back' = useMemo(() => {
    if (dirFromUrl === 'there' || dirFromUrl === 'back') return dirFromUrl;
    if (!detailRoute) return 'there';
    if (fromStop && toStop) return getImpliedDirection(fromStop, toStop, stopsByRoute, detailRoute.id) ?? 'there';
    if (fromStop) {
      const rs = stopsByRoute?.[detailRoute.id];
      const first = Array.isArray(rs) ? rs[0] : null;
      if (first && typeof first === 'object' && 'name' in first) {
        const own = (rs as RouteStopWithOrder[]).find((s) => getStopKey(s) === fromStop);
        if (own?.belongs_to === 'back') return 'back';
      }
    }
    return 'there';
  }, [dirFromUrl, detailRoute, fromStop, toStop, stopsByRoute]);
  /** Опорний час сторінки маршруту: `h` з URL (сьогодні — не раніше за зараз), інакше зараз за Києвом */
  const detailRefMins = useMemo(() => {
    const h = parseClockToMinutes(hourFromUrl);
    if (h <= 0) return kyivNowMins;
    const offset = dateFromUrl ? searchDateKyivOffsetDays(dateFromUrl) : 0;
    return offset === 0 || offset == null ? Math.max(h, kyivNowMins) : h;
  }, [hourFromUrl, dateFromUrl, kyivNowMins]);
  /**
   * Обраний рейс у поточному напрямку. `time` в URL — час на «Звідки» (або на першій зупинці, коли
   * «Звідки» немає): беремо рейс, що проходить її найближче до цього часу; без `time` — найближчий
   * до опорного часу рейс, що обслуговує пару.
   */
  const selectedTrip = useMemo(() => {
    if (!detailRoute || !detailRoute.trips.length) return null;
    const chain = getOrderedStopKeys(detailRoute.id, stopsDirection, stopsByRoute);
    const anchor = fromStop || chain[0] || '';
    const dirTrips = groupTripsByDirection(detailRoute.trips)[stopsDirection === 'there' ? 'dir1' : 'dir0'];
    const pinned = parseClockToMinutes(timeFromUrl);
    let record: TransportRecord | null = null;
    if (pinned > 0 && anchor) {
      const base = findBaseTimeByDepartureFromStop(
        detailRoute.trips,
        pinned,
        anchor,
        stopsDirection,
        stopsByRoute,
        detailRoute.id
      );
      record = base != null ? (dirTrips.find((t) => tripDepartureMinutes(t) === base) ?? null) : null;
    }
    if (!record) {
      const at =
        anchor && chain.length >= 2
          ? {
              routeId: detailRoute.id,
              chainKeys: {
                there: getOrderedStopKeys(detailRoute.id, 'there', stopsByRoute),
                back: getOrderedStopKeys(detailRoute.id, 'back', stopsByRoute),
              },
              fromStop: anchor,
              toStop: toStop || undefined,
            }
          : undefined;
      const nearest =
        findNearestTrip(detailRoute.trips, detailRefMins, stopsDirection, at) ??
        findNearestTrip(detailRoute.trips, detailRefMins, stopsDirection);
      record = nearest?.record ?? null;
    }
    return record ? { record, baseTime: tripDepartureMinutes(record), direction: stopsDirection } : null;
  }, [detailRoute, stopsDirection, stopsByRoute, fromStop, toStop, timeFromUrl, detailRefMins]);
  const selectedTripTime = selectedTrip?.baseTime ?? null;
  const selectedTripDirection = selectedTrip?.direction ?? null;

  /** Точки лінії маршруту на карті в поточному напрямку (з технічними map_only для поворотів) */
  const detailMapStopNames = useMemo(
    () => (detailRoute ? routeStopChain(stopsByRoute, detailRoute.id, stopsDirection) : []),
    [detailRoute, stopsByRoute, stopsDirection]
  );

  /** Fallback для карти: усі зупинки маршруту в поточному напрямку (щоб карта завжди мала що малювати) */
  const detailMapStopNamesFallback = useMemo(
    () => (detailRoute ? routeStopChain(stopsByRoute, detailRoute.id, stopsDirection, { all: true }) : []),
    [detailRoute, stopsByRoute, stopsDirection]
  );

  const mapStopNamesToShow = detailMapStopNames.length > 0 ? detailMapStopNames : detailMapStopNamesFallback;

  /** Лінія обраного маршруту в її кольорі (поточний напрямок) */
  const detailLine = useMemo(
    () => (detailRoute && stopsCoords ? buildRouteLines(stopsCoords, stopsByRoute, [detailRoute.id], stopsDirection) : []),
    [detailRoute, stopsCoords, stopsByRoute, stopsDirection]
  );

  /** Тільки «реальні» зупинки для маркерів на карті (без map_only — технічні точки лише для поворотів лінії) */
  const detailMapStopNamesForMarkers = useMemo(
    () => (detailRoute ? routeStopChain(stopsByRoute, detailRoute.id, stopsDirection, { markersOnly: true }) : []),
    [detailRoute, stopsByRoute, stopsDirection]
  );

  // Не робимо auto-scroll до "Ви тут" — це викликало зміщення вліво при виборі маршруту та зміні напрямку

  // Вимірювання сегменту лінії між З і До
  useEffect(() => {
    if (!fromStop || !toStop || !youHereRef.current || !toStopRef.current || !timelineRef.current) {
      setSegmentStyle(null);
      return;
    }
    const measure = () => {
      const fromEl = youHereRef.current;
      const toEl = toStopRef.current;
      const timelineEl = timelineRef.current;
      if (!fromEl || !toEl || !timelineEl) return;
      const timelineRect = timelineEl.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const fromCenter = fromRect.top + fromRect.height / 2 - timelineRect.top;
      const toCenter = toRect.top + toRect.height / 2 - timelineRect.top;
      const top = Math.min(fromCenter, toCenter);
      const height = Math.abs(toCenter - fromCenter);
      setSegmentStyle({ top, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(timelineRef.current);
    return () => ro.disconnect();
  }, [fromStop, toStop, stopsDirection]);

  const updateDetailUrl = (updates: { stop?: string; to?: string; time?: string; dir?: string; d?: string; h?: string }) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ['stop', 'to', 'time', 'dir', 'd', 'h'] as const) {
        if (!(key in updates)) continue;
        const value = updates[key];
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  };

  /**
   * Вибір «Звідки»/«Куди» (карта, пікер, далі — таймлайн): пара в URL, напрямок випливає з пари
   * (інакше лишається поточний), закріплений `time` скидається — обраним стає найближчий рейс.
   */
  const setDetailPair = (next: { from?: string; to?: string }) => {
    if (!detailRoute) return;
    const from = next.from ?? fromStop;
    const to = next.to ?? toStop;
    const dir = from && to ? (getImpliedDirection(from, to, stopsByRoute, detailRoute.id) ?? stopsDirection) : stopsDirection;
    updateDetailUrl({ stop: from || undefined, to: to || undefined, dir, time: undefined });
  };

  /**
   * Тап по зупинці таймлайну: перший ставить «Звідки», другий — «Куди», наступний починає нову пару;
   * повторний тап по «Звідки» скидає пару, по «Куди» — лише «Куди».
   */
  const pickTimelineStop = (stopKey: string) => {
    const route_id = detailRoute?.id ?? '';
    if (stopKey === fromStop) {
      gaTrackEvent('transport_timeline_pick', { route_id, action: 'clear_from' });
      updateDetailUrl({ stop: undefined, to: undefined, time: undefined, dir: stopsDirection });
      return;
    }
    if (stopKey === toStop) {
      gaTrackEvent('transport_timeline_pick', { route_id, action: 'clear_to' });
      setDetailPair({ to: '' });
      return;
    }
    if (!fromStop) {
      gaTrackEvent('transport_timeline_pick', { route_id, action: 'from' });
      setDetailPair({ from: stopKey });
      return;
    }
    if (!toStop) {
      gaTrackEvent('transport_timeline_pick', { route_id, action: 'to' });
      setDetailPair({ to: stopKey });
      return;
    }
    gaTrackEvent('transport_timeline_pick', { route_id, action: 'restart' });
    setDetailPair({ from: stopKey, to: '' });
  };

  /** Чіп стрічки відправлень або рядок таблиці закріплює рейс (`time` = час на «Звідки») */
  const pickDeparture = (row: { dep: string; direction: 'there' | 'back' }, source: 'strip' | 'table') => {
    gaTrackEvent('transport_departure_pick', { route_id: detailRoute?.id ?? '', dir: row.direction, source });
    updateDetailUrl({ time: row.dep, dir: row.direction });
  };

  /**
   * Перемикач «Туди/Назад»: пара переїздить у новий напрямок (міняється місцями; зупинки, якої там
   * немає, — найближча за координатами), `time` скидається — обраним стає найближчий рейс до опорного часу.
   */
  const reverseDirectionAndFromTo = (targetDir?: 'there' | 'back', source: 'toggle' | 'map' = 'toggle') => {
    const newDir: 'there' | 'back' = targetDir ?? (stopsDirection === 'there' ? 'back' : 'there');
    gaTrackEvent('transport_direction', { route_id: detailRoute?.id ?? '', dir: newDir, source });
    const routeStops = detailRoute ? stopsByRoute?.[detailRoute.id] : undefined;
    if (!detailRoute || !Array.isArray(routeStops) || routeStops.length === 0 || !fromStop) {
      updateDetailUrl({ dir: newDir, time: undefined });
      return;
    }
    const first = routeStops[0];
    const stopsWithOrder: RouteStopWithOrder[] =
      first && typeof first === 'object' && 'name' in first
        ? (routeStops as RouteStopWithOrder[])
        : (routeStops as unknown as string[]).map((name, i, arr) => ({
            name,
            order_there: i + 1,
            order_back: arr.length - i,
            belongs_to: 'both' as const,
          }));
    const orderKey = newDir === 'there' ? 'order_there' : 'order_back';
    const ordered = [...stopsWithOrder]
      .filter((s) => (s.belongs_to ?? 'both') !== (newDir === 'there' ? 'back' : 'there') && (s[orderKey] ?? 0) > 0)
      .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
    if (!ordered.length) {
      updateDetailUrl({ dir: newDir, time: undefined });
      return;
    }
    const inList = (raw: string, list: RouteStopWithOrder[]) => {
      const id = resolveStopIdInList(raw, list.map((s) => getStopKey(s)), stopsCatalog);
      return id && list.some((s) => getStopKey(s) === id) ? id : null;
    };
    // Зворотний напрямок: «Куди» стає «Звідки» і навпаки; сама лише «Звідки» лишається «Звідки»
    const fromRaw = toStop || fromStop;
    const toRaw = toStop ? fromStop : '';
    const newFrom = inList(fromRaw, ordered) ?? findNearestStopInList(fromRaw, ordered, stopsCoords) ?? getStopKey(ordered[0]);
    const fromOrder = ordered.find((s) => getStopKey(s) === newFrom)?.[orderKey] ?? 0;
    const after = ordered.filter((s) => (s[orderKey] ?? 0) > fromOrder);
    const newTo =
      toRaw && after.length
        ? (inList(toRaw, after) ?? findNearestStopInList(toRaw, after, stopsCoords) ?? getStopKey(after[0]))
        : '';
    updateDetailUrl({ stop: newFrom, to: newTo || undefined, dir: newDir, time: undefined });
  };

  /** Прокрутити до результатів під sticky-формою (на мобільному форма ховає видачу). */
  const scrollToResults = useCallback(() => {
    const el = resultsRef.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const stickyHeight = searchCardRef.current?.offsetHeight ?? 0;
    el.style.scrollMarginTop = `${stickyHeight + 8}px`;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  // Стрічка відправлень: натиснутий чіп — у видимій частині (лише горизонтальна прокрутка стрічки)
  useEffect(() => {
    if (!isDetailPage) return;
    const chip = document.querySelector<HTMLElement>('.lt-departure-chip[aria-pressed="true"]');
    const strip = chip?.parentElement;
    if (!chip || !strip || typeof strip.scrollTo !== 'function') return;
    try {
      strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
    } catch {
      /* старі браузери без options */
    }
  }, [isDetailPage, selectedTripTime, stopsDirection, fromStop, toStop]);

  // Кнопки «Знайти» немає — видача жива, тож нова пара мʼяко прокручує до результатів.
  // Пара з адресного рядка при відкритті сторінки не прокручує: людина ще нічого не обирала.
  const skipResultsScrollRef = useRef(Boolean(fromPathDecoded && toPathDecoded));
  useEffect(() => {
    if (!isMainPage || !committedPair) return;
    if (skipResultsScrollRef.current) {
      skipResultsScrollRef.current = false;
      return;
    }
    scrollToResults();
  }, [isMainPage, committedPair, scrollToResults]);

  /** Гео-кнопка у полі «Звідки» (слот trailing Combobox) — видима, поки поле порожнє */
  const geoInlineButton = (
    <button
      type="button"
      className="lt-geo-inline"
      onClick={handleFindNearest}
      disabled={geoLoading}
      aria-busy={geoLoading}
      aria-label="Знайти найближчі зупинки за геолокацією"
      title="Найближчі зупинки за вашою геолокацією"
    >
      <GeoIcon />
    </button>
  );

  /** Чіпи швидкого старту: вузол схеми → перша його зупинка, що є в датасеті */
  const quickNodes = useMemo(
    () =>
      QUICK_NODES.map((node) => ({ node, stopId: node.stopIds.find((id) => stops.includes(id)) })).filter(
        (q): q is { node: SchemeNode; stopId: string } => Boolean(q.stopId)
      ),
    [stops]
  );
  /** Чіп вузла ставить «Куди», а якщо «Куди» вже є — «Звідки» (ті самі сетери, що й поля) */
  const pickQuickNode = (node: SchemeNode, stopId: string) => {
    gaTrackEvent('transport_quick_node', { node_id: node.id, kind: node.kind, slot: resolvedTo ? 'from' : 'to' });
    if (!resolvedTo) {
      setSearchTo(stopId);
      return;
    }
    setSearchFrom(stopId);
    latestStopRef.current = stopId;
    setStopFilter(stopId);
  };

  const handleSelectRoute = (id: string) => {
    const routeStopIds = stopsByRoute?.[id] ? getStopKeysFromRouteStops(stopsByRoute[id], stopsCatalog) : [];
    const fromResolved = committedPair
      ? committedPair.from
      : latestStopRef.current || effectiveStopFilter
        ? resolveStopIdInList(latestStopRef.current || effectiveStopFilter, stops, stopsCatalog)
        : '';
    const toResolved = committedPair ? committedPair.to : '';
    const fromOnRoute = fromResolved && routeStopIds.includes(fromResolved) ? fromResolved : null;
    const toOnRoute = toResolved && routeStopIds.includes(toResolved) ? toResolved : null;
    const params = new URLSearchParams();
    if (searchDate) params.set('d', searchDate);
    if (searchTime) params.set('h', searchTime);
    if (fromOnRoute && toOnRoute) {
      params.set('stop', fromOnRoute);
      params.set('to', toOnRoute);
      const dir = getImpliedDirection(fromOnRoute, toOnRoute, stopsByRoute, id);
      if (dir) params.set('dir', dir);
    }
    navigate(`/transport/route/${id}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleBack = () => {
    if (isDetailPage && selectedStopFromUrl && toFromUrl) {
      const params = new URLSearchParams();
      params.set('d', dateFromUrl || formatDateUrl(new Date()));
      params.set('h', timeFromUrl || hourFromUrl || '12:00');
      navigate(`/transport/${encodeURIComponent(selectedStopFromUrl)}/${encodeURIComponent(toFromUrl)}?${params.toString()}`);
    } else if (isDetailPage && selectedStopFromUrl) {
      // Картка табло дає лише stop (без to) — повертаємось на табло цієї зупинки
      const params = new URLSearchParams();
      params.set('d', dateFromUrl || formatDateUrl(new Date()));
      params.set('h', hourFromUrl || timeFromUrl || searchTime);
      navigate(`/transport/stop/${encodeURIComponent(selectedStopFromUrl)}?${params.toString()}`);
    } else if (isMainPage && hasPathSearch) {
      navigate(buildPlannerUrl(resolvedFrom || fromPathDecoded, resolvedTo || toPathDecoded, searchDate, searchTime));
    } else {
      const stop = selectedStopFromUrl || effectiveStopFilter;
      navigate(stop ? `/transport?stop=${encodeURIComponent(stop)}` : '/transport');
    }
  };

  if (loading) {
    return (
      <div className="lt-page">
        <div className="lt-container">
          <p className="lt-loading">Завантаження...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="lt-page">
        <div className="lt-container">
          <div className="lt-error">
            <p>{error || 'Дані не завантажені'}</p>
          </div>
        </div>
      </div>
    );
  }

  const fareAmount =
    typeof data.supplement?.fare?.amount === 'number' ? data.supplement.fare.amount : null;

  return (
    <div className="lt-page lt-layout">
      <div className="lt-container lt-split-layout">
        {routeId && detailRoute ? (
          <>
          <div className="lt-panel">
          <div className="lt-detail">
            {/* Такий самий хедер як на головній */}
            <header className="lt-header">
              <button type="button" className="lt-back lt-back--header" onClick={handleBack} aria-label="Назад до пошуку">
                ←
              </button>
              <div className="lt-header-title-wrap">
                {/* Декоративний заголовок: єдиний h1 сторінки маршруту — назва лінії нижче */}
                <p className="lt-title">Як доїхати</p>
                <p className="lt-subtitle">Маршрут №{detailRoute.id} · Малин</p>
              </div>
            </header>

            <LocalTransportSubNav
              searchDate={dateFromUrl || searchDate || formatDateUrl(new Date())}
              searchTime={hourFromUrl || timeFromUrl || searchTime}
              fromStopId={selectedStopFromUrl || undefined}
            />

            {/* Заголовок маршруту + перемикач напрямку */}
            <header className="lt-detail-header">
              <div className="lt-detail-header-top">
                <h1 className="lt-route-title">
                  <span
                    className={`lt-route-num ${isVerifiedRoute(detailRoute.id) ? 'lt-route-num--verified' : 'lt-route-num--unverified'}`}
                    style={routeColorStyle(detailRoute.id)}
                  >
                    №{detailRoute.id}
                  </span>
                  <span className="lt-route-title-path">
                    {stopsDirection === 'there'
                      ? routeLine(detailRoute)
                      : routeLine(detailRoute, true)}
                  </span>
                </h1>
                {fareAmount != null && (
                  <span className="lt-chip lt-chip--static lt-fare-chip" aria-label={`Проїзд ${fareAmount} гривень`}>
                    <span className="lt-fare-chip__label">проїзд</span>
                    {fareAmount} ₴
                  </span>
                )}
              </div>
              <div className="lt-detail-header-actions">
                <div className="lt-direction-toggle" role="group" aria-label="Напрямок руху">
                  <button
                    type="button"
                    className={`lt-direction-btn ${stopsDirection === 'there' ? 'lt-direction-btn--active' : ''}`}
                    aria-pressed={stopsDirection === 'there'}
                    title={detailRoute.to ? `Туди: ${detailRoute.to}` : 'Туди'}
                    onClick={() => reverseDirectionAndFromTo('there')}
                  >
                    Туди
                  </button>
                  <button
                    type="button"
                    className={`lt-direction-btn ${stopsDirection === 'back' ? 'lt-direction-btn--active' : ''}`}
                    aria-pressed={stopsDirection === 'back'}
                    title={detailRoute.from ? `Назад: ${detailRoute.from}` : 'Назад'}
                    onClick={() => reverseDirectionAndFromTo('back')}
                  >
                    Назад
                  </button>
                </div>
                {isPhone && (
                  <button type="button" className="lt-chip lt-chip--map" onClick={() => openMap('route', Boolean(fromStop && toStop))}>
                    Карта
                  </button>
                )}
              </div>
            </header>

            {detailRoute.trips.length > 0 && (() => {
              const routeStops = stopsByRoute?.[detailRoute.id];
              let stopsWithOrder: RouteStopWithOrder[] | null = null;
              if (Array.isArray(routeStops) && routeStops.length > 0) {
                const first = routeStops[0];
                if (first && typeof first === 'object' && 'name' in first) {
                  stopsWithOrder = routeStops as RouteStopWithOrder[];
                } else {
                  const names = routeStops as unknown as string[];
                  stopsWithOrder = names.map((name, i) => ({
                    name,
                    order_there: i + 1,
                    order_back: names.length - i,
                    belongs_to: 'both' as const,
                  }));
                }
              }
              const orderedStopsThere = stopsWithOrder
                ? [...stopsWithOrder]
                    .filter((s) => (s.belongs_to ?? 'both') !== 'back' && s.order_there > 0)
                    .sort((a, b) => a.order_there - b.order_there)
                : [];
              const orderedStopsBack = stopsWithOrder
                ? [...stopsWithOrder]
                    .filter((s) => (s.belongs_to ?? 'both') !== 'there' && s.order_back > 0)
                    .sort((a, b) => a.order_back - b.order_back)
                : [];
              const routeId = detailRoute.id;
              const orderedKeysThere = orderedStopsThere.map((s) => getStopKey(s));
              const orderedKeysBack = orderedStopsBack.map((s) => getStopKey(s));

              /**
               * Рядок на рейс між обраними З/До (або початком/кінцем самого рейсу).
               * Рейси, що не обслуговують пару (скорочені, з іншої початкової), пропускаються.
               */
              type TableRow = {
                dep: string;
                arr: string;
                direction: 'there' | 'back';
                baseTime: number;
                tripId: string;
                /** Зупинка, на якій показано `dep` («Звідки» або перша зупинка рейсу) */
                fromKey: string;
                toKey: string;
              };
              const buildTableTrips = (): TableRow[] | null => {
                if (!stopsWithOrder) return null;
                const { dir0, dir1 } = groupTripsByDirection(detailRoute.trips);
                const rows: TableRow[] = [];
                const pushRows = (list: TransportRecord[], direction: 'there' | 'back', chain: string[]) => {
                  if (chain.length < 2) return;
                  list.forEach((t) => {
                    const timing = recordTiming(routeId, chain, t);
                    if (!timing) return;
                    const fromKey = fromStop || timing.stops[0].stopId;
                    const toKey = toStop || timing.stops[timing.stops.length - 1].stopId;
                    if (!tripServesPair(timing, fromKey, toKey)) return;
                    const depMins = minutesAtStop(timing, fromKey);
                    const arrMins = minutesAtStop(timing, toKey);
                    if (depMins == null || arrMins == null) return;
                    rows.push({
                      dep: formatTime(depMins),
                      arr: formatTime(arrMins),
                      direction,
                      baseTime: tripDepartureMinutes(t),
                      tripId: t.trip_id,
                      fromKey,
                      toKey,
                    });
                  });
                };
                pushRows(dir1, 'there', orderedKeysThere);
                pushRows(dir0, 'back', orderedKeysBack);
                return rows.length ? rows.sort((a, b) => a.dep.localeCompare(b.dep)) : null;
              };

              const tableTrips = buildTableTrips();
              const routeDayOffset = dateFromUrl ? searchDateKyivOffsetDays(dateFromUrl) : 0;
              /** Довге натискання на чіп відправлення → «Факт прибуття» на зупинці «Звідки» */
              const arrivalPress = (row: TableRow) =>
                isReportableStopId(row.fromKey)
                  ? longPress(() => {
                      gaTrackEvent('transport_arrival_open', { route_id: routeId, source: 'route' });
                      setArrivalTarget({
                        routeId,
                        tripId: row.tripId,
                        direction: row.direction,
                        stopId: row.fromKey,
                        scheduledTime: row.dep,
                        stopName: displayNameForStopKey(row.fromKey, stopsCatalog),
                        destination: displayNameForStopKey(row.toKey, stopsCatalog),
                        source: 'route',
                      });
                    })
                  : {};
              const tableTripsInDirection =
                tableTrips && stopsDirection
                  ? tableTrips.filter((r) => r.direction === stopsDirection)
                  : tableTrips;

              return (
                <>
                  {/* Розклад руху: чіпи дати/часу, стрічка відправлень (час на «Звідки»), повна таблиця */}
                  <section className="lt-timetable-section lt-timetable-section--compact" aria-labelledby="lt-rozklad-heading">
                    <div className="lt-section-head">
                      <h2 id="lt-rozklad-heading" className="lt-section-title">Розклад руху</h2>
                      <button type="button" className="lt-print-btn lt-print-btn--compact" onClick={() => { gaTrackEvent('transport_print', { route_id: detailRoute.id }); window.print(); }} title="Друк">
                        Друк
                      </button>
                    </div>
                    <div className="lt-search-chips lt-route-chips">
                      <DateTimeControls
                        idPrefix="lt-route"
                        page="route"
                        date={dateFromUrl || todayDateUrl()}
                        time={hourFromUrl || nowClock()}
                        onChange={({ date, time }) => updateDetailUrl({ d: date, h: time, time: undefined })}
                      />
                    </div>
                    {tableTripsInDirection && tableTripsInDirection.length > 0 ? (
                      <div className="lt-departures" role="group" aria-label="Відправлення за день">
                        {tableTripsInDirection.map((row, i) => {
                          const pressed = selectedTripTime === row.baseTime && selectedTripDirection === row.direction;
                          return (
                            <button
                              key={`${row.dep}-${row.arr}-${i}`}
                              type="button"
                              className="lt-chip lt-departure-chip lt-long-press"
                              aria-pressed={pressed}
                              onClick={() => pickDeparture(row, 'strip')}
                              {...arrivalPress(row)}
                            >
                              <span className="lt-departure-chip__dep">{row.dep}</span>
                              {fromStop && toStop ? <span className="lt-departure-chip__arr">→ {row.arr}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="lt-empty lt-empty--inline">У цьому напрямку між обраними зупинками рейсів немає.</p>
                    )}
                    {routeDayOffset === 0 && !isPrerendering() && tableTripsInDirection && tableTripsInDirection.length > 0 ? (
                      <p className="lt-arrival-tip">
                        Автобус приїхав не за розкладом або не приїхав? Утримайте його час — позначимо факт.
                      </p>
                    ) : null}
                    <ArrivalReportSheet target={arrivalTarget} isToday={routeDayOffset === 0} onClose={closeArrival} />
                    <button
                      type="button"
                      className="lt-chip lt-chip--small lt-timetable-toggle"
                      aria-expanded={timetableOpen}
                      aria-controls="lt-timetable-full"
                      onClick={() => {
                        gaTrackEvent('transport_timetable_toggle', { route_id: detailRoute.id, open: !timetableOpen });
                        setTimetableOpen(!timetableOpen);
                      }}
                    >
                      Повний розклад
                    </button>
                    {tableTripsInDirection && tableTripsInDirection.length > 0 && (
                      <div id="lt-timetable-full" className={`lt-timetable ${timetableOpen ? '' : 'lt-timetable--collapsed'}`}>
                        <table className="lt-timetable-table lt-timetable-table--tablica">
                          <thead>
                            <tr>
                              <th>
                                Відправлення
                                {fromStop ? (
                                  <span className="lt-th-stop">
                                    {' '}
                                    ({displayNameForStopKey(fromStop, stopsCatalog)})
                                  </span>
                                ) : null}
                              </th>
                              <th>
                                Прибуття
                                {toStop ? (
                                  <span className="lt-th-stop">
                                    {' '}
                                    ({displayNameForStopKey(toStop, stopsCatalog)})
                                  </span>
                                ) : null}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableTripsInDirection.map((row, i) => {
                              const isSelected =
                                selectedTripTime === row.baseTime && selectedTripDirection === row.direction;
                              return (
                                <tr
                                  key={`${row.dep}-${row.arr}-${i}`}
                                  className={`lt-timetable-row-clickable ${isSelected ? 'lt-timetable-row--selected' : ''}`}
                                  onClick={() => pickDeparture(row, 'table')}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      pickDeparture(row, 'table');
                                    }
                                  }}
                                >
                                  <td className="lt-time-cell lt-time-cell--tablica">{row.dep}</td>
                                  <td className="lt-time-cell lt-time-cell--tablica">{row.arr}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              );
            })()}
            {routeColor(detailRoute.id) && (
              <LocalTransportSchemeMini
                source="route"
                routeIds={[detailRoute.id]}
                href={buildSchemeUrl({
                  route: detailRoute.id,
                  date: dateFromUrl || searchDate || formatDateUrl(new Date()),
                  time: hourFromUrl || timeFromUrl || searchTime,
                })}
                label={`Відкрити схему маршрутів: маршрут №${detailRoute.id}`}
              />
            )}
            {(() => {
              const routeStops = stopsByRoute?.[detailRoute.id];
              let stopsWithOrder: RouteStopWithOrder[] | null = null;
              if (Array.isArray(routeStops) && routeStops.length > 0) {
                const first = routeStops[0];
                if (first && typeof first === 'object' && 'name' in first) {
                  stopsWithOrder = routeStops as RouteStopWithOrder[];
                } else {
                  const names = routeStops as unknown as string[];
                  stopsWithOrder = names.map((name, i) => ({
                    name,
                    order_there: i + 1,
                    order_back: names.length - i,
                    belongs_to: 'both' as const,
                  }));
                }
              }
              let mapStopNames: string[] = [];
              if (stopsWithOrder) {
                const isThere = stopsDirection === 'there';
                const orderKey = isThere ? 'order_there' : 'order_back';
                const allowed = [...stopsWithOrder].filter(
                  (s) => (s.belongs_to ?? 'both') !== (isThere ? 'back' : 'there')
                );
                const included = allowed
                  .filter((s) => (s[orderKey] ?? 0) > 0)
                  .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
                mapStopNames = included.map((s) => getStopKey(s));
              }
              return stopsWithOrder && mapStopNames.length > 0 ? (
                <section className="lt-map-stops" aria-labelledby="lt-stops-heading">
                  <div className="lt-map-stops-inner">
                    <div className="lt-stops">
                      <div className="lt-stops-head">
                        <h2 id="lt-stops-heading" className="lt-stops-heading">Зупинки</h2>
                        {fromStop ? (
                          <button
                            type="button"
                            className="lt-chip lt-chip--small"
                            onClick={() => {
                              gaTrackEvent('transport_timeline_pick', { route_id: detailRoute.id, action: 'reset' });
                              updateDetailUrl({ stop: undefined, to: undefined, time: undefined, dir: stopsDirection });
                            }}
                          >
                            Скинути
                          </button>
                        ) : (
                          <p className="lt-stops-hint">Торкніться зупинки: спершу «Звідки», потім «Куди»</p>
                        )}
                      </div>
                      <div ref={timelineRef} className="lt-stops-timeline" style={routeColorStyle(detailRoute.id)}>
                        {segmentStyle && (
                          <div
                            className="lt-stops-timeline-segment"
                            style={{ top: segmentStyle.top, height: segmentStyle.height }}
                          />
                        )}
                        {(() => {
                          const isThere = stopsDirection === 'there';
                          const filtered = [...stopsWithOrder]
                            .filter((s) => (s.belongs_to ?? 'both') !== (isThere ? 'back' : 'there'))
                            .filter((s) => (isThere ? s.order_there : s.order_back) > 0)
                            .sort((a, b) => (isThere ? a.order_there - b.order_there : a.order_back - b.order_back));
                          const listStops = getRealStops(filtered);
                          const orderKey = isThere ? 'order_there' : 'order_back';
                          const orderedKeysStops = filtered.map((s) => getStopKey(s));
                          // Часи на зупинках — для обраного рейсу; без нього — перший рейс дня по всій лінії
                          const timing = selectedTrip
                            ? recordTiming(detailRoute.id, orderedKeysStops, selectedTrip.record)
                            : computeTripTiming(orderedKeysStops, segSecForRoute(detailRoute.id), {
                                departureMins: getFirstTripTime(detailRoute.trips),
                              });
                          const boardQuery = `?d=${encodeURIComponent(dateFromUrl || formatDateUrl(new Date()))}&h=${encodeURIComponent(hourFromUrl || timeFromUrl || searchTime)}`;
                          return (
                            <ul className="lt-stops-list">
                              {listStops.map((s, idx) => {
                                const key = getStopKey(s);
                                const name = displayNameForStopKey(key, stopsCatalog);
                                const order = s[orderKey];
                                const arrivalMins = minutesAtStop(timing, key);
                                const served = arrivalMins != null;
                                const nextRealStop = listStops[idx + 1];
                                const nextArrivalMins = nextRealStop ? minutesAtStop(timing, getStopKey(nextRealStop)) : null;
                                const minsToNext =
                                  arrivalMins != null && nextArrivalMins != null ? nextArrivalMins - arrivalMins : null;
                                const isFrom = fromStop === key;
                                const isTo = toStop === key;
                                const pickTitle = isFrom
                                  ? 'Скинути пару'
                                  : isTo
                                    ? 'Зняти «Куди»'
                                    : !fromStop
                                      ? 'Звідси'
                                      : !toStop
                                        ? 'Сюди'
                                        : 'Звідси (нова пара)';
                                return (
                                  <li
                                    key={`${isThere ? 'there' : 'back'}-${key}-${order}`}
                                    ref={isFrom ? youHereRef : isTo ? toStopRef : undefined}
                                    className={`lt-stop-item ${isFrom ? 'lt-stop-item--from' : ''} ${isTo ? 'lt-stop-item--to' : ''} ${served ? '' : 'lt-stop-item--unserved'}`}
                                    aria-label={served ? undefined : 'Цей рейс тут не зупиняється'}
                                  >
                                    <span className="lt-stop-time">{arrivalMins != null ? formatTime(arrivalMins) : '—'}</span>
                                    <span className="lt-stop-content">
                                      <button
                                        type="button"
                                        className="lt-stop-pick"
                                        onClick={() => pickTimelineStop(key)}
                                        aria-pressed={isFrom || isTo}
                                        title={pickTitle}
                                      >
                                        {name}
                                      </button>
                                      {isFrom && <span className="lt-stop-badge lt-stop-badge--from">Звідки</span>}
                                      {isTo && <span className="lt-stop-badge lt-stop-badge--to">Куди</span>}
                                    </span>
                                    <Link
                                      className="lt-stop-board-link"
                                      to={`/transport/stop/${encodeURIComponent(key)}${boardQuery}`}
                                      aria-label={`Табло зупинки «${name}»`}
                                    >
                                      Табло
                                    </Link>
                                    <span className="lt-stop-to-next">
                                      {minsToNext != null ? formatWait(Math.max(1, Math.round(minsToNext))) : '—'}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null;
            })()}
          </div>
            <footer className="lt-footer">
              <a href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36" target="_blank" rel="noopener noreferrer">data.gov.ua</a>
              {' · '}
              <a href="tel:+380687771590">(068) 77-71-590</a>
            </footer>
          </div>
            {(() => {
              const mapProps = {
                stopNames: mapStopNamesToShow,
                markerStopNames: detailMapStopNamesForMarkers,
                fromStopName: fromStop || undefined,
                toStopName: toStop || undefined,
                resolveStopLabel: (k: string) => displayNameForStopKey(k, stopsCatalog),
                routeLines: detailLine,
                highlightRouteIds: [detailRoute.id],
                nodeStopIds: NODE_STOP_IDS,
                routesAtStop: linesAtStop,
                boardHref: boardHrefFor,
                onPickFromStop: (stopName: string) => {
                  gaTrackEvent('transport_map_pick', { page: 'route', slot: 'from' });
                  setDetailPair({ from: stopName });
                },
                onPickToStop: (stopName: string) => {
                  gaTrackEvent('transport_map_pick', { page: 'route', slot: 'to' });
                  rememberFrequentToStop(stopName);
                  setDetailPair({ to: stopName });
                },
                onSwapStops: () => reverseDirectionAndFromTo(undefined, 'map'),
                frequentToStops,
                coordsData: mapCoordsData,
              };
              return isPhone ? (
                <LocalTransportMapOverlay open={mapOpen} onClose={closeMap} subtitle={`Маршрут №${detailRoute.id}`}>
                  <RouteMap {...mapProps} resizeToken={mapResizeToken} />
                </LocalTransportMapOverlay>
              ) : (
                <div className="lt-map-column">
                  <RouteMap {...mapProps} showStrip />
                </div>
              );
            })()}
          </>
        ) : (
          <>
          <div className="lt-panel">
          <>
            <header className="lt-header">
              <h1 className="lt-title">{pairNames ? `${pairNames.from} → ${pairNames.to}` : 'Як доїхати'}</h1>
              <p className="lt-subtitle">{pairNames ? 'Як доїхати · Малин' : 'Малин · місцевий транспорт'}</p>
            </header>

            <LocalTransportSubNav searchDate={searchDate} searchTime={searchTime} fromStopId={resolvedFrom || undefined} />

            <div className="lt-search" ref={searchCardRef}>
              <div className="lt-from-to-block">
                <div className="lt-from-to-row">
                  <div className="lt-from-to-cell lt-from-to-cell--from">
                    <label className="lt-from-to-label lt-from-to-label--with-icon" htmlFor="lt-search-from">
                      <span className="lt-from-to-dot lt-from-to-dot--from" aria-hidden />
                      <span className="lt-visually-hidden">Звідки</span>
                    </label>
                    <Combobox
                      id="lt-search-from"
                      label=""
                      options={[
                        { value: '', label: '— Зупинка —' },
                        ...stops.map((s) => ({ value: s, label: displayNameForStopKey(s, stopsCatalog) })),
                      ]}
                      value={effectiveSearchFrom}
                      onChange={(v) => {
                        setSearchFrom(v);
                        latestStopRef.current = v;
                        setStopFilter(v);
                      }}
                      onClear={() => {
                        // Лише кнопка «×»: скидаємо пару і URL; «До» переживає очищення через ?to=
                        setSearchFrom('');
                        setCommittedPair(null);
                        const params = new URLSearchParams();
                        if (resolvedTo) params.set('to', resolvedTo);
                        if (searchDate) params.set('d', searchDate);
                        if (searchTime) params.set('h', searchTime);
                        navigate(`/transport${params.toString() ? `?${params.toString()}` : ''}`, { replace: true });
                      }}
                      placeholder="Звідки їдемо?"
                      emptyMessage="Зупинок не знайдено"
                      clearable
                      inputRef={searchFromInputRef}
                      trailing={geoInlineButton}
                      onSelectOption={(selected) => {
                        if (!selected) return;
                        window.setTimeout(() => searchToInputRef.current?.focus(), 0);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className={`lt-from-to-swap ${isSwapAnimating ? 'lt-from-to-swap--animating' : ''}`}
                    onClick={() => {
                      setIsSwapAnimating(true);
                      gaTrackEvent('transport_swap', { source: 'form' });
                      // URL підтягнеться автосинхронізацією пари → адресний рядок.
                      setSearchFrom(resolvedTo || effectiveSearchTo);
                      setSearchTo(resolvedFrom || effectiveSearchFrom);
                      window.setTimeout(() => setIsSwapAnimating(false), 220);
                    }}
                    title="Поміняти місцями"
                    aria-label="Поміняти місцями"
                  >
                    ⇅
                  </button>
                  <div className="lt-from-to-cell lt-from-to-cell--to">
                    <label className="lt-from-to-label lt-from-to-label--with-icon" htmlFor="lt-search-to">
                      <span className="lt-from-to-dot lt-from-to-dot--to" aria-hidden />
                      <span className="lt-visually-hidden">Куди</span>
                    </label>
                    <Combobox
                      id="lt-search-to"
                      label=""
                      options={[
                        { value: '', label: '— Зупинка —' },
                        ...stops.map((s) => ({ value: s, label: displayNameForStopKey(s, stopsCatalog) })),
                      ]}
                      value={effectiveSearchTo}
                      onChange={(v) => {
                        setSearchTo(v);
                      }}
                      onClear={() => {
                        setSearchTo('');
                        setCommittedPair(null);
                        const params = new URLSearchParams();
                        if (resolvedFrom) params.set('from', resolvedFrom);
                        if (searchDate) params.set('d', searchDate);
                        if (searchTime) params.set('h', searchTime);
                        navigate(`/transport${params.toString() ? `?${params.toString()}` : ''}`, { replace: true });
                      }}
                      placeholder="Куди їдемо?"
                      emptyMessage="Зупинок не знайдено"
                      clearable
                      inputRef={searchToInputRef}
                    />
                  </div>
                </div>
                <div className="lt-search-chips">
                  <DateTimeControls
                    date={searchDate}
                    time={searchTime}
                    page="planner"
                    onChange={({ date, time }) => {
                      setSearchDate(date);
                      setSearchTime(time);
                    }}
                  />
                  {isPhone && (
                    <button type="button" className="lt-chip lt-chip--map" onClick={() => openMap('planner', Boolean(committedPair))}>
                      Карта
                    </button>
                  )}
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
                            <button
                              type="button"
                              className="lt-nearest-item"
                              onClick={() => {
                                gaTrackEvent('transport_nearest_pick', { page: 'planner', stop: name, distance_m: Math.round(distance) });
                                latestStopRef.current = name;
                                setSearchFrom(name);
                                setStopFilter(name);
                                clearNearestStops();
                                // Зупинка стала «Звідки» — далі логічно обрати «Куди»
                                window.setTimeout(() => searchToInputRef.current?.focus(), 0);
                              }}
                            >
                              {displayNameForStopKey(name, stopsCatalog)} — {formatDistance(distance)}
                            </button>
                            <Link
                              className="lt-nearest-tablo-link"
                              to={`/transport/stop/${encodeURIComponent(name)}?d=${encodeURIComponent(searchDate)}&h=${encodeURIComponent(searchTime)}`}
                            >
                              Табло
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lt-routes" ref={resultsRef}>
              {showFormHint && (
                <p className="lt-routes-hint" role="status">
                  {pairIsSame ? 'Зупинки «Звідки» і «Куди» однакові — оберіть іншу.' : 'Оберіть зупинку зі списку.'}
                </p>
              )}
              {!committedPair ? (
                !showFormHint && (
                  <div className="lt-empty">
                    {!resolvedFrom && !resolvedTo && (
                      <p className="lt-empty-text">
                        Оберіть зупинки «Звідки» та «Куди» у формі вище або на карті — маршрути з’являться одразу.
                      </p>
                    )}
                    <p className="lt-quick-title">
                      {resolvedTo && !resolvedFrom
                        ? 'Тепер оберіть «Звідки»'
                        : resolvedFrom && !resolvedTo
                          ? 'Тепер оберіть «Куди»'
                          : 'Куди їдете?'}
                    </p>
                    <div className="lt-quick-chips">
                      {!resolvedFrom && (
                        <button
                          type="button"
                          className="lt-chip"
                          onClick={handleFindNearest}
                          disabled={geoLoading}
                          aria-busy={geoLoading}
                        >
                          {geoLoading ? 'Шукаємо…' : 'Поруч зі мною'}
                        </button>
                      )}
                      {quickNodes
                        .filter(
                          ({ node }) =>
                            !(resolvedFrom && node.stopIds.includes(resolvedFrom)) &&
                            !(resolvedTo && node.stopIds.includes(resolvedTo))
                        )
                        .map(({ node, stopId }) => (
                          <button key={node.id} type="button" className="lt-chip" onClick={() => pickQuickNode(node, stopId)}>
                            {node.name}
                          </button>
                        ))}
                    </div>
                    <button type="button" className="lt-empty-map-btn" onClick={() => openMap('planner', false)}>
                      Відкрити карту
                    </button>
                    <LocalTransportSchemeMini
                      showAll
                      routeIds={[]}
                      href={buildSchemeUrl({ date: searchDate, time: searchTime })}
                      label="Відкрити схему маршрутів"
                      title="Уся схема"
                      source="planner"
                    />
                  </div>
                )
              ) : routesConnectingFromTo.length === 0 ? (
                <div className="lt-no-routes" role="status">
                  <p>Між цими зупинками немає прямого маршруту.</p>
                  {nearbyAlternatives.length > 0 && (
                    <div className="lt-nearby">
                      <p className="lt-nearby-title">Поруч є зупинки з прямим маршрутом:</p>
                      <ul className="lt-nearby-list">
                        {nearbyAlternatives.map((alt) => {
                          const walkFrom =
                            alt.changed === 'from'
                              ? displayNameForStopKey(committedPair.from, stopsCatalog)
                              : alt.changed === 'to'
                                ? displayNameForStopKey(committedPair.to, stopsCatalog)
                                : null;
                          const walk = walkFrom ? `${alt.walkMeters} м від «${walkFrom}»` : `${alt.walkMeters} м пішки разом`;
                          return (
                            <li key={`${alt.from}-${alt.to}`}>
                              <button
                                type="button"
                                className="lt-nearby-item"
                                onClick={() => {
                                  gaTrackEvent('transport_nearby_pick', {
                                    from: alt.from,
                                    to: alt.to,
                                    changed: alt.changed,
                                    walk_m: alt.walkMeters,
                                  });
                                  // Стан → автосинхронізація URL → нова видача
                                  setSearchFrom(alt.from);
                                  setSearchTo(alt.to);
                                }}
                              >
                                <span className="lt-nearby-pair">
                                  {displayNameForStopKey(alt.from, stopsCatalog)} → {displayNameForStopKey(alt.to, stopsCatalog)}
                                </span>
                                <span className="lt-nearby-meta">
                                  {walk} · №{alt.routeIds.join(', №')}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <p className="lt-no-routes-hint">
                    Спробуйте інші зупинки на карті або відкрийте{' '}
                    <Link to={`/transport/stop?d=${encodeURIComponent(searchDate)}&h=${encodeURIComponent(searchTime)}`}>
                      табло зупинки
                    </Link>
                    .
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="lt-routes-heading" id="lt-results-heading">
                    Прямі маршрути: {displayNameForStopKey(committedPair.from, stopsCatalog)} →{' '}
                    {displayNameForStopKey(committedPair.to, stopsCatalog)}
                  </h2>
                  {(() => {
                    const fromId = committedPair.from;
                    const toId = committedPair.to;
                    const toLabel = displayNameForStopKey(toId, stopsCatalog);
                    const searchMins = (() => {
                      const [h, m] = searchTime.split(':').map(Number);
                      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : getKyivMinutesNow();
                    })();
                    const DAY = 24 * 60;
                    // Табло найближчих відправлень: картки за часом очікування, а не за номером маршруту.
                    // Час на зупинці «Звідки» рахується для кожного рейсу окремо (скорочені рейси, стиснення).
                    const cards = routesConnectingFromTo.map((r) => {
                      const dir = getImpliedDirection(fromId, toId, stopsByRoute, r.id) ?? 'there';
                      const upcoming = findUpcomingTrips(
                        r.trips,
                        searchMins,
                        dir,
                        {
                          routeId: r.id,
                          chainKeys: {
                            there: getOrderedStopKeys(r.id, 'there', stopsByRoute),
                            back: getOrderedStopKeys(r.id, 'back', stopsByRoute),
                          },
                          fromStop: fromId,
                          toStop: toId,
                        },
                        3
                      );
                      const nearest = upcoming[0] ?? null;
                      const dist = nearest ? (nearest.timeAtFrom - searchMins + DAY) % DAY : Infinity;
                      return { r, dir, upcoming, nearest, dist };
                    });
                    cards.sort((a, b) => a.dist - b.dist);
                    return cards.map(({ r, dir, upcoming, nearest }) => {
                      const nextTimeStr = nearest ? formatTime(nearest.timeAtFrom) : '—';
                      const arrivalStr = nearest?.timeAtTo != null ? formatTime(nearest.timeAtTo) : null;
                      const durationMins =
                        nearest?.timeAtTo != null ? Math.max(0, Math.round(nearest.timeAtTo - nearest.timeAtFrom)) : null;
                      const destination = nearest ? tripDestination(nearest.record, nearest.direction, r, stopsCatalog) : toLabel;
                      const verified = isVerifiedRoute(r.id);
                      // Підпис під часом: відлік від поточного часу (не від часу пошуку) і лише для сьогодні;
                      // після останнього рейсу — чесно кажемо, що показано перший рейс наступного дня.
                      let timeLabel = 'відправлення';
                      let timeLabelMod = '';
                      if (nearest?.wrapped) {
                        timeLabel = 'рейсів пізніше немає · перший наступного дня';
                        timeLabelMod = 'lt-route-card-time-label--wrapped';
                      } else if (nearest && travelDayOffset === 0) {
                        const delta = Math.round(nearest.timeAtFrom - kyivNowMins);
                        if (delta >= 0) {
                          timeLabel = `через ${formatWait(delta)}`;
                          timeLabelMod = 'lt-route-card-time-label--soon';
                        } else {
                          timeLabel = 'вже вирушив';
                        }
                      }
                      // «далі 09:40 · 10:55» — наступні рейси лінії; перший рейс із початку дня підписано «завтра»
                      // (коли й найближчий уже «наступного дня», усі далі теж — без повторного «завтра»).
                      const later = upcoming.slice(1);
                      const laterLabel = later
                        .map((t, i) => {
                          const firstWrapped = t.wrapped && !nearest?.wrapped && (i === 0 || !later[i - 1].wrapped);
                          return `${firstWrapped ? 'завтра ' : ''}${formatTime(t.timeAtFrom)}`;
                        })
                        .join(' · ');
                      const ariaLabel = [
                        `Маршрут №${r.id} до ${destination}`,
                        `відправлення ${nextTimeStr}`,
                        arrivalStr ? `прибуття ${arrivalStr}` : '',
                        durationMins != null ? `${durationMins} хвилин` : '',
                        timeLabel !== 'відправлення' ? timeLabel : '',
                        laterLabel ? `далі ${laterLabel}` : '',
                      ]
                        .filter(Boolean)
                        .join(', ');
                      return (
                        <button
                          key={`${r.id}-${dir}`}
                          type="button"
                          className="lt-route-card"
                          onClick={() => {
                            gaTrackEvent('transport_route_card_click', { route_id: r.id });
                            handleSelectRoute(r.id);
                          }}
                          aria-label={ariaLabel}
                        >
                          <div className="lt-route-card-time">
                            <span className="lt-route-card-time-value">{nextTimeStr}</span>
                            <span className={`lt-route-card-time-label ${timeLabelMod}`}>{timeLabel}</span>
                          </div>
                          <div className="lt-route-card-main">
                            <span
                              className={`lt-route-num lt-route-num--card ${verified ? 'lt-route-num--verified' : 'lt-route-num--unverified'}`}
                              style={routeColorStyle(r.id)}
                              title={verified ? 'Час між зупинками — з виміряних даних' : 'Час орієнтовний'}
                            >
                              №{r.id}
                            </span>
                            <span className="lt-route-destination">
                              <span aria-hidden>→ </span>
                              {destination}
                            </span>
                            {arrivalStr ? (
                              <span className="lt-route-card-times">
                                {nextTimeStr} → {arrivalStr}
                                {durationMins != null ? ` · ${durationMins} хв` : ''}
                              </span>
                            ) : null}
                            {laterLabel ? <span className="lt-route-card-next">далі {laterLabel}</span> : null}
                          </div>
                        </button>
                      );
                    });
                  })()}
                </>
              )}
            </div>
            <section className="lt-aeo" aria-labelledby="lt-aeo-routes">
              <h2 id="lt-aeo-routes" className="lt-aeo-title">
                Маршрути Малина
              </h2>
              <p className="lt-aeo-lead">
                Актуальний список міських ліній: розклад, зупинки й карта. Оберіть номер або скористайтеся
                планером «Звідки → Куди» вище.
              </p>
              {routes.length > 0 ? (
                <ul className="lt-aeo-route-list">
                  {routes.map((r) => (
                    <li key={r.id}>
                      <Link
                        className="lt-aeo-route-link"
                        to={`/transport/route/${encodeURIComponent(r.id)}`}
                        aria-label={routeTitle(r)}
                      >
                        <span className="lt-aeo-route-num" style={routeColorStyle(r.id)} aria-hidden>
                          {r.id}
                        </span>
                        <span className="lt-aeo-route-text">
                          {routeLine(r) ? <span className="lt-aeo-route-line">{routeLine(r)}</span> : null}
                          {SCHEME_VIA[r.id] ? <span className="lt-aeo-route-via">{SCHEME_VIA[r.id]}</span> : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lt-aeo-lead">Завантаження маршрутів…</p>
              )}
              <h2 id="lt-aeo-faq" className="lt-aeo-title">
                Часті питання
              </h2>
              <dl className="lt-aeo-faq">
                {TRANSPORT_HUB_FAQ.map((item) => (
                  <div key={item.q} className="lt-aeo-faq__item">
                    <dt>{item.q}</dt>
                    <dd>{item.a}</dd>
                  </div>
                ))}
              </dl>
              <p className="lt-aeo-more">
                Гід:{' '}
                <Link to="/support/transport">як їздити міським транспортом у Малині</Link>. Міжміські —{' '}
                <Link to="/mizhgorodski">/mizhgorodski</Link> ·{' '}
                <Link to="/support/travel">як доїхати до Малина</Link>.
              </p>
            </section>
            <footer className="lt-footer">
              <a href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36" target="_blank" rel="noopener noreferrer">data.gov.ua</a>
              {' · '}
              <a href="tel:+380687771590">(068) 77-71-590</a>
            </footer>
          </>
          </div>
          {(() => {
            const mapProps = {
              stopNames: stops,
              markerStopNames: stops,
              fromStopName: resolvedFrom || undefined,
              toStopName: resolvedTo || undefined,
              resolveStopLabel: (k: string) => displayNameForStopKey(k, stopsCatalog),
              routeLines: overviewLines,
              highlightRouteIds: committedPair ? routesConnectingFromTo.map((r) => r.id) : [],
              nodeStopIds: NODE_STOP_IDS,
              routesAtStop: linesAtStop,
              boardHref: boardHrefFor,
              onPickFromStop: (stopName: string) => {
                gaTrackEvent('transport_map_pick', { page: 'planner', slot: 'from' });
                setSearchFrom(stopName);
                latestStopRef.current = stopName;
                setStopFilter(stopName);
              },
              onPickToStop: (stopName: string) => {
                gaTrackEvent('transport_map_pick', { page: 'planner', slot: 'to' });
                setSearchTo(stopName);
                rememberFrequentToStop(stopName);
                // URL підтягнеться автосинхронізацією пари → адресний рядок.
              },
              onSwapStops: () => {
                gaTrackEvent('transport_swap', { source: 'map' });
                setSearchFrom(resolvedTo || effectiveSearchTo);
                setSearchTo(resolvedFrom || effectiveSearchFrom);
              },
              frequentToStops,
              coordsData: mapCoordsData,
            };
            const subtitle = `Звідки: ${resolvedFrom ? displayNameForStopKey(resolvedFrom, stopsCatalog) : '—'} · Куди: ${resolvedTo ? displayNameForStopKey(resolvedTo, stopsCatalog) : '—'}`;
            return isPhone ? (
              <LocalTransportMapOverlay open={mapOpen} onClose={closeMap} subtitle={subtitle}>
                <RouteMap {...mapProps} resizeToken={mapResizeToken} />
              </LocalTransportMapOverlay>
            ) : (
              <div className="lt-map-column">
                <RouteMap {...mapProps} showStrip />
              </div>
            );
          })()}
          </>
        )}

      </div>
    </div>
  );
};
