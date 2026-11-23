import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { GpsRunTimesReport } from '@/types';
import { ChipGroup, EmptyState } from './kit';
import { CONFIDENCE_LABEL, DIRECTION_LABEL, TIME_VERDICT_LABEL, difference, isNotable, minutes, splitCandidates, wholeMinutes } from './gpsRunTimesText';
import './GpsRunTimesPanel.css';

const PERIODS = [
  { value: 3, label: '3 дні' },
  { value: 7, label: '7 днів' },
  { value: 14, label: '14 днів' },
  { value: 30, label: '30 днів' },
];

const KYIV_DAY = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
const day = (iso: string | null) => (iso ? KYIV_DAY.format(new Date(iso)) : '—');

/**
 * «Час у дорозі за GPS» (Docs/dovede-learning-roadmap.md, крок 6): по кожному відрізку між зупинками — наш час із
 * сегментів і час, за який автобуси справді його проїжджають (з GPS-треків). Лише показує; сегменти не міняє.
 * Рахується на сервері з усіх точок за період, тому вантажиться, коли картку відкрили.
 */
/** defaultOpen — у власному розділі «Час у дорозі за GPS» панель розкрита одразу */
export const GpsRunTimesPanel: React.FC<{ city: string; defaultOpen?: boolean }> = ({ city, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<GpsRunTimesReport | null>(null);
  const [error, setError] = useState('');
  const [onlyNotable, setOnlyNotable] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setData(null);
    try {
      setData(await apiClient.getGpsRunTimes(city, days));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося порахувати час за GPS');
    }
  }, [city, days]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <details className="gps-times" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="gps-times-summary">Час у дорозі за GPS</summary>
      {open ? (
        <div className="gps-times-body">
          <div className="gps-times-toolbar">
            <ChipGroup label="Період" options={PERIODS} value={days} onChange={setDays} />
            <label className="gps-times-check">
              <input type="checkbox" checked={onlyNotable} onChange={(e) => setOnlyNotable(e.target.checked)} /> лише помітні різниці
            </label>
          </div>
          {error ? (
            <p className="gps-times-error" role="alert">
              {error}
            </p>
          ) : null}
          {!data && !error ? <p className="gps-times-hint">Рахую…</p> : null}
          {data && !data.points ? <EmptyState>Даних ще немає: GPS-точок автобусів цього міста за вибраний період немає.</EmptyState> : null}
          {data && data.points ? (
            <>
              <p className="gps-times-hint">
                {data.points.toLocaleString('uk-UA')} точок за {day(data.from)}–{day(data.to)}. Точка автобуса приходить раз на кілька хвилин, тому час
                сусідніх коротких відрізків згладжений: число надійне для ділянки 1–2 км, а не для кожних 300 м окремо. Тут лише порівняння — сегменти не
                змінюються.
              </p>
              {data.unknownRouteNos.length ? <p className="gps-times-hint">Номери з GPS, яких немає серед маршрутів: {data.unknownRouteNos.join(', ')}.</p> : null}
              {data.timeCheck ? <TimeCheck check={data.timeCheck} /> : null}
              {data.routes.map((route) => (
                <section key={route.routeId} className="gps-times-route" aria-label={`Маршрут №${route.routeNo}`}>
                  <h4>№{route.routeNo}</h4>
                  {route.directions.map((d) => {
                    const spans = onlyNotable ? d.spans.filter(isNotable) : d.spans;
                    return (
                      <div key={d.direction} className="gps-times-direction">
                        <p className="gps-times-total">
                          <strong>{DIRECTION_LABEL[d.direction]}</strong> · {(d.meters / 1000).toFixed(1).replace('.', ',')} км · наш час {minutes(d.ourSec)} · за GPS{' '}
                          {minutes(d.gpsSec)}
                          {d.gpsSec !== null && d.covered < 1 ? ` (дані для ${Math.round(d.covered * 100)} % шляху)` : ''}
                          {d.timetableSec !== null ? ` · у розкладі ${minutes(d.timetableSec)}` : ''}
                        </p>
                        {spans.length ? (
                          <table className="gps-times-table dovede-log-table dovede-log-table--cards">
                            <thead>
                              <tr>
                                <th>Відрізок</th>
                                <th>Довжина</th>
                                <th>Наш час</th>
                                <th>За GPS</th>
                                <th>Різниця</th>
                                <th>Проїздів</th>
                              </tr>
                            </thead>
                            <tbody>
                              {spans.map((s) => (
                                <tr key={`${s.fromStopId}-${s.toStopId}`} className={s.confidence === 'ok' ? (isNotable(s) ? 'is-notable' : '') : 'is-weak'}>
                                  <td data-label="Відрізок">
                                    {s.fromName} → {s.toName}
                                  </td>
                                  <td data-label="Довжина">{s.meters} м</td>
                                  <td data-label="Наш час">{minutes(s.ourSec)}</td>
                                  <td data-label="За GPS">{minutes(s.gpsSec)}</td>
                                  <td data-label="Різниця">{difference(s.ourSec, s.gpsSec)}</td>
                                  <td data-label="Проїздів">
                                    {Math.round(s.passes)}
                                    {CONFIDENCE_LABEL[s.confidence] ? ` · ${CONFIDENCE_LABEL[s.confidence]}` : ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="gps-times-hint">Помітних різниць немає.</p>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  );
};

/**
 * Ділянки звірки з Google (початок → кінець, початок → середина, середина → кінець кожного напрямку) трьома джерелами:
 * наш час, GPS (головний) і Google (друга думка). Кандидати на «Перерахувати час» — угорі.
 */
const TimeCheck: React.FC<{ check: NonNullable<GpsRunTimesReport['timeCheck']> }> = ({ check }) => {
  const { todo, confirmed } = splitCandidates(check.candidates);
  return (
    <section className="gps-times-check-block" aria-label="Звірка хвилин: GPS і Google">
      <h4>Наш час, GPS і Google</h4>
      <p className="gps-times-hint">
        Ділянки зі звірки з Google ({day(check.finishedAt)}). GPS — головне джерело, Google — друга думка. {confirmed ? `GPS підтверджує наш час на ${confirmed} ділянках.` : ''}
      </p>
      {todo.length ? (
        <table className="gps-times-table dovede-log-table dovede-log-table--cards">
          <thead>
            <tr>
              <th>Маршрут</th>
              <th>Ділянка</th>
              <th>Наш час</th>
              <th>За GPS</th>
              <th>Google</th>
              <th>Що робити</th>
            </tr>
          </thead>
          <tbody>
            {todo.map((c) => (
              <tr key={`${c.routeNo}-${c.direction}-${c.from}-${c.to}`} className={c.verdict === 'google_only' || c.weak ? 'is-weak' : 'is-notable'}>
                <td data-label="Маршрут">
                  №{c.routeNo} · {DIRECTION_LABEL[c.direction].toLowerCase()}
                </td>
                <td data-label="Ділянка">
                  {c.from} → {c.to}
                </td>
                <td data-label="Наш час">{wholeMinutes(c.ourMin)}</td>
                <td data-label="За GPS">{wholeMinutes(c.gpsMin)}</td>
                <td data-label="Google">{wholeMinutes(c.googleMin)}</td>
                <td data-label="Що робити">
                  {TIME_VERDICT_LABEL[c.verdict]}
                  {c.weak ? ' · мало проїздів' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="gps-times-hint">Кандидатів на перерахунок немає.</p>
      )}
    </section>
  );
};
