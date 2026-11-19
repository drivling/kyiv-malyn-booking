import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import type { TransportDataset } from '@/api/transportDataset';
import type { ArrivalReportDays, ArrivalReportStats } from '@/types';
import { AdminSectionHeader, ChipGroup, EmptyState, ResponsiveTable, StatTile, StatTiles, type TableColumn } from './kit';
import './ArrivalReportsTab.css';
import { routeNo } from '@/utils/routeNames';

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
 * можливістю видалити хибний. Зібрано зі спільних деталей адмінки (`kit/`, Docs/dovede-admin-roadmap.md, крок 12).
 */
/** city — місто звітів (перемикач над вкладками, фаза 6 плану Коростеня); без нього — Малин */
export const ArrivalReportsTab: React.FC<{ city?: string }> = ({ city = DEFAULT_TRANSPORT_CITY }) => {
  const [days, setDays] = useState<ArrivalReportDays>(30);
  const [stats, setStats] = useState<ArrivalReportStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataset, setDataset] = useState<TransportDataset | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .getTransportDataset({ city })
      .then((d) => {
        if (alive) setDataset(d);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [city]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    apiClient
      .getArrivalReports(days, city)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити звіти'))
      .finally(() => setLoading(false));
  }, [days, city]);

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
      await apiClient.deleteArrivalReport(id, city);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося видалити');
    }
  };

  const summaryColumns: ReadonlyArray<TableColumn<ArrivalReportStats['summary'][number]>> = [
    { key: 'route', label: '№', render: (r) => routeNo(r.routeId) },
    { key: 'dir', label: 'Напрямок', render: (r) => DIR_LABEL[r.direction] ?? r.direction },
    { key: 'stop', label: 'Зупинка', render: (r) => stopName(r.stopId) },
    { key: 'time', label: 'Розклад', num: true, render: (r) => r.scheduledTime },
    { key: 'arrived', label: 'Приїхав', num: true, render: (r) => r.arrived },
    { key: 'missed', label: 'Не було', num: true, render: (r) => r.missed || '' },
    { key: 'avg', label: 'Сер.', num: true, render: (r) => signedMin(r.avgDelay) },
    { key: 'range', label: 'Мін … макс', num: true, render: (r) => (r.minDelay === null ? '—' : `${signedMin(r.minDelay)} … ${signedMin(r.maxDelay)}`) },
    { key: 'days', label: 'Днів', num: true, render: (r) => r.days },
  ];

  const recentColumns: ReadonlyArray<TableColumn<ArrivalReportStats['recent'][number]>> = [
    { key: 'at', label: 'Коли', num: true, render: (r) => KYIV_DT.format(new Date(r.createdAt)) },
    { key: 'route', label: '№', render: (r) => `${routeNo(r.routeId)} ${DIR_LABEL[r.direction] ?? r.direction}` },
    { key: 'stop', label: 'Зупинка', render: (r) => stopName(r.stopId) },
    { key: 'time', label: 'Розклад', num: true, render: (r) => r.scheduledTime },
    { key: 'actual', label: 'Факт', num: true, render: (r) => (r.kind === 'missed' ? `не було${r.waitedMin ? ` (чекав ${r.waitedMin} хв)` : ''}` : r.actualTime) },
    { key: 'delay', label: 'Відх.', num: true, render: (r) => signedMin(r.delayMin) },
    { key: 'source', label: 'Звідки', render: (r) => (r.source === 'board' ? 'табло' : 'маршрут') },
    {
      key: 'client',
      label: 'Пристрій',
      render: (r) => (
        <span className="arrival-tab-client" title={r.clientId ?? ''}>
          {r.clientId ? r.clientId.slice(0, 6) : '—'}
        </span>
      ),
    },
    {
      key: 'del',
      label: '',
      render: (r) => (
        <button type="button" className="admin-kit-dangerbtn" onClick={() => void remove(r.id)} aria-label={`Видалити звіт ${r.id}`}>
          ×
        </button>
      ),
    },
  ];

  const missedShare = stats && stats.total ? stats.missed / stats.total : 0;

  return (
    <div className="arrival-tab">
      <AdminSectionHeader
        title="Факт прибуття"
        purpose="Пасажири позначають, коли автобус справді приїхав (або що його не було), довгим натисканням на час рейсу на сторінці маршруту чи на табло зупинки. Відхилення = факт − розклад, хв; «+» — запізнення."
        actions={
          <>
            <ChipGroup label="Період" options={PERIODS.map((d) => ({ value: d, label: periodChip(d) }))} value={days} onChange={setDays} />
            <button type="button" className="admin-kit-chip" onClick={load}>
              Оновити
            </button>
          </>
        }
      />
      {error ? (
        <p className="arrival-tab-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !stats ? <p className="arrival-tab-note">Завантаження…</p> : null}
      {stats ? (
        <>
          <StatTiles label="За період">
            <StatTile label="Усього позначок" value={stats.total} />
            <StatTile label="Приїхав" value={stats.arrived} />
            <StatTile label="Не було" value={stats.missed} tone={missedShare >= 0.25 ? 'warn' : 'default'} sub={stats.total ? `${Math.round(missedShare * 100)} %` : undefined} />
          </StatTiles>

          <h3>По рейсах на зупинках</h3>
          {stats.summary.length === 0 ? (
            <EmptyState>За цей період позначок ще немає.</EmptyState>
          ) : (
            <ResponsiveTable columns={summaryColumns} rows={stats.summary} rowKey={(r) => `${r.routeId}|${r.direction}|${r.stopId}|${r.scheduledTime}`} />
          )}

          <h3>Останні позначки</h3>
          {stats.recent.length === 0 ? (
            <EmptyState>Порожньо.</EmptyState>
          ) : (
            <ResponsiveTable columns={recentColumns} rows={stats.recent} rowKey={(r) => r.id} rowClassName={(r) => (r.kind === 'missed' ? 'arrival-tab-row--missed' : undefined)} />
          )}
        </>
      ) : null}
    </div>
  );
};
