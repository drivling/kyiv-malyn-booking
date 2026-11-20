import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiClient } from '@/api/client';
import { ChipGroup, StatTile, StatTiles } from '../kit';
import { plural, whoHue } from '@/pages/StickerWallPage/stickerWall';
import type { StickerPeopleStats, StickerStatsDays } from '@/types';
import { ScanBars, type ScanBar, type ScanBarsUnit } from './ScanBars';
import { dailySeries, dayLabels, kyivToday } from './scanStats';

const PERIODS = [
  { value: 1 as const, label: 'Сьогодні' },
  { value: 7 as const, label: '7 днів' },
  { value: 30 as const, label: '30 днів' },
  { value: 90 as const, label: '90 днів' },
];
const periodText = (d: StickerStatsDays) => (d === 1 ? 'сьогодні' : `за ${d} днів`);
const pctOf = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : undefined);
const dayOf = (iso: string) => dayLabels(kyivToday(new Date(iso))).long;
const NEW_PEOPLE: ScanBarsUnit = {
  label: (n) => `${n} ${plural(n, ['новий', 'нових', 'нових'])}`,
  column: 'Нових пасажирів',
  none: 'нових пасажирів ще немає',
};

/**
 * «Наклейки зупинок» → «Люди» (Docs/stop-stickers.md, «Люди з наклейок»): пасажири з QR-наклейок — кожен анонімний
 * браузер має номер у місті (порядок появи). Плитки, нові по днях, звідки приходять новенькі, постійні пасажири з
 * історією зупинок. Дані — GET /admin/transport/sticker-people (backend sticker-people.ts). Основа для майбутніх
 * привітань і акцій.
 */
export function StickerPeoplePanel({ city, stopName }: { city?: string; stopName: (id: string) => string }) {
  const [days, setDays] = useState<StickerStatsDays>(30);
  const [stats, setStats] = useState<StickerPeopleStats | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    apiClient
      .getStickerPeople(days, city)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Не вдалося завантажити людей з наклейок'));
  }, [days, city]);
  useEffect(() => load(), [load]);

  const bars = useMemo<ScanBar[]>(() => {
    if (!stats || days === 1) return [];
    const series = dailySeries(
      stats.daily.map((d) => ({ ...d, stopId: '', side: 'a' as const })),
      days,
      kyivToday()
    );
    return series.map((d) => {
      const l = dayLabels(d.day);
      return { key: d.day, label: l.short, name: l.long, value: d.count };
    });
  }, [stats, days]);
  const topFirst = stats ? Math.max(1, ...stats.firstStops.map((f) => f.count)) : 1;

  return (
    <section className="sticker-stats sticker-people" aria-labelledby="sticker-people-title">
      <div className="sticker-stats-head">
        <h3 id="sticker-people-title">Люди з наклейок</h3>
        <ChipGroup label="Період" options={PERIODS} value={days} onChange={setDays} />
        <button type="button" className="admin-kit-btn sticker-stats-reload" onClick={load}>
          Оновити
        </button>
      </div>
      <p className="sticker-tab-muted sticker-people-intro">
        Кожен браузер, що відкрив табло з наклейки, — пасажир із номером у місті (за порядком появи). Без імен і
        телефонів: лише анонімний id браузера.
      </p>
      {error && <p className="sticker-tab-status--error">{error}</p>}
      {stats && (
        <>
          <StatTiles label="Пасажири з наклейок">
            <StatTile label="Пасажирів усього" value={stats.total} sub={stats.total > 0 ? `останній № ${stats.total}` : undefined} />
            <StatTile label={`Нових ${periodText(days)}`} value={stats.newInPeriod} />
            <StatTile label="Повертались" value={stats.returning} sub={pctOf(stats.returning, stats.total)} />
            <StatTile label="На ≥ 2 зупинках" value={stats.multiStop} sub={pctOf(stats.multiStop, stats.total)} />
            <StatTile label="Досмотріли тизер «Доведе»" value={stats.teaser} sub={pctOf(stats.teaser, stats.total)} />
          </StatTiles>
          {days !== 1 && <ScanBars title={`Нові пасажири по днях ${periodText(days)}`} bars={bars} labelEvery={days === 7 ? 1 : days === 30 ? 5 : 15} unit={NEW_PEOPLE} />}
          <div className="sticker-people-cols">
            <div>
              <h4>Звідки приходять новенькі {periodText(days)}</h4>
              {stats.firstStops.length === 0 ? (
                <p className="sticker-tab-muted">Нових пасажирів {periodText(days)} немає.</p>
              ) : (
                <ol className="sticker-people-first" aria-label="Перші зупинки нових пасажирів">
                  {stats.firstStops.map((f) => (
                    <li key={f.stopId} style={{ '--w': `${(f.count / topFirst) * 100}%` } as CSSProperties}>
                      <span>{stopName(f.stopId)}</span>
                      <b>{f.count}</b>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div>
              <h4>Постійні пасажири</h4>
              {stats.people.length === 0 ? (
                <p className="sticker-tab-muted">Ще нікого.</p>
              ) : (
                <ol className="sticker-people-list" aria-label="Постійні пасажири">
                  {stats.people.map((p) => (
                    <li key={p.number}>
                      <details>
                        <summary>
                          <span className="sticker-people-no" style={{ '--h': whoHue(p.who) } as CSSProperties}>
                            № {p.number}
                          </span>
                          <span className="sticker-people-who">#{p.who}</span>
                          <span className="sticker-people-first-stop">уперше — {stopName(p.firstStopId)}</span>
                          <span className="sticker-people-nums">
                            {p.stopIds.length} зуп. · {p.scans} скан. · {p.scanDays} діб · {p.returns} поверн.
                            {p.teaser ? ' · ✓ тизер' : ''}
                          </span>
                          <span className="sticker-people-dates">
                            {dayOf(p.firstAt)} → {dayOf(p.lastAt)}
                          </span>
                        </summary>
                        <p className="sticker-people-history">
                          {p.stopIds.map((id, i) => (
                            <span key={id}>
                              {i + 1}. {stopName(id)}
                            </span>
                          ))}
                        </p>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
