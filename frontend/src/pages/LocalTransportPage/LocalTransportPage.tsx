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

function routeHasStop(
  routeId: string,
  stopName: string,
  route: { from: string | null; to: string | null },
  stopsByRoute?: Record<string, string[] | RouteStopWithOrder[]>
): boolean {
  if (route.from === stopName || route.to === stopName) return true;
  const names = getStopNames(stopsByRoute?.[routeId] ?? []);
  if (names.includes(stopName)) return true;
  if (route.from?.includes(stopName) || route.to?.includes(stopName)) return true;
  return false;
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


export const LocalTransportPage: React.FC = () => {
  const { routeId } = useParams<{ routeId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedStopFromUrl = searchParams.get('stop') ?? '';
  const [data, setData] = useState<TransportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stopFilter, setStopFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [stopsExpanded, setStopsExpanded] = useState(false);
  const [stopsDirection, setStopsDirection] = useState<'there' | 'back'>('there');
  const [selectedTripTime, setSelectedTripTime] = useState<number | null>(null);
  const [selectedTripDirection, setSelectedTripDirection] = useState<'there' | 'back' | null>(null);
  const youHereRef = useRef<HTMLLIElement | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [nearestStops, setNearestStops] = useState<Array<{ name: string; distance: number }> | null>(null);

  useEffect(() => {
    if (selectedStopFromUrl) setStopFilter(selectedStopFromUrl);
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

  // Автовибір найближчого рейсу за поточним часом (Київ)
  useEffect(() => {
    if (!detailRoute || detailRoute.trips.length === 0) return;
    let directionFilter: 'there' | 'back' | undefined;
    if (selectedStopFromUrl && stopsByRoute) {
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
  }, [detailRoute?.id, detailRoute?.trips, selectedStopFromUrl, stopsByRoute]);

  const handleSelectRoute = (id: string) => {
    const stop = effectiveStopFilter;
    navigate(`/localtransport/route/${id}${stop ? `?stop=${encodeURIComponent(stop)}` : ''}`);
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
    <div className="lt-page">
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
            {detailRoute.trips.length > 0 && (
              <div className="lt-timetable">
                {(() => {
                  const { dir0, dir1 } = groupTripsByDirection(detailRoute.trips);
                  return (
                    <div className="lt-timetable-grid">
                      <div className="lt-timetable-col">
                        <h3 className="lt-timetable-heading">
                          {detailRoute.to} →
                        </h3>
                        <div className="lt-times">
                          {dir1.map((t) => {
                            const mins = parseTime(t.block_id);
                            const isSelected =
                              selectedTripTime === mins && selectedTripDirection === 'there';
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
                        <h3 className="lt-timetable-heading">
                          ← {detailRoute.from}
                        </h3>
                        <div className="lt-times">
                          {dir0.map((t) => {
                            const mins = parseTime(t.block_id);
                            const isSelected =
                              selectedTripTime === mins && selectedTripDirection === 'back';
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
                  );
                })()}
              </div>
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
              const stopNames = stopsWithOrder ? getStopNames(stopsWithOrder) : [];
              return stopsWithOrder && stopNames.length > 0 ? (
                <div className="lt-map-stops">
                  <div className="lt-map-area">
                    <RouteMap stopNames={stopNames} />
                  </div>
                  <div className={`lt-stops ${stopsExpanded ? 'lt-stops--expanded' : ''}`}>
                    <button
                      type="button"
                      className="lt-stops-toggle"
                      onClick={() => setStopsExpanded((v) => !v)}
                      aria-expanded={stopsExpanded}
                    >
                      <h3 className="lt-stops-heading">
                        Зупинки на маршруті
                        <span className="lt-stops-hint">
                          {selectedTripDirection === stopsDirection && selectedTripTime != null
                            ? ` (графік для рейсу ${formatTime(selectedTripTime)}, ~2 хв між зупинками)`
                            : ' (натисніть час рейсу вище — час орієнтовний)'}
                        </span>
                      </h3>
                      <span className="lt-stops-toggle-icon" aria-hidden>
                        {stopsExpanded ? '−' : '+'}
                      </span>
                    </button>
                    <div className="lt-stops-content">
                      <div className="lt-stops-direction-switch">
                        <button
                          type="button"
                          className={`lt-direction-btn ${stopsDirection === 'there' ? 'lt-direction-btn--active' : ''}`}
                          onClick={() => setStopsDirection('there')}
                        >
                          {detailRoute.to} →
                        </button>
                        <button
                          type="button"
                          className={`lt-direction-btn ${stopsDirection === 'back' ? 'lt-direction-btn--active' : ''}`}
                          onClick={() => setStopsDirection('back')}
                        >
                          ← {detailRoute.from}
                        </button>
                      </div>
                      <div className="lt-stops-col">
                        {(() => {
                          const isThere = stopsDirection === 'there';
                          const filtered = [...stopsWithOrder]
                            .filter((s) => (s.belongs_to ?? 'both') !== (isThere ? 'back' : 'there'))
                            .sort((a, b) => (isThere ? a.order_there - b.order_there : a.order_back - b.order_back));
                          const baseTime =
                            selectedTripDirection === stopsDirection && selectedTripTime != null
                              ? selectedTripTime
                              : getFirstTripTime(detailRoute.trips);
                          const orderKey = isThere ? 'order_there' : 'order_back';
                          return (
                            <>
                              <h4 className="lt-stops-col-heading">
                                {isThere ? `${detailRoute.to} →` : `← ${detailRoute.from}`}
                              </h4>
                              <ul className="lt-stops-list lt-stops-list--timeline">
                                {filtered.map((s, idx) => {
                                  const order = s[orderKey];
                                  const arrivalMins = baseTime + (order - 1) * MINS_PER_STOP;
                                  const nextStop = filtered[idx + 1];
                                  const nextArrivalMins = nextStop
                                    ? baseTime + (nextStop[orderKey] - 1) * MINS_PER_STOP
                                    : null;
                                  const minsToNext = nextArrivalMins != null ? nextArrivalMins - arrivalMins : null;
                                  const isYouHere = selectedStopFromUrl && s.name === selectedStopFromUrl;
                                  return (
                                    <li
                                      key={`${isThere ? 'there' : 'back'}-${s.name}-${order}`}
                                      ref={isYouHere ? youHereRef : undefined}
                                      className={`lt-stop-item ${isYouHere ? 'lt-stop-item--you-here' : ''}`}
                                    >
                                      <span className="lt-stop-time">{formatTime(arrivalMins)}</span>
                                      <span className="lt-stop-content">
                                        {s.name}
                                        {isYouHere && <span className="lt-you-here">Ви тут</span>}
                                      </span>
                                      <span className="lt-stop-to-next">
                                        {minsToNext != null ? `${minsToNext} хв` : '—'}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </>
                          );
                        })()}
                      </div>
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
