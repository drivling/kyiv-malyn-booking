import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Select } from '@/components/Select';
import type { SupplementRoute, TransportData, TransportRecord } from './types';
import './LocalTransportPage.css';

const DATA_URL = '/data/malyn_transport.json';

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

function buildStops(
  routes: ReturnType<typeof buildRoutes>,
  stopsByRoute?: Record<string, string[]>
): string[] {
  const stopSet = new Set<string>();
  routes.forEach((r) => {
    if (r.from) stopSet.add(r.from);
    if (r.to) stopSet.add(r.to);
  });
  if (stopsByRoute) {
    Object.values(stopsByRoute).forEach((stops) => stops.forEach((s) => stopSet.add(s)));
  }
  ['Малинівка', 'Юрівка', 'БАМ', 'Царське село'].forEach((s) => stopSet.add(s));
  return [...stopSet].sort((a, b) => a.localeCompare(b));
}

function routeHasStop(
  routeId: string,
  stopName: string,
  route: { from: string | null; to: string | null },
  stopsByRoute?: Record<string, string[]>
): boolean {
  if (route.from === stopName || route.to === stopName) return true;
  const routeStops = stopsByRoute?.[routeId];
  if (routeStops?.includes(stopName)) return true;
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


export const LocalTransportPage: React.FC = () => {
  const { routeId } = useParams<{ routeId?: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TransportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stopFilter, setStopFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');

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

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (routeFilter && r.id !== routeFilter) return false;
      if (stopFilter && !routeHasStop(r.id, stopFilter, r, stopsByRoute)) return false;
      return true;
    });
  }, [routes, stopFilter, routeFilter, stopsByRoute]);

  const detailRoute = useMemo(
    () => (routeId ? routes.find((r) => r.id === routeId) : null),
    [routes, routeId]
  );

  const handleSelectRoute = (id: string) => navigate(`/localtransport/route/${id}`);
  const handleBack = () => navigate('/localtransport');

  const stopOptions = useMemo(
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
            {(() => {
              const routeStops = stopsByRoute?.[detailRoute.id];
              return routeStops && routeStops.length > 0 ? (
                <div className="lt-stops">
                  <h3 className="lt-stops-heading">Зупинки на маршруті</h3>
                  <ul className="lt-stops-list">
                    {routeStops.map((s) => (
                      <li key={s} className="lt-stop-item">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}
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
                          {dir1.map((t) => (
                            <span key={t.trip_id} className="lt-time">
                              {t.block_id || '—'}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="lt-timetable-col">
                        <h3 className="lt-timetable-heading">
                          ← {detailRoute.from}
                        </h3>
                        <div className="lt-times">
                          {dir0.map((t) => (
                            <span key={t.trip_id} className="lt-time">
                              {t.block_id || '—'}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        ) : (
          <>
            <header className="lt-header">
              <h1 className="lt-title">Розклад руху</h1>
              <p className="lt-subtitle">Малин · місцевий транспорт</p>
            </header>

            <div className="lt-search">
              <Select
                label="Зупинка"
                options={stopOptions}
                value={stopFilter}
                onChange={(e) => setStopFilter(e.target.value)}
              />
              <Select
                label="Маршрут"
                options={routeOptions}
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
              />
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
