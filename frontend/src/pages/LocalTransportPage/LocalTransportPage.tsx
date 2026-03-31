import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Combobox } from '@/components/Combobox';
import type { SupplementRoute, TransportData, TransportRecord, RouteStopWithOrder } from './types';
import { RouteMap } from './RouteMap';
import {
  getMinsBetweenStops,
  getDurationFromStartSec,
  isVerifiedRoute,
} from './routeTiming';
import './LocalTransportPage.css';

const DATA_URL = '/data/malyn_transport.json';
const STOPS_COORDS_URL = '/data/stops_coords.json';
const FREQUENT_TO_STOPS_KEY = 'lt.frequentToStops';

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Зі списку зупинок повертає назву найближчої до targetName за координатами (або першу з списку) */
function findNearestStopInList(
  targetName: string,
  list: Array<{ name: string }>,
  coords: Record<string, [number, number]> | null
): string | null {
  if (!list.length) return null;
  const target = coords?.[targetName];
  if (!target) return list[0].name;
  const [lat, lon] = target;
  let best = list[0].name;
  let bestDist = Infinity;
  for (const s of list) {
    const c = coords?.[s.name];
    if (!c) continue;
    const d = haversineDistance(lat, lon, c[0], c[1]);
    if (d < bestDist) {
      bestDist = d;
      best = s.name;
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

function buildStops(
  routes: ReturnType<typeof buildRoutes>,
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>
): string[] {
  const stopSet = new Set<string>();
  routes.forEach((r) => {
    if (r.from) stopSet.add(r.from);
    if (r.to) stopSet.add(r.to);
  });
  if (stopsByRoute) {
    Object.values(stopsByRoute).forEach((stops) => {
      const names =
        Array.isArray(stops) && stops[0] != null && typeof stops[0] === 'object' && 'name' in stops[0]
          ? getStopNames(getRealStops(stops as RouteStopWithOrder[]))
          : getStopNames(stops);
      names.forEach((s) => stopSet.add(s));
    });
  }
  ['Малинівка', 'Юрівка', 'БАМ', 'Царське село'].forEach((s) => stopSet.add(s));
  return [...stopSet].sort((a, b) => a.localeCompare(b));
}

/** order === -1 означає тимчасово недоступну зупинку */
function isStopAvailableInDirection(stop: RouteStopWithOrder, dir: 'there' | 'back'): boolean {
  const order = dir === 'there' ? stop.order_there : stop.order_back;
  return typeof order === 'number' && order > 0;
}

function routeHasStop(
  routeId: string,
  stopName: string,
  route: { from: string | null; to: string | null },
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>
): boolean {
  if (route.from === stopName || route.to === stopName) return true;
  const routeStops = stopsByRoute?.[routeId];
  if (!routeStops?.length) return false;
  const first = routeStops[0];
  if (typeof first === 'object' && 'order_there' in first) {
    const stop = (routeStops as RouteStopWithOrder[]).find((s) => s.name === stopName);
    if (!stop) return false;
    // Не показувати маршрут, якщо зупинка виключена в обох напрямках (order = -1)
    return isStopAvailableInDirection(stop, 'there') || isStopAvailableInDirection(stop, 'back');
  }
  return getStopNames(routeStops).includes(stopName);
}

function groupTripsByDirection(trips: TransportRecord[]): { dir0: TransportRecord[]; dir1: TransportRecord[] } {
  const dir0 = trips.filter((t) => t.direction_id === '0').sort(sortByTime);
  const dir1 = trips.filter((t) => t.direction_id === '1').sort(sortByTime);
  return { dir0, dir1 };
}

function sortByTime(a: TransportRecord, b: TransportRecord): number {
  const ta = parseTime(a.block_id);
  const tb = parseTime(b.block_id);
  return ta - tb;
}

function parseTime(s: string | undefined): number {
  if (!s) return 0;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function getFirstTripTime(trips: TransportRecord[]): number {
  const times = trips.map((t) => parseTime(t.block_id)).filter((t) => t > 0);
  return times.length > 0 ? Math.min(...times) : 7 * 60; // 7:00 за замовчуванням
}

function formatTime(minutes: number): string {
  const totalMins = Math.round(minutes);
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** Формат тривалості між зупинками: "X хв Y сек" або "Y сек", без дробів */
function formatDurationMinutes(minutes: number): string {
  const totalSec = Math.round(minutes * 60);
  if (totalSec < 60) return `${totalSec} сек`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m} хв` : `${m} хв ${s} сек`;
}

/** Поточний час у Києві (хвилини з півночі) */
function getKyivMinutesNow(): number {
  const str = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

/** Найближчий рейс за поточним часом. Якщо пізно — показуємо перший рейс зранку. */
function findNearestTrip(
  trips: TransportRecord[],
  nowMins: number,
  directionFilter?: 'there' | 'back'
): { time: number; direction: 'there' | 'back' } | null {
  const { dir0, dir1 } = groupTripsByDirection(trips);
  const withTime0 = dir0.map((t) => parseTime(t.block_id)).filter((m) => m > 0);
  const withTime1 = dir1.map((t) => parseTime(t.block_id)).filter((m) => m > 0);
  // Якщо майбутніх немає — беремо перший зранку (?? withTime[0])
  if (directionFilter === 'back') {
    const next = withTime0.find((m) => m >= nowMins) ?? withTime0[0];
    return next != null ? { time: next, direction: 'back' } : null;
  }
  if (directionFilter === 'there') {
    const next = withTime1.find((m) => m >= nowMins) ?? withTime1[0];
    return next != null ? { time: next, direction: 'there' } : null;
  }
  const next0 = withTime0.find((m) => m >= nowMins) ?? withTime0[0];
  const next1 = withTime1.find((m) => m >= nowMins) ?? withTime1[0];
  if (next0 == null && next1 == null) return null;
  if (next0 == null) return { time: next1!, direction: 'there' };
  if (next1 == null) return { time: next0, direction: 'back' };
  // Хто ближчий за часом (якщо обидва в минулому — хто перший зранку)
  const dist0 = (next0 - nowMins + 24 * 60) % (24 * 60);
  const dist1 = (next1 - nowMins + 24 * 60) % (24 * 60);
  return dist1 <= dist0 ? { time: next1, direction: 'there' } : { time: next0, direction: 'back' };
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
  const fromOrderThere = orderedThere.find((s) => s.name === fromStop)?.order_there;
  const toOrderThere = orderedThere.find((s) => s.name === toStop)?.order_there;
  const fromOrderBack = orderedBack.find((s) => s.name === fromStop)?.order_back;
  const toOrderBack = orderedBack.find((s) => s.name === toStop)?.order_back;
  if (fromOrderThere != null && toOrderThere != null && fromOrderThere < toOrderThere) return 'there';
  if (fromOrderBack != null && toOrderBack != null && fromOrderBack < toOrderBack) return 'back';
  return null;
}

/** Знайти зупинку з names, що відповідає urlValue (точний або з нормалізацією типових відмінностей) */
/** Нормалізує рядок для порівняння: прибирає префікс "з-д ", лапки, Проектор→Прожектор */
function normalizeStopNameForMatch(s: string): string {
  let t = s
    .replace(/^з-д\s+/i, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
  t = t.replace(/^["«»]|["«»]$/g, '').trim();
  t = t.replace(/Проектор/gi, 'Прожектор');
  return t;
}

function findMatchingStop(urlValue: string, names: string[]): string | null {
  if (!urlValue) return null;
  if (names.includes(urlValue)) return urlValue;
  const norm = (s: string) => s.replace(/["«»]/g, '"').replace(/Проектор/gi, 'Прожектор');
  const nUrl = norm(urlValue);
  let found = names.find((n) => norm(n) === nUrl) ?? names.find((n) => n.includes('Прожектор') && urlValue.includes('Проектор')) ?? null;
  if (found) return found;
  const normalizedInput = normalizeStopNameForMatch(urlValue);
  if (!normalizedInput) return null;
  return names.find((n) => normalizeStopNameForMatch(n) === normalizedInput)
    ?? names.find((n) => norm(n) === normalizedInput)
    ?? null;
}

/** Порядок зупинки fromStop у напрямку dir (1-based). Повертає null якщо не знайдено. */
function getFromOrder(
  fromStop: string,
  dir: 'there' | 'back',
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>,
  routeId?: string
): number | null {
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
  const ordered = dir === 'there'
    ? [...withOrder].filter((s) => (s.belongs_to ?? 'both') !== 'back' && s.order_there > 0).sort((a, b) => a.order_there - b.order_there)
    : [...withOrder].filter((s) => (s.belongs_to ?? 'both') !== 'there' && s.order_back > 0).sort((a, b) => a.order_back - b.order_back);
  const stop = ordered.find((s) => s.name === fromStop);
  return stop ? (dir === 'there' ? stop.order_there : stop.order_back) : null;
}

/** Зібрати назви зупинок у порядку руху для маршруту та напрямку */
function getOrderedStopNames(
  routeId: string,
  dir: 'there' | 'back',
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>
): string[] {
  if (!routeId || !stopsByRoute?.[routeId]) return [];
  const routeStops = stopsByRoute[routeId];
  if (!Array.isArray(routeStops) || routeStops.length === 0) return [];
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
  const ordered =
    dir === 'there'
      ? [...withOrder].filter((s) => (s.belongs_to ?? 'both') !== 'back' && (s.order_there ?? 0) > 0).sort((a, b) => (a.order_there ?? 0) - (b.order_there ?? 0))
      : [...withOrder].filter((s) => (s.belongs_to ?? 'both') !== 'there' && (s.order_back ?? 0) > 0).sort((a, b) => (a.order_back ?? 0) - (b.order_back ?? 0));
  return ordered.map((s) => s.name);
}

/** Знайти baseTime рейсу за часом відправлення з зупинки fromStop */
function findBaseTimeByDepartureFromStop(
  trips: TransportRecord[],
  depFromStopMins: number,
  fromStop: string,
  dir: 'there' | 'back',
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>,
  routeId?: string
): number | null {
  const fromOrder = getFromOrder(fromStop, dir, stopsByRoute, routeId);
  if (fromOrder == null) return null;
  const rid = routeId ?? '';
  const durationMins =
    isVerifiedRoute(rid) && stopsByRoute?.[rid]
      ? getDurationFromStartSec(rid, getOrderedStopNames(rid, dir, stopsByRoute), fromOrder - 1) / 60
      : (fromOrder - 1) * getMinsBetweenStops(rid);
  const baseTime = depFromStopMins - durationMins;
  const { dir0, dir1 } = groupTripsByDirection(trips);
  const dirTrips = dir === 'there' ? dir1 : dir0;
  const baseTimes = dirTrips.map((t) => parseTime(t.block_id)).filter((m) => m > 0);
  if (baseTimes.length === 0) return null;
  const closest = baseTimes.reduce((best, t) =>
    Math.abs(t - baseTime) < Math.abs(best - baseTime) ? t : best
  );
  return closest;
}

/**
 * Формує посилання для QR-коду на зупинці.
 * Відкриває сторінку маршруту з зупинкою та напрямком; час не вказано — показується найближчий рейс за поточним часом.
 * @param routeId — номер маршруту (напр. "9")
 * @param stopName — назва зупинки (напр. "Малинівка")
 * @param direction — напрямок: "there" (туди, до кінцевої) або "back" (назад)
 * @param basePath — базовий шлях (за замовчуванням "/localtransport")
 */
export function buildStopRouteQrUrl(
  routeId: string,
  stopName: string,
  direction: 'there' | 'back',
  basePath = '/localtransport'
): string {
  const path = `${basePath}/route/${routeId}`;
  const params = new URLSearchParams();
  params.set('stop', stopName);
  params.set('dir', direction);
  return `${path}?${params.toString()}`;
}

/** Формат дати для URL як у Jakdojade: DD.MM.YY */
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

export const LocalTransportPage: React.FC = () => {
  const { routeId, fromStop: fromPath, toStop: toPath } = useParams<{
    routeId?: string;
    fromStop?: string;
    toStop?: string;
  }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStopFromUrl = searchParams.get('stop') ?? '';
  const toFromUrl = searchParams.get('to') ?? '';
  const timeFromUrl = searchParams.get('time') ?? '';
  const rawDir = searchParams.get('dir') ?? '';
  const dirFromUrl = rawDir.toLowerCase().startsWith('there') ? 'there' : rawDir.toLowerCase().startsWith('back') ? 'back' : rawDir;
  const dateFromUrl = searchParams.get('d') ?? '';
  const hourFromUrl = searchParams.get('h') ?? '';
  const [data, setData] = useState<TransportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stopFilter, setStopFilter] = useState('');
  const [routeFilter] = useState('');
  const [searchFrom, setSearchFrom] = useState<string>('');
  const [searchTo, setSearchTo] = useState<string>('');
  const [searchDate, setSearchDate] = useState<string>(() => formatDateUrl(new Date()));
  const [searchTime, setSearchTime] = useState<string>(() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });
  const [stopsDirection, setStopsDirection] = useState<'there' | 'back'>('there');
  const [selectedTripTime, setSelectedTripTime] = useState<number | null>(null);
  const [selectedTripDirection, setSelectedTripDirection] = useState<'there' | 'back' | null>(null);
  const [fromStop, setFromStop] = useState<string>('');
  const [toStop, setToStop] = useState<string>('');
  const youHereRef = useRef<HTMLLIElement | null>(null);
  const toStopRef = useRef<HTMLLIElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [segmentStyle, setSegmentStyle] = useState<{ top: number; height: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [nearestStops, setNearestStops] = useState<Array<{ name: string; distance: number }> | null>(null);
  const [stopsCoords, setStopsCoords] = useState<Record<string, [number, number]> | null>(null);
  const prevStopsDirectionRef = useRef<'there' | 'back'>('there');
  const latestStopRef = useRef<string>('');
  const searchFromInputRef = useRef<HTMLInputElement | null>(null);
  const searchToInputRef = useRef<HTMLInputElement | null>(null);
  const [isSwapAnimating, setIsSwapAnimating] = useState(false);
  const [pickerFrom, setPickerFrom] = useState<string>('');
  const [pickerTo, setPickerTo] = useState<string>('');
  const [frequentToStops, setFrequentToStops] = useState<string[]>([]);

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

  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: TransportData) => {
        if (!json?.records) throw new Error('Невірний формат даних');
        setData(json);
      })
      .catch((err) => setError(err.message || 'Не вдалося завантажити дані'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch(STOPS_COORDS_URL)
      .then((r) => r.json())
      .then((json: { stops?: Record<string, [number, number]> }) => setStopsCoords(json?.stops ?? null))
      .catch(() => setStopsCoords(null));
  }, []);

  const routes = useMemo(() => (data ? buildRoutes(data) : []), [data]);
  const stopsByRoute = data?.supplement?.stops?.stops_by_route;
  const stops = useMemo(() => buildStops(routes, stopsByRoute), [routes, stopsByRoute]);

  const effectiveSearchFrom = searchFrom || fromPathDecoded || queryFrom;
  const effectiveSearchTo = searchTo || toPathDecoded || queryTo;
  const hasFromToSearch = Boolean(effectiveSearchFrom && effectiveSearchTo);

  const routesConnectingFromTo = useMemo(() => {
    if (!hasFromToSearch || !stops.length) return [];
    const fromMatch = findMatchingStop(effectiveSearchFrom, stops) ?? effectiveSearchFrom;
    const toMatch = findMatchingStop(effectiveSearchTo, stops) ?? effectiveSearchTo;
    return routes.filter((r) => {
      const hasFrom = routeHasStop(r.id, fromMatch, r, stopsByRoute);
      const hasTo = routeHasStop(r.id, toMatch, r, stopsByRoute);
      if (!hasFrom || !hasTo) return false;
      const dir = getImpliedDirection(fromMatch, toMatch, stopsByRoute, r.id);
      return dir != null;
    });
  }, [routes, stopsByRoute, stops, hasFromToSearch, effectiveSearchFrom, effectiveSearchTo]);

  useEffect(() => {
    if (!isMainPage || !stops.length) return;
    if (fromPathDecoded || toPathDecoded) {
      const fromMatch = fromPathDecoded ? (findMatchingStop(fromPathDecoded, stops) ?? fromPathDecoded) : '';
      const toMatch = toPathDecoded ? (findMatchingStop(toPathDecoded, stops) ?? toPathDecoded) : '';
      setSearchFrom(fromMatch);
      setSearchTo(toMatch);
    } else if (queryFrom || queryTo) {
      setSearchFrom(queryFrom);
      setSearchTo(queryTo);
    }
    if (dateFromUrl) {
      const parsed = parseDateUrl(dateFromUrl);
      if (parsed) setSearchDate(formatDateUrl(parsed));
    }
    if (hourFromUrl) setSearchTime(hourFromUrl);
  }, [isMainPage, fromPathDecoded, toPathDecoded, queryFrom, queryTo, dateFromUrl, hourFromUrl, stops.length]);

  const effectiveStopFilter = stopFilter || selectedStopFromUrl;
  const filteredRoutes = useMemo(() => {
    if (hasFromToSearch && routesConnectingFromTo.length > 0) return routesConnectingFromTo;
    return routes.filter((r) => {
      if (routeFilter && r.id !== routeFilter) return false;
      if (effectiveStopFilter && !routeHasStop(r.id, effectiveStopFilter, r, stopsByRoute)) return false;
      return true;
    });
  }, [routes, effectiveStopFilter, routeFilter, stopsByRoute, hasFromToSearch, routesConnectingFromTo]);

  const detailRoute = useMemo(
    () => (routeId ? routes.find((r) => r.id === routeId) : null),
    [routes, routeId]
  );

  const detailMapStopNames = useMemo(() => {
    if (!detailRoute || !stopsByRoute?.[detailRoute.id]) return [];
    const routeStops = stopsByRoute[detailRoute.id];
    if (!Array.isArray(routeStops) || routeStops.length === 0) return [];
    const first = routeStops[0];
    const withOrder: RouteStopWithOrder[] =
      first && typeof first === 'object' && 'name' in first
        ? (routeStops as RouteStopWithOrder[])
        : (routeStops as unknown as string[]).map((name, i) => ({
            name,
            order_there: i + 1,
            order_back: routeStops.length - i,
            belongs_to: 'both' as const,
          }));
    const isThere = stopsDirection === 'there';
    const orderKey = isThere ? 'order_there' : 'order_back';
    const included = withOrder
      .filter((s) => (s.belongs_to ?? 'both') !== (isThere ? 'back' : 'there'))
      .filter((s) => (s[orderKey] ?? 0) > 0)
      .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
    return included.map((s) => s.name);
  }, [detailRoute?.id, stopsByRoute, stopsDirection]);

  /** Fallback для карти: усі зупинки маршруту в поточному напрямку (щоб карта завжди мала що малювати) */
  const detailMapStopNamesFallback = useMemo(() => {
    if (!detailRoute || !stopsByRoute?.[detailRoute.id]) return [];
    const routeStops = stopsByRoute[detailRoute.id];
    if (!Array.isArray(routeStops) || routeStops.length === 0) return [];
    const first = routeStops[0];
    const withOrder: RouteStopWithOrder[] =
      first && typeof first === 'object' && 'name' in first
        ? (routeStops as RouteStopWithOrder[])
        : (routeStops as unknown as string[]).map((name, i) => ({
            name,
            order_there: i + 1,
            order_back: routeStops.length - i,
            belongs_to: 'both' as const,
          }));
    const isThere = stopsDirection === 'there';
    const orderKey = isThere ? 'order_there' : 'order_back';
    const sorted = [...withOrder].sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
    return sorted.map((s) => s.name);
  }, [detailRoute?.id, stopsByRoute, stopsDirection]);

  const mapStopNamesToShow = detailMapStopNames.length > 0 ? detailMapStopNames : detailMapStopNamesFallback;

  /** Тільки «реальні» зупинки для маркерів на карті (без map_only — технічні точки лише для поворотів лінії) */
  const detailMapStopNamesForMarkers = useMemo(() => {
    if (!detailRoute || !stopsByRoute?.[detailRoute.id]) return [];
    const routeStops = stopsByRoute[detailRoute.id];
    if (!Array.isArray(routeStops) || routeStops.length === 0) return [];
    const first = routeStops[0];
    const withOrder: RouteStopWithOrder[] =
      first && typeof first === 'object' && 'name' in first
        ? (routeStops as RouteStopWithOrder[])
        : (routeStops as unknown as string[]).map((name, i) => ({
            name,
            order_there: i + 1,
            order_back: routeStops.length - i,
            belongs_to: 'both' as const,
          }));
    const isThere = stopsDirection === 'there';
    const orderKey = isThere ? 'order_there' : 'order_back';
    const included = withOrder
      .filter((s) => (s.belongs_to ?? 'both') !== (isThere ? 'back' : 'there'))
      .filter((s) => (s[orderKey] ?? 0) > 0)
      .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
    return getRealStops(included).map((s) => s.name);
  }, [detailRoute?.id, stopsByRoute, stopsDirection]);

  const detailRouteStopNames = useMemo(() => {
    if (!detailRoute || !stopsByRoute?.[detailRoute.id]) return [];
    const s = stopsByRoute[detailRoute.id];
    const arr = Array.isArray(s) ? s : [];
    if (arr.length && arr[0] != null && typeof arr[0] === 'object' && 'name' in arr[0]) {
      return getStopNames(getRealStops(arr as RouteStopWithOrder[]));
    }
    return getStopNames(s);
  }, [detailRoute?.id, stopsByRoute]);
  const hasChosenStopsOnDetail =
    Boolean(
      detailRoute &&
        selectedStopFromUrl &&
        toFromUrl &&
        detailRouteStopNames.length &&
        findMatchingStop(selectedStopFromUrl, detailRouteStopNames) &&
        findMatchingStop(toFromUrl, detailRouteStopNames)
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
    const ro = new ResizeObserver(measure);
    ro.observe(timelineRef.current);
    return () => ro.disconnect();
  }, [fromStop, toStop, stopsDirection]);

  // Ініціалізація From, To, time, dir з URL при завантаженні маршруту
  const prevRouteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detailRoute) return;
    const routeStops = stopsByRoute?.[detailRoute.id];
    const names = routeStops?.length ? getStopNames(routeStops) : [];
    const routeChanged = prevRouteIdRef.current !== detailRoute.id;
    prevRouteIdRef.current = detailRoute.id;
    if (routeChanged) {
      const matchedFrom = selectedStopFromUrl ? findMatchingStop(selectedStopFromUrl, names) : null;
      const matchedTo = toFromUrl ? findMatchingStop(toFromUrl, names) : null;
      if (matchedFrom) {
        setFromStop(matchedFrom);
        setToStop(matchedTo ?? '');
      } else {
        setFromStop('');
        setToStop('');
      }
      if (timeFromUrl && (dirFromUrl === 'there' || dirFromUrl === 'back')) {
        const depMins = parseTime(timeFromUrl);
        if (depMins > 0) {
          const fromForTime = matchedFrom;
          const baseTime =
            fromForTime && detailRoute
              ? findBaseTimeByDepartureFromStop(
                  detailRoute.trips,
                  depMins,
                  fromForTime,
                  dirFromUrl as 'there' | 'back',
                  stopsByRoute,
                  detailRoute.id
                )
              : depMins;
          setSelectedTripTime(baseTime ?? depMins);
          setSelectedTripDirection(dirFromUrl as 'there' | 'back');
          setStopsDirection(dirFromUrl as 'there' | 'back');
        }
      } else if (!timeFromUrl && (dirFromUrl === 'there' || dirFromUrl === 'back')) {
        // Посилання з QR: є dir, але немає time — напрямок задамо в autoselect, тут лише перемикач зупинок
        setStopsDirection(dirFromUrl as 'there' | 'back');
      }
    }
  }, [detailRoute?.id, selectedStopFromUrl, toFromUrl, timeFromUrl, dirFromUrl, stopsByRoute]);

  // Синхронізація selectedTripTime з URL коли є fromStop, toStop — щоб рядок у таблиці підсвічувався
  useEffect(() => {
    if (!detailRoute || !fromStop || !toStop || !timeFromUrl || (dirFromUrl !== 'there' && dirFromUrl !== 'back'))
      return;
    const depMins = parseTime(timeFromUrl);
    if (depMins <= 0) return;
    const baseTime = findBaseTimeByDepartureFromStop(
      detailRoute.trips,
      depMins,
      fromStop,
      dirFromUrl,
      stopsByRoute,
      detailRoute.id
    );
    if (baseTime != null) setSelectedTripTime(baseTime);
  }, [fromStop, toStop, timeFromUrl, dirFromUrl, detailRoute?.id, detailRoute?.trips, stopsByRoute]);

  // Автовибір найближчого рейсу за поточним часом (Київ) — пропускаємо, якщо в URL вже є time і dir
  // При посиланні з QR (stop + dir без time) — dir з URL задає напрямок для вибору найближчого рейсу
  useEffect(() => {
    if (!detailRoute || detailRoute.trips.length === 0) return;
    if (timeFromUrl && (dirFromUrl === 'there' || dirFromUrl === 'back')) return;
    let directionFilter: 'there' | 'back' | undefined;
    // Якщо dir явно в URL (посилання з QR-коду) — використовуємо його
    if (dirFromUrl === 'there' || dirFromUrl === 'back') {
      directionFilter = dirFromUrl;
    } else if (selectedStopFromUrl && stopsByRoute) {
      const routeStops = stopsByRoute[detailRoute.id];
      if (Array.isArray(routeStops) && routeStops.length > 0) {
        const first = routeStops[0];
        if (typeof first === 'object' && 'name' in first) {
          const stop = (routeStops as RouteStopWithOrder[]).find((s) => s.name === selectedStopFromUrl);
          if (stop?.belongs_to === 'there') directionFilter = 'there';
          else if (stop?.belongs_to === 'back') directionFilter = 'back';
        }
      }
    }
    const nearest = findNearestTrip(detailRoute.trips, getKyivMinutesNow(), directionFilter);
    if (nearest) {
      setSelectedTripTime(nearest.time);
      setSelectedTripDirection(nearest.direction);
      setStopsDirection(nearest.direction);
    }
  }, [detailRoute?.id, detailRoute?.trips, selectedStopFromUrl, stopsByRoute, timeFromUrl, dirFromUrl]);

  // При зміні напрямку (туди/назад) — оновити опції З/До: якщо поточний вибір не в списку, обрати найближчу зупинку за координатами
  useEffect(() => {
    if (!detailRoute || !stopsByRoute?.[detailRoute.id]) return;
    if (prevStopsDirectionRef.current === stopsDirection) return;
    prevStopsDirectionRef.current = stopsDirection;

    // Якщо З і До не вибрані — тільки оновити dir у URL, не підставляти зупинки
    if (!fromStop && !toStop) {
      updateDetailUrl({ dir: stopsDirection });
      return;
    }

    const routeStops = stopsByRoute[detailRoute.id];
    if (!Array.isArray(routeStops) || routeStops.length === 0) return;
    const first = routeStops[0];
    const stopsWithOrder: RouteStopWithOrder[] =
      typeof first === 'object' && first && 'name' in first
        ? (routeStops as RouteStopWithOrder[])
        : (routeStops as unknown as string[]).map((name, i) => ({
            name,
            order_there: i + 1,
            order_back: routeStops.length - i,
            belongs_to: 'both' as const,
          }));

    const orderedStopsThere = [...stopsWithOrder]
      .filter((s) => (s.belongs_to ?? 'both') !== 'back' && (s.order_there ?? 0) > 0)
      .sort((a, b) => (a.order_there ?? 0) - (b.order_there ?? 0));
    const orderedStopsBack = [...stopsWithOrder]
      .filter((s) => (s.belongs_to ?? 'both') !== 'there' && (s.order_back ?? 0) > 0)
      .sort((a, b) => (a.order_back ?? 0) - (b.order_back ?? 0));

    const orderedForDirection = stopsDirection === 'there' ? orderedStopsThere : orderedStopsBack;
    const orderKey = stopsDirection === 'there' ? 'order_there' : 'order_back';
    if (orderedForDirection.length === 0) return;

    const fromInList = orderedForDirection.find((s) => s.name === fromStop);
    let newFrom = fromStop;
    if (!fromInList) {
      newFrom = findNearestStopInList(fromStop, orderedForDirection, stopsCoords) ?? orderedForDirection[0].name;
      setFromStop(newFrom);
    }

    const fromOrder = orderedForDirection.find((s) => s.name === newFrom)?.[orderKey] ?? 0;
    const validTo = orderedForDirection.filter((s) => (s[orderKey] ?? 0) > fromOrder);
    const toInList = validTo.some((s) => s.name === toStop);
    let newTo = toStop;
    if (!toInList) {
      if (validTo.length > 0) {
        newTo = findNearestStopInList(toStop, validTo, stopsCoords) ?? validTo[0].name;
        setToStop(newTo);
      } else {
        setToStop('');
        newTo = '';
      }
    }

    updateDetailUrl({ stop: newFrom, to: newTo || undefined, dir: stopsDirection });
  }, [stopsDirection, detailRoute?.id, stopsByRoute, fromStop, toStop, stopsCoords]);

  // При зміні З/До — визначити напрямок і оновити stopsDirection, selectedTrip, URL
  const prevFromToRef = useRef<string>('');
  const initializedFromUrlRef = useRef(false);
  useEffect(() => {
    if (!detailRoute) return;
    if (!fromStop || !toStop) {
      prevFromToRef.current = '';
      initializedFromUrlRef.current = false;
      return;
    }
    const key = `${fromStop}|${toStop}`;
    if (timeFromUrl && (dirFromUrl === 'there' || dirFromUrl === 'back')) {
      if (!initializedFromUrlRef.current && fromStop === selectedStopFromUrl && toStop === toFromUrl) {
        initializedFromUrlRef.current = true;
        prevFromToRef.current = key;
      }
      return;
    }
    initializedFromUrlRef.current = false;
    if (prevFromToRef.current === key) return;
    prevFromToRef.current = key;
    const dir = getImpliedDirection(fromStop, toStop, stopsByRoute, detailRoute.id);
    if (!dir) return;
    setStopsDirection(dir);
    setSelectedTripDirection(dir);
    const nearest = findNearestTrip(detailRoute.trips, getKyivMinutesNow(), dir);
    if (nearest) {
      setSelectedTripTime(nearest.time);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('time', formatTime(nearest.time));
        next.set('dir', dir);
        return next;
      });
    } else {
      const first = groupTripsByDirection(detailRoute.trips)[dir === 'there' ? 'dir1' : 'dir0'][0];
      const mins = first ? parseTime(first.block_id) : null;
      if (mins != null && mins > 0) {
        setSelectedTripTime(mins);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('time', formatTime(mins));
          next.set('dir', dir);
          return next;
        });
      } else {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('dir', dir);
          return next;
        });
      }
    }
  }, [fromStop, toStop, detailRoute?.id, detailRoute?.trips, stopsByRoute, selectedStopFromUrl, toFromUrl, timeFromUrl, dirFromUrl]);

  const updateDetailUrl = (updates: { stop?: string; to?: string; time?: string; dir?: string }) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if ('stop' in updates) (updates.stop ? next.set('stop', updates.stop) : next.delete('stop'));
      if ('to' in updates) (updates.to ? next.set('to', updates.to) : next.delete('to'));
      if ('time' in updates) (updates.time ? next.set('time', updates.time) : next.delete('time'));
      if ('dir' in updates) (updates.dir ? next.set('dir', updates.dir) : next.delete('dir'));
      return next;
    });
  };

  const reverseDirectionAndFromTo = (targetDir?: 'there' | 'back') => {
    const newDir: 'there' | 'back' =
      targetDir ?? (stopsDirection === 'there' ? 'back' : 'there');

    if (!detailRoute || !stopsByRoute?.[detailRoute.id]) {
      setStopsDirection(newDir);
      updateDetailUrl({ dir: newDir });
      return;
    }

    const routeStops = stopsByRoute[detailRoute.id];
    if (!Array.isArray(routeStops) || routeStops.length === 0) {
      setStopsDirection(newDir);
      updateDetailUrl({ dir: newDir });
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

    const orderedStopsThere = [...stopsWithOrder]
      .filter((s) => (s.belongs_to ?? 'both') !== 'back' && s.order_there > 0)
      .sort((a, b) => a.order_there - b.order_there);
    const orderedStopsBack = [...stopsWithOrder]
      .filter((s) => (s.belongs_to ?? 'both') !== 'there' && s.order_back > 0)
      .sort((a, b) => a.order_back - b.order_back);

    const targetOrdered = newDir === 'there' ? orderedStopsThere : orderedStopsBack;
    const targetNames = targetOrdered.map((s) => s.name);

    const fromCandidate = toStop || fromStop || '';
    const toCandidate = fromStop || toStop || '';
    const newFromMatched = fromCandidate
      ? findMatchingStop(fromCandidate, targetNames)
      : null;
    const newToMatched = toCandidate ? findMatchingStop(toCandidate, targetNames) : null;

    const newFrom = newFromMatched ?? '';
    const newTo = newToMatched ?? '';

    setStopsDirection(newDir);
    setFromStop(newFrom);
    setToStop(newTo);

    const dirTrips = groupTripsByDirection(detailRoute.trips)[newDir === 'there' ? 'dir1' : 'dir0'];
    const firstInDir = dirTrips.find((t) => parseTime(t.block_id) > 0);
    const firstMins = firstInDir ? parseTime(firstInDir.block_id) : null;
    if (firstMins != null && firstMins > 0) {
      setSelectedTripTime(firstMins);
      setSelectedTripDirection(newDir);
      updateDetailUrl({
        stop: newFrom || undefined,
        to: newTo || undefined,
        dir: newDir,
        time: formatTime(firstMins),
      });
    } else {
      updateDetailUrl({
        stop: newFrom || undefined,
        to: newTo || undefined,
        dir: newDir,
      });
    }
  };

  const handleSearchSubmit = () => {
    const from = findMatchingStop(effectiveSearchFrom, stops) ?? effectiveSearchFrom;
    const to = findMatchingStop(effectiveSearchTo, stops) ?? effectiveSearchTo;
    if (!from || !to) return;
    const pathFrom = encodeURIComponent(from);
    const pathTo = encodeURIComponent(to);
    const params = new URLSearchParams();
    params.set('d', searchDate);
    params.set('h', searchTime);
    navigate(`/localtransport/${pathFrom}/${pathTo}?${params.toString()}`);
  };

  const handleSelectRoute = (id: string) => {
    const routeStopNames = stopsByRoute?.[id] ? getStopNames(stopsByRoute[id]) : [];
    const from = hasFromToSearch
      ? (findMatchingStop(effectiveSearchFrom, stops) ?? effectiveSearchFrom)
      : latestStopRef.current || effectiveStopFilter;
    const to = hasFromToSearch ? (findMatchingStop(effectiveSearchTo, stops) ?? effectiveSearchTo) : '';
    const fromOnRoute = from && routeStopNames.length && findMatchingStop(from, routeStopNames);
    const toOnRoute = to && routeStopNames.length && findMatchingStop(to, routeStopNames);
    const params = new URLSearchParams();
    if (searchDate) params.set('d', searchDate);
    if (searchTime) params.set('h', searchTime);
    if (fromOnRoute && toOnRoute) {
      params.set('stop', fromOnRoute);
      params.set('to', toOnRoute);
      const dir = getImpliedDirection(fromOnRoute, toOnRoute, stopsByRoute, id);
      if (dir) params.set('dir', dir);
    }
    navigate(`/localtransport/route/${id}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleShowTimetableFromPicker = () => {
    if (!detailRoute || !pickerFrom || !pickerTo) return;
    const params = new URLSearchParams();
    params.set('stop', pickerFrom);
    params.set('to', pickerTo);
    if (searchDate) params.set('d', searchDate);
    if (searchTime) params.set('h', searchTime);
    const dir = getImpliedDirection(pickerFrom, pickerTo, stopsByRoute, detailRoute.id);
    if (dir) params.set('dir', dir);
    navigate(`/localtransport/route/${detailRoute.id}?${params.toString()}`);
  };

  const handleBack = () => {
    if (isDetailPage && selectedStopFromUrl && toFromUrl) {
      const params = new URLSearchParams();
      params.set('d', dateFromUrl || formatDateUrl(new Date()));
      params.set('h', timeFromUrl || hourFromUrl || '12:00');
      navigate(`/localtransport/${encodeURIComponent(selectedStopFromUrl)}/${encodeURIComponent(toFromUrl)}?${params.toString()}`);
    } else if (isMainPage && hasPathSearch) {
      const params = new URLSearchParams();
      if (searchDate) params.set('d', searchDate);
      if (searchTime) params.set('h', searchTime);
      navigate(`/localtransport/${encodeURIComponent(effectiveSearchFrom)}/${encodeURIComponent(effectiveSearchTo)}?${params.toString()}`);
    } else {
      const stop = selectedStopFromUrl || effectiveStopFilter;
      navigate(stop ? `/localtransport?stop=${encodeURIComponent(stop)}` : '/localtransport');
    }
  };

  const handleFindNearest = () => {
    setGeoError('');
    setNearestStops(null);
    setGeoLoading(true);
    if (!navigator.geolocation) {
      setGeoError('Геолокація не підтримується браузером');
      setGeoLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res = await fetch(STOPS_COORDS_URL);
          const { stops } = await res.json();
          const withDistance = Object.entries(stops as Record<string, [number, number]>)
            .map(([name, coords]) => ({
              name,
              distance: haversineDistance(latitude, longitude, coords[0], coords[1]),
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 5);
          setNearestStops(withDistance);
        } catch {
          setGeoError('Не вдалося завантажити координати зупинок');
        } finally {
          setGeoLoading(false);
        }
      },
      (err) => {
        setGeoError(
          err.code === 1
            ? 'Дозвіл на геолокацію відхилено'
            : err.code === 2
              ? 'Позицію не визначено'
              : 'Помилка геолокації'
        );
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
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

  const fare = data.supplement?.fare ? `${data.supplement.fare.amount} грн` : null;

  return (
    <div className="lt-page lt-theme-jakdojade lt-layout-dark">
      <div className="lt-container lt-split-layout">
        {routeId && detailRoute ? (
          <>
          <div className="lt-panel">
          <div className="lt-detail lt-detail--jakdojade">
            {/* Такий самий хедер як на головній */}
            <header className="lt-header lt-header--jakdojade">
              <button type="button" className="lt-back lt-back--header" onClick={handleBack} aria-label="Назад до пошуку">
                ←
              </button>
              <div className="lt-header-title-wrap">
                <h1 className="lt-title">Як доїхати</h1>
                <p className="lt-subtitle">Маршрут №{detailRoute.id} · Малин</p>
              </div>
            </header>

            {/* Заголовок маршруту + перемикач напрямку */}
            <header className="lt-detail-header lt-detail-header--jd">
              <h1 className="lt-route-title lt-route-title--jd">
                <span
                  className={`lt-route-num ${isVerifiedRoute(detailRoute.id) ? 'lt-route-num--verified' : 'lt-route-num--unverified'}`}
                >
                  №{detailRoute.id}
                </span>
                <span className="lt-route-title-path">
                  {stopsDirection === 'there'
                    ? `${detailRoute.from ?? '?'} — ${detailRoute.to ?? '?'}`
                    : `${detailRoute.to ?? '?'} — ${detailRoute.from ?? '?'}`}
                </span>
              </h1>
              <div className="lt-detail-header-actions">
                <button
                  type="button"
                  className={`lt-direction-btn ${stopsDirection === 'there' ? 'lt-direction-btn--active' : ''}`}
                  onClick={() => reverseDirectionAndFromTo('there')}
                >
                  {detailRoute.to} →
                </button>
                <button
                  type="button"
                  className={`lt-direction-btn ${stopsDirection === 'back' ? 'lt-direction-btn--active' : ''}`}
                  onClick={() => reverseDirectionAndFromTo('back')}
                >
                  ← {detailRoute.from}
                </button>
                {fare && <span className="lt-fare">Проїзд {fare}</span>}
              </div>
            </header>

            {!hasChosenStopsOnDetail && detailRouteStopNames.length > 0 && (
              <section className="lt-detail-picker lt-detail-picker--stops" aria-labelledby="lt-picker-heading">
                <h2 id="lt-picker-heading" className="lt-section-title">Оберіть зупинки</h2>
                <div className="lt-detail-picker-row">
                  <div className="lt-from-to-cell lt-from-to-cell--from">
                    <label className="lt-from-to-label lt-from-to-label--with-icon">
                      <span className="lt-from-to-dot lt-from-to-dot--from" aria-hidden /> Звідки їдемо?
                    </label>
                    <Combobox
                      label=""
                      options={[{ value: '', label: '— Зупинка —' }, ...detailRouteStopNames.map((s) => ({ value: s, label: s }))]}
                      value={pickerFrom}
                      onChange={setPickerFrom}
                      placeholder="Наприклад Малинівка"
                      emptyMessage="Зупинок не знайдено"
                      clearable
                    />
                  </div>
                  <div className="lt-from-to-cell lt-from-to-cell--to">
                    <label className="lt-from-to-label lt-from-to-label--with-icon">
                      <span className="lt-from-to-dot lt-from-to-dot--to" aria-hidden /> Куди їдемо?
                    </label>
                    <Combobox
                      label=""
                      options={[{ value: '', label: '— Зупинка —' }, ...detailRouteStopNames.map((s) => ({ value: s, label: s }))]}
                      value={pickerTo}
                      onChange={setPickerTo}
                      placeholder="Наприклад Царське село"
                      emptyMessage="Зупинок не знайдено"
                      clearable
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="lt-search-btn lt-detail-picker-btn"
                  onClick={handleShowTimetableFromPicker}
                  disabled={!pickerFrom || !pickerTo}
                >
                  Показати розклад
                </button>
              </section>
            )}

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
              const minsPerStop = getMinsBetweenStops(detailRoute.id);
              const routeId = detailRoute.id;
              const verified = isVerifiedRoute(routeId);
              const orderedNamesThere = orderedStopsThere.map((s) => s.name);
              const orderedNamesBack = orderedStopsBack.map((s) => s.name);

              const buildTableTrips = (): Array<{ dep: string; arr: string; direction: 'there' | 'back'; baseTime: number }> | null => {
                if (!stopsWithOrder) return null;
                const { dir0, dir1 } = groupTripsByDirection(detailRoute.trips);
                const rows: Array<{ dep: string; arr: string; direction: 'there' | 'back'; baseTime: number }> = [];
                const nThere = orderedStopsThere.length;
                const nBack = orderedStopsBack.length;
                const fromOrderThere = fromStop ? orderedStopsThere.find((s) => s.name === fromStop)?.order_there : 1;
                const toOrderThere = toStop ? orderedStopsThere.find((s) => s.name === toStop)?.order_there : nThere;
                const fromOrderBack = fromStop ? orderedStopsBack.find((s) => s.name === fromStop)?.order_back : 1;
                const toOrderBack = toStop ? orderedStopsBack.find((s) => s.name === toStop)?.order_back : nBack;
                if (fromOrderThere != null && toOrderThere != null && fromOrderThere < toOrderThere && nThere > 0) {
                  dir1.forEach((t) => {
                    const mins = parseTime(t.block_id);
                    if (mins > 0) {
                      const depMins = verified
                        ? mins + getDurationFromStartSec(routeId, orderedNamesThere, fromOrderThere - 1) / 60
                        : mins + (fromOrderThere - 1) * minsPerStop;
                      const arrMins = verified
                        ? mins + getDurationFromStartSec(routeId, orderedNamesThere, toOrderThere - 1) / 60
                        : mins + (toOrderThere - 1) * minsPerStop;
                      rows.push({ dep: formatTime(depMins), arr: formatTime(arrMins), direction: 'there', baseTime: mins });
                    }
                  });
                }
                if (fromOrderBack != null && toOrderBack != null && fromOrderBack < toOrderBack && nBack > 0) {
                  dir0.forEach((t) => {
                    const mins = parseTime(t.block_id);
                    if (mins > 0) {
                      const depMins = verified
                        ? mins + getDurationFromStartSec(routeId, orderedNamesBack, fromOrderBack - 1) / 60
                        : mins + (fromOrderBack - 1) * minsPerStop;
                      const arrMins = verified
                        ? mins + getDurationFromStartSec(routeId, orderedNamesBack, toOrderBack - 1) / 60
                        : mins + (toOrderBack - 1) * minsPerStop;
                      rows.push({ dep: formatTime(depMins), arr: formatTime(arrMins), direction: 'back', baseTime: mins });
                    }
                  });
                }
                return rows.length ? rows.sort((a, b) => a.dep.localeCompare(b.dep)) : null;
              };

              const tableTrips = buildTableTrips();
              const tableTripsInDirection =
                tableTrips && stopsDirection
                  ? tableTrips.filter((r) => r.direction === stopsDirection)
                  : tableTrips;
              const hasFromTo = !!(fromStop && toStop && stopsWithOrder?.length);

              return (
                <>
                  {/* Компактний рядок після вибору маршруту (як на Jakdojade): Звідки → Куди, дата/час, Змінити */}
                  {hasFromTo && (
                    <div className="lt-detail-summary lt-detail-summary--compact">
                      <div className="lt-detail-summary-route">
                        <span className="lt-detail-summary-from">
                          {fromStop || selectedStopFromUrl || detailRoute.from || '—'}
                        </span>
                        <span className="lt-detail-summary-arrow" aria-hidden>→</span>
                        <span className="lt-detail-summary-to">
                          {toStop || toFromUrl || detailRoute.to || '—'}
                        </span>
                      </div>
                      <div className="lt-detail-summary-meta">
                        <span className="lt-detail-date">{dateFromUrl || formatDateUrl(new Date())}</span>
                        <span className="lt-detail-time">{timeFromUrl || hourFromUrl || '—'}</span>
                        <button
                          type="button"
                          className="lt-detail-summary-change"
                          onClick={handleBack}
                        >
                          Змінити
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Секція Розклад руху: завжди показуємо дату, час, вибір рейсу по поточному напрямку, Друк */}
                  <section className="lt-timetable-section lt-timetable-section--compact" aria-labelledby="lt-rozklad-heading">
                    <h2 id="lt-rozklad-heading" className="lt-section-title">Розклад руху</h2>
                    <div className="lt-timetable-header lt-timetable-header--jd lt-timetable-header--compact">
                      <span className="lt-detail-date">{dateFromUrl || formatDateUrl(new Date())}</span>
                      <span className="lt-detail-time">{timeFromUrl || hourFromUrl || '—'}</span>
                      {tableTripsInDirection && tableTripsInDirection.length > 0 && (
                        <>
                          <label className="lt-time-picker-label">Відправлення о</label>
                          <select
                            className="lt-time-picker-select lt-time-picker-select--compact"
                            value={
                              selectedTripDirection === stopsDirection &&
                              selectedTripTime != null &&
                              tableTripsInDirection.some(
                                (r) => r.baseTime === selectedTripTime && r.direction === selectedTripDirection
                              )
                                ? tableTripsInDirection.find(
                                    (r) => r.baseTime === selectedTripTime && r.direction === selectedTripDirection
                                  )?.dep ?? tableTripsInDirection[0]?.dep
                                : tableTripsInDirection[0]?.dep ?? ''
                            }
                            onChange={(e) => {
                              const dep = e.target.value;
                              const row = tableTripsInDirection.find((r) => r.dep === dep);
                              if (row) {
                                setSelectedTripTime(row.baseTime);
                                setSelectedTripDirection(row.direction);
                                setStopsDirection(row.direction);
                                updateDetailUrl({ time: row.dep, dir: row.direction });
                              }
                            }}
                            aria-label="Час відправлення"
                          >
                            {tableTripsInDirection.map((row, i) => (
                              <option key={i} value={row.dep}>
                                {row.dep} — прибуття {row.arr}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <button type="button" className="lt-print-btn lt-print-btn--compact" onClick={() => window.print()} title="Друк">
                        Друк
                      </button>
                    </div>
                  </section>
                </>
              );
            })()}
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
                mapStopNames = included.map((s) => s.name);
              }
              return stopsWithOrder && mapStopNames.length > 0 ? (
                <section className="lt-map-stops lt-map-stops--jd" aria-labelledby="lt-stops-heading">
                  <div className="lt-map-stops-inner">
                    <div className="lt-stops lt-stops--jd">
                      <h2 id="lt-stops-heading" className="lt-stops-heading">Список зупинок</h2>
                    <div ref={timelineRef} className="lt-stops-timeline">
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
                        const baseTime =
                          selectedTripDirection === stopsDirection && selectedTripTime != null
                            ? selectedTripTime
                            : getFirstTripTime(detailRoute.trips);
                        const orderKey = isThere ? 'order_there' : 'order_back';
                        const orderedNamesStops = filtered.map((s) => s.name);
                        const verifiedStops = isVerifiedRoute(detailRoute.id);
                        const minsPerStopStops = getMinsBetweenStops(detailRoute.id);
                        return (
                          <ul className="lt-stops-list">
                            {listStops.map((s, idx) => {
                              const order = s[orderKey];
                              const arrivalMins = verifiedStops
                                ? baseTime + getDurationFromStartSec(detailRoute.id, orderedNamesStops, order - 1) / 60
                                : baseTime + (order - 1) * minsPerStopStops;
                              const nextRealStop = listStops[idx + 1];
                              const nextArrivalMins =
                                nextRealStop == null
                                  ? null
                                  : verifiedStops
                                    ? baseTime + getDurationFromStartSec(detailRoute.id, orderedNamesStops, nextRealStop[orderKey] - 1) / 60
                                    : baseTime + (nextRealStop[orderKey] - 1) * minsPerStopStops;
                              const minsToNext =
                                nextRealStop == null
                                  ? null
                                  : verifiedStops
                                    ? (getDurationFromStartSec(detailRoute.id, orderedNamesStops, nextRealStop[orderKey] - 1) -
                                        getDurationFromStartSec(detailRoute.id, orderedNamesStops, (s[orderKey] ?? 0) - 1)) / 60
                                    : nextArrivalMins != null
                                      ? nextArrivalMins - arrivalMins
                                      : null;
                              const isFrom = fromStop && s.name === fromStop;
                              const isTo = toStop && s.name === toStop;
                              return (
                                <li
                                  key={`${isThere ? 'there' : 'back'}-${s.name}-${order}`}
                                  ref={isFrom ? youHereRef : isTo ? toStopRef : undefined}
                                  className={`lt-stop-item ${isFrom ? 'lt-stop-item--from' : ''} ${isTo ? 'lt-stop-item--to' : ''}`}
                                >
                                  <span className="lt-stop-time">{formatTime(arrivalMins)}</span>
                                  <span className="lt-stop-content">
                                    {s.name}
                                    {isFrom && <span className="lt-stop-badge lt-stop-badge--from">З</span>}
                                    {isTo && <span className="lt-stop-badge lt-stop-badge--to">ПО</span>}
                                  </span>
                                  <span className="lt-stop-to-next">
                                    {minsToNext != null ? formatDurationMinutes(minsToNext) : '—'}
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
          <div className="lt-map-column">
            <RouteMap
              routeId={detailRoute.id}
              stopNames={mapStopNamesToShow}
              markerStopNames={detailMapStopNamesForMarkers}
              fromStopName={fromStop || undefined}
              toStopName={toStop || undefined}
              onPickFromStop={(stopName) => {
                setFromStop(stopName);
                updateDetailUrl({ stop: stopName });
              }}
              onPickToStop={(stopName) => {
                setToStop(stopName);
                rememberFrequentToStop(stopName);
                updateDetailUrl({ to: stopName });
              }}
              onSwapStops={() => reverseDirectionAndFromTo()}
              frequentToStops={frequentToStops}
              dark
            />
          </div>
          </>
        ) : (
          <>
          <div className="lt-panel">
          <>
            <header className="lt-header lt-header--jakdojade">
              <h1 className="lt-title">Як доїхати</h1>
              <p className="lt-subtitle">Малин · місцевий транспорт</p>
            </header>

            <div className="lt-search lt-search--jakdojade">
              <div className="lt-from-to-block">
                <div className="lt-from-to-row">
                  <div className="lt-from-to-cell lt-from-to-cell--from">
                    <label className="lt-from-to-label lt-from-to-label--with-icon">
                      <span className="lt-from-to-dot lt-from-to-dot--from" aria-hidden /> Звідки їдемо?
                    </label>
                    <Combobox
                      label=""
                      options={[{ value: '', label: '— Зупинка —' }, ...stops.map((s) => ({ value: s, label: s }))]}
                      value={effectiveSearchFrom}
                      onChange={(v) => {
                        setSearchFrom(v);
                        latestStopRef.current = v;
                        setStopFilter(v);
                        if (!v) {
                          setSearchTo('');
                          const params = new URLSearchParams();
                          if (searchDate) params.set('d', searchDate);
                          if (searchTime) params.set('h', searchTime);
                          navigate(`/localtransport${params.toString() ? `?${params.toString()}` : ''}`);
                        }
                      }}
                      placeholder="Наприклад Малинівка"
                      emptyMessage="Зупинок не знайдено"
                      clearable
                      inputRef={searchFromInputRef}
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
                      setSearchFrom(effectiveSearchTo);
                      setSearchTo(effectiveSearchFrom);
                      window.setTimeout(() => {
                        setIsSwapAnimating(false);
                        searchFromInputRef.current?.focus();
                      }, 220);
                    }}
                    title="Поміняти місцями"
                    aria-label="Поміняти З та До"
                  >
                    ⇄
                  </button>
                  <div className="lt-from-to-cell lt-from-to-cell--to">
                    <label className="lt-from-to-label lt-from-to-label--with-icon">
                      <span className="lt-from-to-dot lt-from-to-dot--to" aria-hidden /> Куди їдемо?
                    </label>
                    <Combobox
                      label=""
                      options={[{ value: '', label: '— Зупинка —' }, ...stops.map((s) => ({ value: s, label: s }))]}
                      value={effectiveSearchTo}
                      onChange={(v) => {
                        setSearchTo(v);
                        if (!v && (fromPathDecoded || toPathDecoded)) {
                          const params = new URLSearchParams();
                          if (effectiveSearchFrom) params.set('from', effectiveSearchFrom);
                          if (searchDate) params.set('d', searchDate);
                          if (searchTime) params.set('h', searchTime);
                          navigate(`/localtransport${params.toString() ? `?${params.toString()}` : ''}`);
                        }
                      }}
                      placeholder="Наприклад Царське село"
                      emptyMessage="Зупинок не знайдено"
                      clearable
                      inputRef={searchToInputRef}
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
                    <label className="lt-datetime-label">Час</label>
                    <input
                      type="time"
                      className="lt-datetime-input"
                      value={searchTime}
                      onChange={(e) => setSearchTime(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="lt-search-btn"
                    onClick={handleSearchSubmit}
                    disabled={!effectiveSearchFrom || !effectiveSearchTo}
                  >
                    Знайти
                  </button>
                </div>
                <div className="lt-search-extra">
                  <button
                    type="button"
                    className="lt-geo-btn lt-geo-btn--small"
                    onClick={handleFindNearest}
                    disabled={geoLoading}
                    title="Найближчі зупинки"
                  >
                    {geoLoading ? '…' : '📍'} Найближча
                  </button>
                  {(geoError || (nearestStops && nearestStops.length > 0)) && (
                    <div className="lt-geo-results">
                      {geoError && <p className="lt-geo-error">{geoError}</p>}
                      {nearestStops && nearestStops.length > 0 && (
                        <div className="lt-nearest">
                          <p className="lt-nearest-title">Найближчі зупинки:</p>
                          <ul className="lt-nearest-list">
                            {nearestStops.map(({ name, distance }) => (
                              <li key={name}>
                                <button
                                  type="button"
                                  className="lt-nearest-item"
                                  onClick={() => {
                                    latestStopRef.current = name;
                                    setSearchFrom(name);
                                    setStopFilter(name);
                                    setNearestStops(null);
                                  }}
                                >
                                  {name} — {distance < 1000 ? `${Math.round(distance)} м` : `${(distance / 1000).toFixed(1)} км`}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {hasFromToSearch && routesConnectingFromTo.length === 0 && (
              <div className="lt-no-routes">
                <p>Між цими зупинками немає прямого маршруту. Оберіть інші зупинки або перегляньте всі маршрути нижче.</p>
              </div>
            )}

            <div className="lt-routes">
              {hasFromToSearch && routesConnectingFromTo.length > 0 ? (
                <>
                  <p className="lt-routes-heading">
                    Маршрути: {effectiveSearchFrom} → {effectiveSearchTo}
                  </p>
                  {filteredRoutes.map((r) => {
                    const searchMins =
                      (() => {
                        const [h, m] = searchTime.split(':').map(Number);
                        return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : getKyivMinutesNow();
                      })();
                    const nearest = findNearestTrip(r.trips, searchMins);
                    const nextTimeStr = nearest ? formatTime(nearest.time) : (r.trips.length > 0 ? formatTime(getFirstTripTime(r.trips)) : '—');
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className="lt-route-card lt-route-card--jd"
                        onClick={() => handleSelectRoute(r.id)}
                      >
                        <div className="lt-route-card-time">
                          <span className="lt-route-card-time-value">{nextTimeStr}</span>
                        </div>
                        <div className="lt-route-card-main">
                          <span
                            className={`lt-route-num lt-route-num--card ${isVerifiedRoute(r.id) ? 'lt-route-num--verified' : 'lt-route-num--unverified'}`}
                          >
                            №{r.id}
                          </span>
                          <span className="lt-route-path">{r.from ?? '?'} — {r.to ?? '?'}</span>
                        </div>
                      </button>
                    );
                  })}
                </>
              ) : filteredRoutes.length === 0 ? (
                <p className="lt-empty">Введіть «З» та «До» і натисніть «Знайти», або перегляньте маршрути нижче.</p>
              ) : (
                <>
                  <p className="lt-routes-heading">Усі маршрути</p>
                  {filteredRoutes.map((r) => {
                    const searchMins =
                      (() => {
                        const [h, m] = searchTime.split(':').map(Number);
                        return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : getKyivMinutesNow();
                      })();
                    const nearest = findNearestTrip(r.trips, searchMins);
                    const nextTimeStr = nearest ? formatTime(nearest.time) : (r.trips.length > 0 ? formatTime(getFirstTripTime(r.trips)) : '—');
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className="lt-route-card lt-route-card--jd"
                        onClick={() => handleSelectRoute(r.id)}
                      >
                        <div className="lt-route-card-time">
                          <span className="lt-route-card-time-value">{nextTimeStr}</span>
                        </div>
                        <div className="lt-route-card-main">
                          <span
                            className={`lt-route-num lt-route-num--card ${isVerifiedRoute(r.id) ? 'lt-route-num--verified' : 'lt-route-num--unverified'}`}
                          >
                            №{r.id}
                          </span>
                          <span className="lt-route-path">{r.from ?? '?'} — {r.to ?? '?'}</span>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
            <footer className="lt-footer">
              <a href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36" target="_blank" rel="noopener noreferrer">data.gov.ua</a>
              {' · '}
              <a href="tel:+380687771590">(068) 77-71-590</a>
            </footer>
          </>
          </div>
          <div className="lt-map-column">
            <RouteMap stopNames={[]} dark />
          </div>
          </>
        )}

      </div>
    </div>
  );
};
