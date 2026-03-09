import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Select } from '@/components/Select';
import { Combobox } from '@/components/Combobox';
import type { SupplementRoute, TransportData, TransportRecord, RouteStopWithOrder } from './types';
import { RouteMap } from './RouteMap';
import './LocalTransportPage.css';

const DATA_URL = '/data/malyn_transport.json';
const STOPS_COORDS_URL = '/data/stops_coords.json';

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
    Object.values(stopsByRoute).forEach((stops) => getStopNames(stops).forEach((s) => stopSet.add(s)));
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

/** Орієнтовно хвилин між зупинками (для розрахунку часу прибуття) */
const MINS_PER_STOP = 2;

function getFirstTripTime(trips: TransportRecord[]): number {
  const times = trips.map((t) => parseTime(t.block_id)).filter((t) => t > 0);
  return times.length > 0 ? Math.min(...times) : 7 * 60; // 7:00 за замовчуванням
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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
function findMatchingStop(urlValue: string, names: string[]): string | null {
  if (!urlValue) return null;
  if (names.includes(urlValue)) return urlValue;
  const norm = (s: string) => s.replace(/["«»]/g, '"').replace(/Проектор/gi, 'Прожектор');
  const nUrl = norm(urlValue);
  return names.find((n) => norm(n) === nUrl) ?? names.find((n) => n.includes('Прожектор') && urlValue.includes('Проектор')) ?? null;
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
  const baseTime = depFromStopMins - (fromOrder - 1) * MINS_PER_STOP;
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

export const LocalTransportPage: React.FC = () => {
  const { routeId } = useParams<{ routeId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStopFromUrl = searchParams.get('stop') ?? '';
  const toFromUrl = searchParams.get('to') ?? '';
  const timeFromUrl = searchParams.get('time') ?? '';
  const dirFromUrl = searchParams.get('dir') ?? '';
  const [data, setData] = useState<TransportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stopFilter, setStopFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
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
  const latestStopRef = useRef<string>('');

  useEffect(() => {
    if (selectedStopFromUrl) {
      latestStopRef.current = selectedStopFromUrl;
      setStopFilter(selectedStopFromUrl);
    }
  }, [selectedStopFromUrl]);

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

  const routes = useMemo(() => (data ? buildRoutes(data) : []), [data]);
  const stopsByRoute = data?.supplement?.stops?.stops_by_route;
  const stops = useMemo(() => buildStops(routes, stopsByRoute), [routes, stopsByRoute]);

  const effectiveStopFilter = stopFilter || selectedStopFromUrl;
  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (routeFilter && r.id !== routeFilter) return false;
      if (effectiveStopFilter && !routeHasStop(r.id, effectiveStopFilter, r, stopsByRoute)) return false;
      return true;
    });
  }, [routes, effectiveStopFilter, routeFilter, stopsByRoute]);

  const detailRoute = useMemo(
    () => (routeId ? routes.find((r) => r.id === routeId) : null),
    [routes, routeId]
  );

  // Прокрутити до "Ви тут" при завантаженні
  useEffect(() => {
    if (selectedStopFromUrl && youHereRef.current) {
      youHereRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedStopFromUrl, stopsDirection]);

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

  const handleSelectRoute = (id: string) => {
    const stop = latestStopRef.current || effectiveStopFilter;
    const params = new URLSearchParams();
    if (stop) params.set('stop', stop);
    navigate(`/localtransport/route/${id}${params.toString() ? `?${params.toString()}` : ''}`);
  };
  const handleBack = () => {
    const stop = selectedStopFromUrl || effectiveStopFilter;
    navigate(stop ? `/localtransport?stop=${encodeURIComponent(stop)}` : '/localtransport');
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

  const stopComboboxOptions = useMemo(
    () => [{ value: '', label: 'Всі зупинки' }, ...stops.map((s) => ({ value: s, label: s }))],
    [stops]
  );

  const routeOptions = useMemo(
    () => [
      { value: '', label: 'Всі маршрути' },
      ...routes.map((r) => ({
        value: r.id,
        label: `№${r.id} ${r.from ?? '?'} ↔ ${r.to ?? '?'}`,
      })),
    ],
    [routes]
  );

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
    <div className="lt-page lt-use-site-colors">
      <div className="lt-container">
        {routeId && detailRoute ? (
          <div className="lt-detail">
            <button type="button" className="lt-back" onClick={handleBack}>
              ← Усі маршрути
            </button>
            <header className="lt-detail-header">
              <h1 className="lt-route-title">
                <span className="lt-route-num">№{detailRoute.id}</span>
                {detailRoute.from ?? '?'} — {detailRoute.to ?? '?'}
              </h1>
              {fare && <span className="lt-fare">Проїзд {fare}</span>}
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
              const fromOptions = orderedStopsThere.map((s) => ({ value: s.name, label: s.name }));
              const toOptionsFrom = (fromStop
                ? orderedStopsThere.filter((s) => s.name !== fromStop)
                : orderedStopsThere
              ).map((s) => ({ value: s.name, label: s.name }));

              const buildTableTrips = () => {
                if (!fromStop || !toStop || !stopsWithOrder) return null;
                const fromOrderThere = orderedStopsThere.find((s) => s.name === fromStop)?.order_there;
                const toOrderThere = orderedStopsThere.find((s) => s.name === toStop)?.order_there;
                const fromOrderBack = orderedStopsBack.find((s) => s.name === fromStop)?.order_back;
                const toOrderBack = orderedStopsBack.find((s) => s.name === toStop)?.order_back;
                const { dir0, dir1 } = groupTripsByDirection(detailRoute.trips);
                const rows: Array<{ dep: string; arr: string; direction: 'there' | 'back'; baseTime: number }> = [];
                if (fromOrderThere != null && toOrderThere != null && fromOrderThere < toOrderThere) {
                  dir1.forEach((t) => {
                    const mins = parseTime(t.block_id);
                    if (mins > 0) {
                      rows.push({
                        dep: formatTime(mins + (fromOrderThere - 1) * MINS_PER_STOP),
                        arr: formatTime(mins + (toOrderThere - 1) * MINS_PER_STOP),
                        direction: 'there',
                        baseTime: mins,
                      });
                    }
                  });
                }
                if (fromOrderBack != null && toOrderBack != null && fromOrderBack < toOrderBack) {
                  dir0.forEach((t) => {
                    const mins = parseTime(t.block_id);
                    if (mins > 0) {
                      rows.push({
                        dep: formatTime(mins + (fromOrderBack - 1) * MINS_PER_STOP),
                        arr: formatTime(mins + (toOrderBack - 1) * MINS_PER_STOP),
                        direction: 'back',
                        baseTime: mins,
                      });
                    }
                  });
                }
                return rows.sort((a, b) => a.dep.localeCompare(b.dep));
              };

              const tableTrips = buildTableTrips();
              const hasFromTo = !!stopsWithOrder?.length;

              return (
                <>
                  <div className="lt-timetable-header">
                    {hasFromTo && (
                      <div className="lt-from-to">
                        <div className="lt-from-to-field">
                          <Combobox
                            label="З"
                            options={[{ value: '', label: '— Зупинка —' }, ...fromOptions]}
                            value={fromStop}
                            onChange={(v) => {
                              setFromStop(v);
                              const updates: { stop?: string; to?: string } = { stop: v || undefined };
                              if (!v) {
                                setToStop('');
                                updates.to = undefined;
                              } else if (toStop) {
                                const idxFrom = orderedStopsThere.findIndex((s) => s.name === v);
                                const idxTo = orderedStopsThere.findIndex((s) => s.name === toStop);
                                if (idxTo <= idxFrom) {
                                  setToStop('');
                                  updates.to = undefined;
                                }
                              }
                              updateDetailUrl(updates);
                            }}
                            placeholder="Пошук зупинки"
                            emptyMessage="Зупинок не знайдено"
                            clearable
                          />
                        </div>
                        <span className="lt-from-to-arrow">→</span>
                        <div className="lt-from-to-field">
                          <Combobox
                            label="До"
                            options={[{ value: '', label: '— Зупинка —' }, ...toOptionsFrom]}
                            value={toStop}
                            onChange={(v) => {
                              setToStop(v);
                              updateDetailUrl({ to: v || undefined });
                            }}
                            placeholder="Пошук зупинки"
                            emptyMessage="Зупинок не знайдено"
                            clearable
                          />
                        </div>
                      </div>
                    )}
                    <div className="lt-date-row">
                      <button type="button" className="lt-print-btn" onClick={() => window.print()} title="Друк">
                        🖨 Друк
                      </button>
                    </div>
                  </div>

                  <div className="lt-timetable">
                    {tableTrips && tableTrips.length > 0 ? (
                      <table className="lt-timetable-table">
                        <thead>
                          <tr>
                            <th>Відправлення{fromStop && <span className="lt-th-stop"> ({fromStop})</span>}</th>
                            <th>Прибуття{toStop && <span className="lt-th-stop"> ({toStop})</span>}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableTrips.map((row, i) => {
                            const isSelected =
                              selectedTripTime === row.baseTime && selectedTripDirection === row.direction;
                            return (
                            <tr
                              key={i}
                              className={`lt-timetable-row-clickable ${isSelected ? 'lt-timetable-row--selected' : ''}`}
                              onClick={() => {
                                setSelectedTripTime(row.baseTime);
                                setSelectedTripDirection(row.direction);
                                setStopsDirection(row.direction);
                                updateDetailUrl({ time: row.dep, dir: row.direction });
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedTripTime(row.baseTime);
                                  setSelectedTripDirection(row.direction);
                                  setStopsDirection(row.direction);
                                  updateDetailUrl({ time: row.dep, dir: row.direction });
                                }
                              }}
                            >
                              <td className="lt-time-cell">{row.dep}</td>
                              <td className="lt-time-cell">{row.arr}</td>
                            </tr>
                          );})}
                        </tbody>
                      </table>
                    ) : (
                      <div className="lt-timetable-grid">
                        <div className="lt-timetable-col">
                          <h3 className="lt-timetable-heading">{detailRoute.to} →</h3>
                          <div className="lt-times">
                            {groupTripsByDirection(detailRoute.trips).dir1.map((t) => {
                              const mins = parseTime(t.block_id);
                              const isSelected = selectedTripTime === mins && selectedTripDirection === 'there';
                              return (
                                <button
                                  key={t.trip_id}
                                  type="button"
                                  className={`lt-time ${isSelected ? 'lt-time--selected' : ''}`}
                                  onClick={() => {
                                    if (mins > 0) {
                                      setSelectedTripTime(mins);
                                      setSelectedTripDirection('there');
                                      setStopsDirection('there');
                                      updateDetailUrl({ time: formatTime(mins), dir: 'there' });
                                    }
                                  }}
                                >
                                  {t.block_id || '—'}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="lt-timetable-col">
                          <h3 className="lt-timetable-heading">← {detailRoute.from}</h3>
                          <div className="lt-times">
                            {groupTripsByDirection(detailRoute.trips).dir0.map((t) => {
                              const mins = parseTime(t.block_id);
                              const isSelected = selectedTripTime === mins && selectedTripDirection === 'back';
                              return (
                                <button
                                  key={t.trip_id}
                                  type="button"
                                  className={`lt-time ${isSelected ? 'lt-time--selected' : ''}`}
                                  onClick={() => {
                                    if (mins > 0) {
                                      setSelectedTripTime(mins);
                                      setSelectedTripDirection('back');
                                      setStopsDirection('back');
                                      updateDetailUrl({ time: formatTime(mins), dir: 'back' });
                                    }
                                  }}
                                >
                                  {t.block_id || '—'}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
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
              const stopNames = stopsWithOrder ? getStopNames(stopsWithOrder) : [];
              return stopsWithOrder && stopNames.length > 0 ? (
                <div className="lt-map-stops">
                  <div className="lt-map-area">
                    <RouteMap stopNames={stopNames} />
                  </div>
                  <div className="lt-stops">
                    <h3 className="lt-stops-heading">Зупинки на маршруті</h3>
                    <div className="lt-stops-direction-switch">
                      <button
                        type="button"
                        className={`lt-direction-btn ${stopsDirection === 'there' ? 'lt-direction-btn--active' : ''}`}
                        onClick={() => {
                          setStopsDirection('there');
                          updateDetailUrl({ dir: 'there' });
                        }}
                      >
                        {detailRoute.to} →
                      </button>
                      <button
                        type="button"
                        className={`lt-direction-btn ${stopsDirection === 'back' ? 'lt-direction-btn--active' : ''}`}
                        onClick={() => {
                          setStopsDirection('back');
                          updateDetailUrl({ dir: 'back' });
                        }}
                      >
                        ← {detailRoute.from}
                      </button>
                    </div>
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
                        const baseTime =
                          selectedTripDirection === stopsDirection && selectedTripTime != null
                            ? selectedTripTime
                            : getFirstTripTime(detailRoute.trips);
                        const orderKey = isThere ? 'order_there' : 'order_back';
                        return (
                          <ul className="lt-stops-list">
                            {filtered.map((s, idx) => {
                              const order = s[orderKey];
                              const arrivalMins = baseTime + (order - 1) * MINS_PER_STOP;
                              const nextStop = filtered[idx + 1];
                              const nextArrivalMins = nextStop
                                ? baseTime + (nextStop[orderKey] - 1) * MINS_PER_STOP
                                : null;
                              const minsToNext = nextArrivalMins != null ? nextArrivalMins - arrivalMins : null;
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
                                    {isTo && <span className="lt-stop-badge lt-stop-badge--to">До</span>}
                                  </span>
                                  <span className="lt-stop-to-next">
                                    {minsToNext != null ? `${minsToNext} хв` : '—'}
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
              ) : null;
            })()}
          </div>
        ) : (
          <>
            <header className="lt-header">
              <h1 className="lt-title">Розклад руху</h1>
              <p className="lt-subtitle">Малин · місцевий транспорт</p>
            </header>

            <div className="lt-search">
              <div className="lt-search-row">
                <div className="lt-search-field">
                  <Combobox
                    label="Пошук зупинки"
                    options={stopComboboxOptions}
                    value={effectiveStopFilter}
                    onChange={(v) => {
                      latestStopRef.current = v;
                      setStopFilter(v);
                      setSearchParams(v ? { stop: v } : {});
                    }}
                    placeholder="Введіть назву (напр. Царське село, вокзал)"
                    emptyMessage="Зупинок не знайдено"
                  />
                </div>
                <button
                  type="button"
                  className="lt-geo-btn"
                  onClick={handleFindNearest}
                  disabled={geoLoading}
                  title="Знайти найближчі зупинки"
                >
                  {geoLoading ? '…' : '📍'} Найближча
                </button>
              </div>
              <div className="lt-search-row lt-search-row--route">
                <Select
                  label="Маршрут"
                  options={routeOptions}
                  value={routeFilter}
                  onChange={(e) => setRouteFilter(e.target.value)}
                />
              </div>
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
                                setStopFilter(name);
                                setSearchParams({ stop: name });
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

            <div className="lt-routes">
              {filteredRoutes.length === 0 ? (
                <p className="lt-empty">Маршрутів не знайдено. Змініть фільтри.</p>
              ) : (
                filteredRoutes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="lt-route-card"
                    onClick={() => handleSelectRoute(r.id)}
                  >
                    <span className="lt-route-num">№{r.id}</span>
                    <span className="lt-route-path">
                      {r.from ?? '?'} — {r.to ?? '?'}
                    </span>
                    <span className="lt-route-meta">{r.trips.length} рейсів</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        <footer className="lt-footer">
          <a href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36" target="_blank" rel="noopener noreferrer">data.gov.ua</a>
          {' · '}
          <a href="tel:+380687771590">(068) 77-71-590</a>
        </footer>
      </div>
    </div>
  );
};
