import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { TransportDataset } from '@/api/transportDataset';
import { TransportMap } from './TransportMap';
import { displayNameForStopKey } from './stopCatalog';
import {
  coordsMap,
  findConnectingRoutes,
  formatDateUrl,
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
  durationFromStartMins,
} from './timing';
import './TransportPage.css';

function catalogFrom(dataset: TransportDataset) {
  const c: Record<string, { name: string }> = {};
  for (const s of dataset.stops) c[s.id] = { name: s.name };
  return c;
}

function passengerStopIds(dataset: TransportDataset): string[] {
  const ids = new Set<string>();
  for (const rs of dataset.routeStops) {
    if (!rs.mapOnly) ids.add(rs.stopId);
  }
  return [...ids].sort((a, b) => stopName(dataset, a).localeCompare(stopName(dataset, b), 'uk'));
}

function StopCombobox({
  label,
  value,
  options,
  catalog,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  catalog: Record<string, { name: string }>;
  onChange: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options.slice(0, 40);
    return options
      .filter((id) => displayNameForStopKey(id, catalog).toLowerCase().includes(needle))
      .slice(0, 40);
  }, [q, options, catalog]);

  return (
    <label className="tp-field">
      <span>{label}</span>
      <input
        value={open ? q : value ? displayNameForStopKey(value, catalog) : q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange('');
        }}
        onFocus={() => {
          setOpen(true);
          setQ(value ? displayNameForStopKey(value, catalog) : '');
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Зупинка…"
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="tp-suggest">
          {filtered.map((id) => (
            <li key={id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(id);
                  setQ('');
                  setOpen(false);
                }}
              >
                {displayNameForStopKey(id, catalog)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

export const TransportPlanner: React.FC<{ dataset: TransportDataset }> = ({ dataset }) => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const catalog = useMemo(() => catalogFrom(dataset), [dataset]);
  const stops = useMemo(() => passengerStopIds(dataset), [dataset]);
  const coords = useMemo(() => coordsMap(dataset), [dataset]);

  const fromId = params.get('from') || '';
  const toId = params.get('to') || '';
  const time = params.get('h') || formatMins(nowKyivMinutes());
  const date = params.get('d') || formatDateUrl(new Date());

  const setPair = (from: string, to: string) => {
    const next = new URLSearchParams(params);
    if (from) next.set('from', from);
    else next.delete('from');
    if (to) next.set('to', to);
    else next.delete('to');
    next.set('d', date);
    next.set('h', time);
    setParams(next, { replace: true });
  };

  const connections = useMemo(() => {
    if (!fromId || !toId || fromId === toId) return [];
    return findConnectingRoutes(dataset, fromId, toId);
  }, [dataset, fromId, toId]);

  const afterMins = parseClockToMinutes(time);

  const results = useMemo(() => {
    return connections.map(({ routeId, direction }) => {
      const route = dataset.routes.find((r) => r.id === routeId)!;
      const passenger = orderedPassengerStops(routeStopsFor(dataset, routeId), direction);
      const chain = orderedAllStops(routeStopsFor(dataset, routeId), direction);
      const chainKeys = chain.map((s) => s.stopId);
      const fromIdx = chainKeys.indexOf(fromId);
      const toIdx = chainKeys.indexOf(toId);
      const fromOffset = fromIdx >= 0 ? durationFromStartMins(dataset, routeId, chainKeys, fromIdx) : 0;
      const toOffset = toIdx >= 0 ? durationFromStartMins(dataset, routeId, chainKeys, toIdx) : 0;
      const travel = Math.max(0, Math.round(toOffset - fromOffset));
      const dirId = direction === 'there' ? '1' : '0';
      const trips = tripsForRoute(dataset, routeId)
        .filter((t) => String(t.directionId) === dirId && tripDepartureMinutes(t) > 0)
        .map((t) => {
          const dep = Math.round(tripDepartureMinutes(t) + fromOffset);
          return { trip: t, dep, arr: dep + travel };
        })
        .filter((x) => x.dep >= afterMins)
        .slice(0, 6);
      return { routeId, direction, route, travel, trips, passenger };
    });
  }, [connections, dataset, fromId, toId, afterMins]);

  const mapLine = useMemo(() => {
    if (results.length === 1) {
      return orderedAllStops(routeStopsFor(dataset, results[0].routeId), results[0].direction).map(
        (s) => s.stopId
      );
    }
    return [];
  }, [results, dataset]);

  return (
    <div className="tp-shell">
      <TransportMap
        center={mapCenter(dataset)}
        stops={coords}
        lineStopIds={mapLine}
        markerStopIds={stops}
        fromId={fromId || undefined}
        toId={toId || undefined}
        stopLabel={(id) => displayNameForStopKey(id, catalog)}
        onPickStop={(id) => {
          if (!fromId || (fromId && toId)) setPair(id, '');
          else if (fromId && !toId) setPair(fromId, id);
        }}
        className="tp-map tp-map--full"
      />

      <aside className="tp-panel">
        <header className="tp-panel-head">
          <h1>Транспорт Малина</h1>
          <nav className="tp-subnav">
            <Link to="/transport" className="tp-subnav-link tp-subnav-link--active">
              Маршрути
            </Link>
            <Link to="/transport/routes" className="tp-subnav-link">
              Усі лінії
            </Link>
            <Link to="/transport/stop" className="tp-subnav-link">
              Табло
            </Link>
          </nav>
        </header>

        <div className="tp-planner">
          <StopCombobox
            label="Звідки"
            value={fromId}
            options={stops}
            catalog={catalog}
            onChange={(id) => setPair(id, toId)}
          />
          <button
            type="button"
            className="tp-swap"
            aria-label="Поміняти місцями"
            onClick={() => setPair(toId, fromId)}
          >
            ⇄
          </button>
          <StopCombobox
            label="Куди"
            value={toId}
            options={stops}
            catalog={catalog}
            onChange={(id) => setPair(fromId, id)}
          />
          <div className="tp-datetime">
            <label className="tp-field">
              <span>Дата</span>
              <input
                value={date}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  next.set('d', e.target.value);
                  setParams(next, { replace: true });
                }}
                placeholder="ДД.ММ.РР"
              />
            </label>
            <label className="tp-field">
              <span>Час</span>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  next.set('h', e.target.value);
                  setParams(next, { replace: true });
                }}
              />
            </label>
          </div>
        </div>

        <div className="tp-results">
          {!fromId || !toId ? (
            <p className="tp-muted">Оберіть зупинки «Звідки» і «Куди» — або тапніть на карті.</p>
          ) : results.length === 0 ? (
            <p className="tp-muted">Немає прямого маршруту між цими зупинками.</p>
          ) : (
            results.map((r) => (
              <article key={`${r.routeId}-${r.direction}`} className="tp-result">
                <div className="tp-result-head">
                  <span className="tp-line">{r.routeId}</span>
                  <div>
                    <strong>
                      {r.route.fromName} — {r.route.toName}
                    </strong>
                    <div className="tp-muted">
                      {r.direction === 'there' ? '→' : '←'} · ~{r.travel} хв у дорозі · {r.trips.length} рейсів
                    </div>
                  </div>
                </div>
                <ul className="tp-times">
                  {r.trips.map((t) => (
                    <li key={t.trip.id}>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/transport/route/${r.routeId}?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&dir=${r.direction}&h=${formatMins(t.dep)}&d=${encodeURIComponent(date)}`
                          )
                        }
                      >
                        <span>{formatMins(t.dep)}</span>
                        <span className="tp-muted">→ {formatMins(t.arr)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Link
                  className="tp-more"
                  to={`/transport/route/${r.routeId}?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&dir=${r.direction}&d=${encodeURIComponent(date)}&h=${encodeURIComponent(time)}`}
                >
                  Деталі маршруту →
                </Link>
              </article>
            ))
          )}
        </div>
      </aside>
    </div>
  );
};
