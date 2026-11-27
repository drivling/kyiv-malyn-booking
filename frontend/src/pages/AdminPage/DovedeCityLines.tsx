import React, { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeKyivLines, DovedeLineKind } from '@/types';
import { StatTile, StatTiles } from './kit';

/** Вид лінії для людини */
const LINE_KIND_LABEL: Record<DovedeLineKind, string> = {
  kpt: 'Київпастранс',
  taxi: 'маршрутки з переліку',
  metro: 'метро',
  ring: 'кільцева електричка',
  rail: 'приміська залізниця',
  funicular: 'фунікулер',
  none: 'немає в наших даних',
};

const MODE_LABEL: Record<string, string> = { BUS: 'автобус', TROLLEYBUS: 'тролейбус', TRAM: 'трамвай', SHARE_TAXI: 'маршрутка', SUBWAY: 'метро', HEAVY_RAIL: 'поїзд', RAIL: 'поїзд', LIGHT_RAIL: 'швидкісний трамвай', FUNICULAR: 'фунікулер' };
const modeLabel = (mode: string) => MODE_LABEL[mode] ?? mode.toLowerCase();
const num = (n: number) => n.toLocaleString('uk-UA');
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');
/** скільки ліній показати одразу */
const SHOWN = 30;

/**
 * Київ (Docs/dovede-learning-roadmap.md, крок 8в-1): якими лініями Google возить у збережених відповідях і що з них є в
 * наших даних. «Немає в наших даних» (типово) — приміські автобуси й решта: список для проєкту Київради.
 */
export const DovedeCityLines: React.FC<{ version?: number }> = ({ version = 0 }) => {
  const [data, setData] = useState<DovedeKyivLines | null>(null);
  const [error, setError] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [all, setAll] = useState(false);

  useEffect(() => {
    apiClient
      .getDovedeKyivLines()
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити лінії'));
  }, [version]);

  const rides = data ? Object.values(data.byKind).reduce((n, k) => n + k.rides, 0) : 0;
  const own = data ? rides - data.byKind.none.rides - data.byKind.rail.rides : 0;
  const rows = data ? data.lines.filter((l) => !onlyMissing || l.kind === 'none' || l.kind === 'rail') : [];
  const shown = all ? rows : rows.slice(0, SHOWN);

  return (
    <section aria-labelledby="dovede-city-lines-title">
      <div className="dovede-log-head">
        <h4 id="dovede-city-lines-title">Лінії: що є в наших даних</h4>
        <div className="dovede-log-chips" role="group" aria-label="Які лінії">
          <button type="button" className={`dovede-log-chip ${onlyMissing ? 'active' : ''}`} aria-pressed={onlyMissing} onClick={() => setOnlyMissing(true)}>
            Немає в наших даних
          </button>
          <button type="button" className={`dovede-log-chip ${onlyMissing ? '' : 'active'}`} aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)}>
            Усі
          </button>
        </div>
      </div>
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {!data && !error ? <p className="dovede-log-empty">Завантажую…</p> : null}
      {data ? (
        <>
          <StatTiles label="Поїздки у відповідях Google">
            <StatTile label="Свої дані" value={pct(own, rides)} sub={`${num(own)} з ${num(rides)} поїздок`} />
            <StatTile label={LINE_KIND_LABEL.kpt} value={num(data.byKind.kpt.rides)} sub={`${num(data.byKind.kpt.lines)} ліній`} />
            <StatTile label="Маршрутки з переліку" value={num(data.byKind.taxi.rides)} sub={`${num(data.byKind.taxi.lines)} ліній`} />
            <StatTile label="Немає в наших даних" value={num(data.byKind.none.rides + data.byKind.rail.rides)} sub={`${num(data.byKind.none.lines + data.byKind.rail.lines)} ліній`} tone={data.byKind.none.rides ? 'warn' : 'default'} />
          </StatTiles>
          {rows.length ? (
            <table className="dovede-log-table dovede-log-table--cards">
              <thead>
                <tr>
                  <th>Лінія</th>
                  <th>Чия</th>
                  <th>Поїздок</th>
                  <th>Пар</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={`${l.mode}|${l.line}`}>
                    <td data-label="Лінія">
                      {modeLabel(l.mode)} <b>{l.line}</b>
                      {l.name ? <span className="dovede-log-dim"> — {l.name}</span> : null}
                    </td>
                    <td data-label="Чия">{LINE_KIND_LABEL[l.kind]}</td>
                    <td data-label="Поїздок">{num(l.rides)}</td>
                    <td data-label="Пар">{num(l.roads)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dovede-log-empty">{onlyMissing ? 'Усі лінії з відповідей Google є в наших даних.' : 'Відповідей Google по Києву ще немає.'}</p>
          )}
          {rows.length > SHOWN ? (
            <button type="button" className="admin-kit-linkbtn" onClick={() => setAll((v) => !v)}>
              {all ? 'Показати менше' : `Показати всі ${num(rows.length)}`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
};
