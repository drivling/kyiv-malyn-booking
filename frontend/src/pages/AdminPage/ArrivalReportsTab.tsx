import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import type { TransportDataset } from '@/api/transportDataset';
import type { ArrivalReportDays, ArrivalReportStats } from '@/types';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles } from './kit';
import { routeColorStyleIn } from '@/pages/LocalTransportPage/routeColors';
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

type Tone = 'ok' | 'warn' | 'bad';

/** Колір відхилення: до 2 хв — вчасно; 3–7 запізнення — жовтий; більше або раніше на 3+ хв (людина не встигла) — червоний */
function delayTone(min: number): Tone {
  if (min <= -3 || min >= 8) return 'bad';
  if (min >= 3) return 'warn';
  return 'ok';
}

/** Відхилення одним кольоровим числом: «+6», «−3», «вчасно» */
function DelayPill({ min: raw, title }: { min: number | null; title?: string }) {
  if (raw === null) return <span className="arr-pill">—</span>;
  // середнє з сервера буває дробовим — хвилини цілі
  const min = Math.round(raw);
  return (
    <span className={`arr-pill arr-pill--${delayTone(min)}`} title={title}>
      {Math.abs(min) <= 1 ? 'вчасно' : `${signedMin(min)} хв`}
    </span>
  );
}

/** Шкала −10…+20 хв: смужка від мін до макс, крапка — середнє; нуль позначено */
const SCALE_MIN = -10;
const SCALE_MAX = 20;
const pos = (m: number) => `${((Math.min(SCALE_MAX, Math.max(SCALE_MIN, m)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100}%`;
function DelayRange({ min, max, avg: rawAvg }: { min: number | null; max: number | null; avg: number | null }) {
  let avg = rawAvg;
  if (min === null || max === null) return <span className="arr-range arr-range--none" aria-hidden="true" />;
  avg = avg === null ? null : Math.round(avg);
  return (
    <span className="arr-range" role="img" aria-label={`від ${signedMin(min)} до ${signedMin(max)} хв`}>
      <span className="arr-range-zero" style={{ left: pos(0) }} />
      <span className={`arr-range-bar arr-range-bar--${delayTone(max >= -min ? max : min)}`} style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)} + 4px)` }} />
      {avg !== null ? <span className={`arr-range-dot arr-range-dot--${delayTone(avg)}`} style={{ left: pos(avg) }} /> : null}
      <small>
        {signedMin(min)} … {signedMin(max)}
      </small>
    </span>
  );
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

  // проблемні вгорі: найбільше «не було», далі найбільше запізнення
  const trips = useMemo(
    () => [...(stats?.summary ?? [])].sort((a, b) => b.missed - a.missed || Math.abs(b.avgDelay ?? 0) - Math.abs(a.avgDelay ?? 0) || b.arrived - a.arrived),
    [stats],
  );
  // середнє відхилення всіх «приїхав» (зважене кількістю позначок рейсу)
  const avgAll = useMemo(() => {
    const rows = (stats?.summary ?? []).filter((r) => r.avgDelay !== null && r.arrived > 0);
    const n = rows.reduce((k, r) => k + r.arrived, 0);
    return n ? Math.round(rows.reduce((k, r) => k + (r.avgDelay as number) * r.arrived, 0) / n) : null;
  }, [stats]);
  const missedShare = stats && stats.total ? stats.missed / stats.total : 0;

  return (
    <div className="arrival-tab">
      <AdminSectionHeader
        title="Факт прибуття"
        purpose="Пасажири довгим натисканням на час рейсу позначають «автобус тут» або «автобуса не було». Відхилення — факт мінус розклад, хв: «+» — запізнився, «−» — раніше."
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
            <StatTile label="Позначок" value={stats.total} />
            <StatTile label="Середнє відхилення" value={avgAll === null ? '—' : `${signedMin(avgAll)} хв`} tone={avgAll !== null && delayTone(avgAll) === 'bad' ? 'warn' : 'default'} />
            <StatTile label="Не було" value={stats.missed} tone={missedShare >= 0.25 ? 'warn' : 'default'} sub={stats.total ? `${Math.round(missedShare * 100)} %` : undefined} />
          </StatTiles>

          <h3>Рейси на зупинках</h3>
          {trips.length === 0 ? (
            <EmptyState>За цей період позначок ще немає.</EmptyState>
          ) : (
            <ul className="arr-trips" aria-label="Рейси на зупинках">
              {trips.map((r) => (
                <li key={`${r.routeId}|${r.direction}|${r.stopId}|${r.scheduledTime}`} className="arr-trip">
                  <span className="arr-route" style={routeColorStyleIn(city, r.routeId)}>
                    {routeNo(r.routeId)}
                  </span>
                  <span className="arr-trip-what">
                    <strong>{r.scheduledTime}</strong> {stopName(r.stopId)}
                    <small>
                      {DIR_LABEL[r.direction] ?? r.direction} · позначок {r.arrived + r.missed} за {r.days} {r.days === 1 ? 'день' : r.days < 5 ? 'дні' : 'днів'}
                    </small>
                  </span>
                  <DelayRange min={r.minDelay} max={r.maxDelay} avg={r.avgDelay} />
                  <span className="arr-trip-result">
                    {r.avgDelay === null ? null : <DelayPill min={r.avgDelay} title="середнє" />}
                    {r.missed ? <span className="arr-pill arr-pill--missed">не було ×{r.missed}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3>Останні позначки</h3>
          {stats.recent.length === 0 ? (
            <EmptyState>Порожньо.</EmptyState>
          ) : (
            <ul className="arr-recent" aria-label="Останні позначки">
              {stats.recent.map((r) => (
                <li key={r.id} className={`arr-mark${r.kind === 'missed' ? ' arr-mark--missed' : ''}`}>
                  {r.kind === 'missed' ? <span className="arr-pill arr-pill--missed">не було</span> : <DelayPill min={r.delayMin} />}
                  <span className="arr-route" style={routeColorStyleIn(city, r.routeId)}>
                    {routeNo(r.routeId)}
                  </span>
                  <span className="arr-mark-what">
                    {r.scheduledTime} {r.kind === 'missed' ? (r.waitedMin ? `— чекав ${r.waitedMin} хв` : '') : `→ ${r.actualTime}`} · {stopName(r.stopId)}
                    <small>
                      {DIR_LABEL[r.direction] ?? r.direction} · {KYIV_DT.format(new Date(r.createdAt))} · {r.source === 'board' ? 'табло' : 'маршрут'}
                      {r.clientId ? (
                        <>
                          {' · '}
                          <span className="arrival-tab-client" title={r.clientId}>
                            {r.clientId.slice(0, 6)}
                          </span>
                        </>
                      ) : null}
                    </small>
                  </span>
                  <button type="button" className="admin-kit-dangerbtn" onClick={() => void remove(r.id)} aria-label={`Видалити звіт ${r.id}`} title="Видалити хибну позначку">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
};
