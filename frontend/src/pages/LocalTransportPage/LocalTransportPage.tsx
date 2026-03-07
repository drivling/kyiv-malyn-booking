import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
        from: v.from,
        to: v.to,
        trips: v.trips,
        supplement: sup,
      };
    })
    .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
}

function buildStops(routes: ReturnType<typeof buildRoutes>): string[] {
  const stopSet = new Set<string>();
  routes.forEach((r) => {
    if (r.from) stopSet.add(r.from);
    if (r.to) stopSet.add(r.to);
  });
  ['Малинівка', 'Юрівка', 'БАМ', 'Царське село'].forEach((s) => stopSet.add(s));
  return [...stopSet].sort((a, b) => a.localeCompare(b));
}

export const LocalTransportPage: React.FC = () => {
  const [data, setData] = useState<TransportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stopFilter, setStopFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [detailRouteId, setDetailRouteId] = useState<string | null>(null);

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
  const stops = useMemo(() => buildStops(routes), [routes]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (routeFilter && r.id !== routeFilter) return false;
      if (stopFilter) {
        const match =
          r.from === stopFilter ||
          r.to === stopFilter ||
          (r.from?.includes(stopFilter) ?? false) ||
          (r.to?.includes(stopFilter) ?? false);
        if (!match) return false;
      }
      return true;
    });
  }, [routes, stopFilter, routeFilter]);

  const detailRoute = useMemo(
    () => (detailRouteId ? routes.find((r) => r.id === detailRouteId) : null),
    [routes, detailRouteId]
  );

  const handleBack = useCallback(() => setDetailRouteId(null), []);

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
      <div className="local-transport-page">
        <div className="local-transport-container">
          <p className="local-transport-loading">Завантаження даних...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="local-transport-page">
        <div className="local-transport-container">
          <div className="local-transport-error">
            <p>{error || 'Дані не завантажені'}</p>
            <p className="local-transport-error-hint">
              Переконайтеся, що файл data/malyn_transport.json існує. Запустіть{' '}
              <code>python scripts/parse_malyn_transport.py</code> для оновлення.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const supplement = data.supplement;
  const fare = supplement?.fare ? `${supplement.fare.amount} грн` : null;

  return (
    <div className="local-transport-page">
      <div className="local-transport-container">
        {detailRouteId && detailRoute ? (
          <div className="local-transport-detail-view">
            <button type="button" className="local-transport-back-btn" onClick={handleBack}>
              ← Назад до списку
            </button>
            <div className="local-transport-route-detail">
              <h2>
                <span className="local-transport-route-num">{detailRoute.id}</span>{' '}
                {detailRoute.from ?? '?'} ↔ {detailRoute.to ?? '?'}
              </h2>
              {fare && (
                <p className="local-transport-fare">
                  <span className="local-transport-fare-badge">Проїзд {fare}</span>
                </p>
              )}
              <p className="local-transport-meta">
                {detailRoute.trips.length
                  ? `Графік: пн–нд · ${detailRoute.trips.length} рейсів`
                  : 'Дані з malyn.media'}
              </p>

              {detailRoute.supplement && (
                <div className="local-transport-supplement">
                  <h3>📰 Додаткова інформація (malyn.media)</h3>
                  {detailRoute.supplement.scheme && (
                    <p>
                      <strong>Схема:</strong> {detailRoute.supplement.scheme}
                    </p>
                  )}
                  {detailRoute.supplement.special && (
                    <p>
                      <strong>Особливості:</strong> {detailRoute.supplement.special}
                    </p>
                  )}
                  {detailRoute.supplement.interval_min && (
                    <p>
                      <strong>Інтервал:</strong>{' '}
                      {detailRoute.supplement.interval_min}–
                      {detailRoute.supplement.interval_max ?? detailRoute.supplement.interval_min}{' '}
                      хв
                    </p>
                  )}
                  {detailRoute.supplement.schedule && (
                    <>
                      <p>
                        <strong>Розклад:</strong>
                      </p>
                      <ul>
                        {detailRoute.supplement.schedule.from_bazar && (
                          <li>З Базарної площі: {detailRoute.supplement.schedule.from_bazar}</li>
                        )}
                        {detailRoute.supplement.schedule.from_oleksy_tikh && (
                          <li>
                            Від вул. Олекси Тихого: {detailRoute.supplement.schedule.from_oleksy_tikh}
                          </li>
                        )}
                        {detailRoute.supplement.schedule.first_trip && (
                          <li>Перший рейс: {detailRoute.supplement.schedule.first_trip}</li>
                        )}
                        {detailRoute.supplement.schedule.to_center && (
                          <li>До центру: {detailRoute.supplement.schedule.to_center}</li>
                        )}
                        {detailRoute.supplement.schedule.lunch_break && (
                          <li>Перерва: {detailRoute.supplement.schedule.lunch_break}</li>
                        )}
                      </ul>
                    </>
                  )}
                  {detailRoute.supplement.note && (
                    <p className="local-transport-supplement-note">{detailRoute.supplement.note}</p>
                  )}
                  {detailRoute.supplement.source_url && (
                    <p>
                      <a
                        href={detailRoute.supplement.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="local-transport-source-link"
                      >
                        Джерело: malyn.media
                      </a>
                    </p>
                  )}
                </div>
              )}

              {detailRoute.trips.length > 0 && (
                <table className="local-transport-trips-table">
                  <thead>
                    <tr>
                      <th>Рейс</th>
                      <th>Напрямок</th>
                      <th>Час / Автобус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRoute.trips.map((t) => (
                      <tr key={t.trip_id}>
                        <td>{t.trip_id}</td>
                        <td>
                          <span className="local-transport-dir-badge">
                            {t.direction_id === '0'
                              ? `${detailRoute.from} →`
                              : `→ ${detailRoute.to}`}
                          </span>
                        </td>
                        <td>{t.block_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="local-transport-header">
              <h1>Місцевий транспорт Малина</h1>
              <p className="local-transport-subtitle">
                Маршрути та розклади громадського транспорту міста Малин
              </p>
            </div>

            <div className="local-transport-filters">
              <Select
                label="Фільтр по зупинці"
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

            <div className="local-transport-route-list">
              {filteredRoutes.length === 0 ? (
                <div className="local-transport-empty">
                  <p>Маршрутів не знайдено</p>
                  <p>Спробуйте змінити фільтри</p>
                </div>
              ) : (
                filteredRoutes.map((r) => {
                  const meta = r.trips.length
                    ? `${r.trips.length} рейсів · щодня`
                    : r.supplement
                      ? 'malyn.media'
                      : 'щодня';
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="local-transport-route-card"
                      onClick={() => setDetailRouteId(r.id)}
                    >
                      <div className="local-transport-route-header">
                        <span className="local-transport-route-num">{r.id}</span>
                        <span className="local-transport-route-path">
                          {r.from ?? '?'} <span className="local-transport-arrow">↔</span>{' '}
                          {r.to ?? '?'}
                        </span>
                      </div>
                      <div className="local-transport-route-meta">{meta}</div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        <footer className="local-transport-footer">
          Дані:{' '}
          <a
            href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36"
            target="_blank"
            rel="noopener noreferrer"
          >
            data.gov.ua
          </a>
          {' · '}
          Оновлено: березень 2024 · Розклад уточнюйте на автостанції{' '}
          <a href="tel:+380687771590">(068) 77-71-590</a>
        </footer>
      </div>
    </div>
  );
};
