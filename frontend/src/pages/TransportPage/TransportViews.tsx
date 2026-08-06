import React, { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { TransportDataset } from '@/api/transportDataset';
import { TransportMap } from './TransportMap';
import { displayNameForStopKey } from './stopCatalog';
import {
  coordsMap,
  departuresAtStop,
  durationFromStartMins,
  formatMins,
  mapCenter,
  nowKyivMinutes,
  orderedAllStops,
  orderedPassengerStops,
  parseClockToMinutes,
  routeStopsFor,
  stopName,
  tripDepartureMinutes,
  tripsForRoute,
} from './timing';

function catalogFrom(dataset: TransportDataset) {
  const c: Record<string, { name: string }> = {};
  for (const s of dataset.stops) c[s.id] = { name: s.name };
  return c;
}

export const TransportRoutes: React.FC<{ dataset: TransportDataset }> = ({ dataset }) => {
  const routes = [...dataset.routes].sort((a, b) => Number(a.id) - Number(b.id));
  return (
    <div className="tp-page">
      <header className="tp-page-head">
        <h1>Усі маршрути</h1>
        <nav className="tp-subnav">
          <Link to="/transport" className="tp-subnav-link">
            Планер
          </Link>
          <Link to="/transport/routes" className="tp-subnav-link tp-subnav-link--active">
            Усі лінії
          </Link>
          <Link to="/transport/stop" className="tp-subnav-link">
            Табло
          </Link>
        </nav>
      </header>
      <ul className="tp-route-list">
        {routes.map((r) => {
          const timed = tripsForRoute(dataset, r.id).filter((t) => tripDepartureMinutes(t) > 0).length;
          return (
            <li key={r.id}>
              <Link to={`/transport/route/${r.id}`}>
                <span className="tp-line">{r.id}</span>
                <span>
                  <strong>
                    {r.fromName} — {r.toName}
                  </strong>
                  <div className="tp-muted">{timed ? `${timed} рейсів з розкладом` : 'Без точних часів'}</div>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const TransportRouteDetail: React.FC<{ dataset: TransportDataset }> = ({ dataset }) => {
  const { routeId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const route = dataset.routes.find((r) => r.id === routeId);
  const catalog = useMemo(() => catalogFrom(dataset), [dataset]);
  const coords = useMemo(() => coordsMap(dataset), [dataset]);
  const direction = params.get('dir') === 'back' ? 'back' : 'there';
  const fromId = params.get('from') || '';
  const toId = params.get('to') || '';
  const time = params.get('h') || '';

  if (!route) {
    return (
      <div className="tp-page">
        <p>Маршрут №{routeId} не знайдено.</p>
        <Link to="/transport/routes">← До списку</Link>
      </div>
    );
  }

  const passenger = orderedPassengerStops(routeStopsFor(dataset, routeId), direction);
  const chain = orderedAllStops(routeStopsFor(dataset, routeId), direction);
  const chainKeys = chain.map((s) => s.stopId);
  const dirId = direction === 'there' ? '1' : '0';
  const trips = tripsForRoute(dataset, routeId)
    .filter((t) => String(t.directionId) === dirId && tripDepartureMinutes(t) > 0)
    .map((t) => {
      const base = tripDepartureMinutes(t);
      const fromIdx = fromId ? chainKeys.indexOf(fromId) : 0;
      const toIdx = toId ? chainKeys.indexOf(toId) : Math.max(0, chainKeys.length - 1);
      const fromOff = fromIdx >= 0 ? durationFromStartMins(dataset, routeId, chainKeys, fromIdx) : 0;
      const toOff = toIdx >= 0 ? durationFromStartMins(dataset, routeId, chainKeys, toIdx) : 0;
      return {
        trip: t,
        dep: Math.round(base + fromOff),
        arr: Math.round(base + toOff),
      };
    });

  const selected = time ? trips.find((t) => formatMins(t.dep) === time) || trips[0] : trips[0];

  return (
    <div className="tp-route-detail">
      <header className="tp-route-bar">
        <button type="button" className="tp-back" onClick={() => navigate(-1)}>
          ←
        </button>
        <span className="tp-line">{routeId}</span>
        <div className="tp-route-bar-text">
          <strong>
            {fromId && toId
              ? `${displayNameForStopKey(fromId, catalog)} → ${displayNameForStopKey(toId, catalog)}`
              : `${route.fromName} — ${route.toName}`}
          </strong>
        </div>
      </header>

      <div className="tp-dir-switch">
        <button
          type="button"
          className={direction === 'there' ? 'active' : ''}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('dir', 'there');
            navigate(`/transport/route/${routeId}?${next}`, { replace: true });
          }}
        >
          → {route.toName}
        </button>
        <button
          type="button"
          className={direction === 'back' ? 'active' : ''}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('dir', 'back');
            navigate(`/transport/route/${routeId}?${next}`, { replace: true });
          }}
        >
          ← {route.fromName}
        </button>
      </div>

      <TransportMap
        center={mapCenter(dataset)}
        stops={coords}
        lineStopIds={chainKeys}
        markerStopIds={passenger.map((s) => s.stopId)}
        fromId={fromId || undefined}
        toId={toId || undefined}
        stopLabel={(id) => displayNameForStopKey(id, catalog)}
        className="tp-map tp-map--detail"
      />

      <section className="tp-section">
        <h2>Розклад</h2>
        {trips.length === 0 ? (
          <p className="tp-muted">Немає рейсів з точним часом для цього напрямку.</p>
        ) : (
          <table className="tp-table">
            <thead>
              <tr>
                <th>Відправлення</th>
                <th>Прибуття</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.trip.id} className={selected?.trip.id === t.trip.id ? 'tp-row--active' : ''}>
                  <td>{formatMins(t.dep)}</td>
                  <td>{formatMins(t.arr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="tp-section">
        <h2>Зупинки</h2>
        <ol className="tp-stop-timeline">
          {passenger.map((s, i) => {
            const chainIdx = chainKeys.indexOf(s.stopId);
            const offset = chainIdx >= 0 ? durationFromStartMins(dataset, routeId, chainKeys, chainIdx) : 0;
            const base = selected ? tripDepartureMinutes(selected.trip) : 0;
            const at = base > 0 ? formatMins(Math.round(base + offset)) : '—';
            const isFrom = s.stopId === fromId;
            const isTo = s.stopId === toId;
            const next = passenger[i + 1];
            const nextIdx = next ? chainKeys.indexOf(next.stopId) : -1;
            const segMins =
              nextIdx >= 0
                ? Math.round(durationFromStartMins(dataset, routeId, chainKeys, nextIdx) - offset)
                : 0;
            return (
              <li key={s.stopId} className={isFrom ? 'from' : isTo ? 'to' : ''}>
                <Link to={`/transport/stop/${encodeURIComponent(s.stopId)}`}>
                  <span className="tp-stop-time">{at}</span>
                  <span>
                    {stopName(dataset, s.stopId)}
                    {isFrom ? ' · З' : isTo ? ' · До' : ''}
                  </span>
                </Link>
                {next && <span className="tp-seg">{segMins} хв</span>}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
};

export const TransportStopBoard: React.FC<{ dataset: TransportDataset }> = ({ dataset }) => {
  const { stopId: stopParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const catalog = useMemo(() => catalogFrom(dataset), [dataset]);
  const stopId = stopParam ? decodeURIComponent(stopParam) : '';
  const afterMins = params.get('h') ? parseClockToMinutes(params.get('h')!) : nowKyivMinutes();
  const timeValue = params.get('h') || formatMins(nowKyivMinutes());
  const rows = stopId ? departuresAtStop(dataset, stopId, afterMins) : [];

  const stops = useMemo(
    () =>
      [...new Set(dataset.routeStops.filter((r) => !r.mapOnly).map((r) => r.stopId))].sort((a, b) =>
        stopName(dataset, a).localeCompare(stopName(dataset, b), 'uk')
      ),
    [dataset]
  );

  return (
    <div className="tp-page">
      <header className="tp-page-head">
        <h1>Табло зупинки</h1>
        <nav className="tp-subnav">
          <Link to="/transport" className="tp-subnav-link">
            Планер
          </Link>
          <Link to="/transport/routes" className="tp-subnav-link">
            Усі лінії
          </Link>
          <Link to="/transport/stop" className="tp-subnav-link tp-subnav-link--active">
            Табло
          </Link>
        </nav>
      </header>

      <label className="tp-field">
        <span>Зупинка</span>
        <select
          value={stopId}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              navigate(`/transport/stop/${encodeURIComponent(id)}?h=${encodeURIComponent(timeValue)}`);
            } else navigate('/transport/stop');
          }}
        >
          <option value="">Оберіть…</option>
          {stops.map((id) => (
            <option key={id} value={id}>
              {displayNameForStopKey(id, catalog)}
            </option>
          ))}
        </select>
      </label>

      <label className="tp-field">
        <span>Від часу</span>
        <input
          type="time"
          value={timeValue}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            next.set('h', e.target.value);
            if (stopId) {
              navigate(`/transport/stop/${encodeURIComponent(stopId)}?${next}`, { replace: true });
            } else {
              setParams(next, { replace: true });
            }
          }}
        />
      </label>

      {!stopId ? (
        <p className="tp-muted">Оберіть зупинку, щоб побачити найближчі відправлення.</p>
      ) : rows.length === 0 ? (
        <p className="tp-muted">Немає рейсів після обраного часу.</p>
      ) : (
        <table className="tp-table">
          <thead>
            <tr>
              <th>Час</th>
              <th>№</th>
              <th>Напрямок</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={`${r.tripId}-${r.departureMins}`}>
                <td>
                  <Link
                    to={`/transport/route/${r.routeId}?from=${encodeURIComponent(stopId)}&dir=${r.direction}&h=${formatMins(r.departureMins)}`}
                  >
                    {formatMins(r.departureMins)}
                  </Link>
                </td>
                <td>
                  <span className="tp-line">{r.routeId}</span>
                </td>
                <td>{r.destination}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
