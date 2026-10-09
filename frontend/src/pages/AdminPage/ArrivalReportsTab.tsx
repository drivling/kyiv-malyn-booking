import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import type { TransportDataset } from '@/api/transportDataset';
import type { ArrivalReportDays, ArrivalReportStats } from '@/types';
import './ArrivalReportsTab.css';

const PERIODS: ArrivalReportDays[] = [1, 7, 30, 90];
const periodChip = (d: ArrivalReportDays) => (d === 1 ? 'Сьогодні' : `${d} днів`);
const DIR_LABEL = { there: 'туди', back: 'назад' } as const;

const KYIV_DT = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** «+6», «−3», «0» хвилин відносно розкладу */
function signedMin(n: number | null): string {
  if (n === null) return '—';
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${-n}`;
  return '0';
}

/**
 * «Факт прибуття» (/admin/arrivals): позначки пасажирів «автобус тут» / «автобуса не було»
 * (довге натискання на час рейсу на сторінці маршруту й табло). Поки лише збір статистики —
 * зведення по рейсу на зупинці (середнє, мін і макс відхилення від розкладу) і сирі звіти з
 * можливістю видалити хибний.
 */
export const ArrivalReportsTab: React.FC = () => {
  const [days, setDays] = useState<ArrivalReportDays>(30);
  const [stats, setStats] = useState<ArrivalReportStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataset, setDataset] = useState<TransportDataset | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .getTransportDataset()
      .then((d) => {
        if (alive) setDataset(d);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    apiClient
      .getArrivalReports(days)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити звіти'))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const stopName = useMemo(() => {
    const byId = new Map((dataset?.stops ?? []).map((s) => [s.id, s.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [dataset]);

  const remove = async (id: number) => {
    if (!window.confirm(`Видалити звіт #${id}?`)) return;
    try {
      await apiClient.deleteArrivalReport(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося видалити');
    }
  };

  return (
    <div className="arrival-tab">
      <div className="arrival-tab-head">
        <h2>Факт прибуття</h2>
        <div className="arrival-tab-chips" role="group" aria-label="Період">
          {PERIODS.map((d) => (
            <button key={d} type="button" className={`arrival-tab-chip ${d === days ? 'active' : ''}`} aria-pressed={d === days} onClick={() => setDays(d)}>
              {periodChip(d)}
            </button>
          ))}
          <button type="button" className="arrival-tab-chip" onClick={load}>
            Оновити
          </button>
        </div>
      </div>
      <p className="arrival-tab-note">
        Пасажири позначають, коли автобус справді приїхав (або що його не було), довгим натисканням на час рейсу на
        сторінці маршруту чи на табло зупинки. Відхилення = факт − розклад, хв; «+» — запізнення.
      </p>
      {error ? <p className="arrival-tab-error">{error}</p> : null}
      {loading && !stats ? <p>Завантаження…</p> : null}
      {stats ? (
        <>
          <div className="arrival-tab-tiles">
            <div className="arrival-tab-tile">
              <span>Усього</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="arrival-tab-tile">
              <span>Приїхав</span>
              <strong>{stats.arrived}</strong>
            </div>
            <div className="arrival-tab-tile">
              <span>Не було</span>
              <strong>{stats.missed}</strong>
            </div>
          </div>

          <h3>По рейсах на зупинках</h3>
          {stats.summary.length === 0 ? (
            <p className="arrival-tab-empty">За цей період позначок ще немає.</p>
          ) : (
            <div className="arrival-tab-scroll">
              <table className="arrival-tab-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Напрямок</th>
                    <th>Зупинка</th>
                    <th>Розклад</th>
                    <th>Приїхав</th>
                    <th>Не було</th>
                    <th>Сер.</th>
                    <th>Мін … макс</th>
                    <th>Днів</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.summary.map((r) => (
                    <tr key={`${r.routeId}|${r.direction}|${r.stopId}|${r.scheduledTime}`}>
                      <td>{r.routeId}</td>
                      <td>{DIR_LABEL[r.direction] ?? r.direction}</td>
                      <td>{stopName(r.stopId)}</td>
                      <td className="arrival-tab-num">{r.scheduledTime}</td>
                      <td className="arrival-tab-num">{r.arrived}</td>
                      <td className="arrival-tab-num">{r.missed || ''}</td>
                      <td className="arrival-tab-num">{signedMin(r.avgDelay)}</td>
                      <td className="arrival-tab-num">
                        {r.minDelay === null ? '—' : `${signedMin(r.minDelay)} … ${signedMin(r.maxDelay)}`}
                      </td>
                      <td className="arrival-tab-num">{r.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3>Останні позначки</h3>
          {stats.recent.length === 0 ? (
            <p className="arrival-tab-empty">Порожньо.</p>
          ) : (
            <div className="arrival-tab-scroll">
              <table className="arrival-tab-table">
                <thead>
                  <tr>
                    <th>Коли</th>
                    <th>№</th>
                    <th>Зупинка</th>
                    <th>Розклад</th>
                    <th>Факт</th>
                    <th>Відх.</th>
                    <th>Звідки</th>
                    <th>Пристрій</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map((r) => (
                    <tr key={r.id} className={r.kind === 'missed' ? 'arrival-tab-row--missed' : ''}>
                      <td className="arrival-tab-num">{KYIV_DT.format(new Date(r.createdAt))}</td>
                      <td>
                        {r.routeId} {DIR_LABEL[r.direction] ?? r.direction}
                      </td>
                      <td>{stopName(r.stopId)}</td>
                      <td className="arrival-tab-num">{r.scheduledTime}</td>
                      <td className="arrival-tab-num">
                        {r.kind === 'missed' ? `не було${r.waitedMin ? ` (чекав ${r.waitedMin} хв)` : ''}` : r.actualTime}
                      </td>
                      <td className="arrival-tab-num">{signedMin(r.delayMin)}</td>
                      <td>{r.source === 'board' ? 'табло' : 'маршрут'}</td>
                      <td className="arrival-tab-client" title={r.clientId ?? ''}>
                        {r.clientId ? r.clientId.slice(0, 6) : '—'}
                      </td>
                      <td>
                        <button type="button" className="arrival-tab-del" onClick={() => void remove(r.id)} aria-label={`Видалити звіт ${r.id}`}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
