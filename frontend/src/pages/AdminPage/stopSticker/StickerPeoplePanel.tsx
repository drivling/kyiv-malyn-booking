import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { plural, whoHue } from '@/pages/StickerWallPage/stickerWall';
import type { StickerPeopleStats, StickerStatsDays } from '@/types';
import { ScanBars, type ScanBar, type ScanBarsUnit } from './ScanBars';
import { dailySeries, dayLabels, kyivToday } from './scanStats';

const PERIODS: StickerStatsDays[] = [1, 7, 30, 90];
const periodChip = (d: StickerStatsDays) => (d === 1 ? 'Сьогодні' : `${d} днів`);
const periodText = (d: StickerStatsDays) => (d === 1 ? 'сьогодні' : `за ${d} днів`);
const pctOf = (part: number, whole: number) => (whole > 0 ? ` · ${Math.round((part / whole) * 100)} %` : '');
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
        <div className="sticker-stats-chips" role="group" aria-label="Період">
          {PERIODS.map((p) => (
            <button key={p} type="button" className="sticker-chip" aria-pressed={days === p} onClick={() => setDays(p)}>
              {periodChip(p)}
            </button>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={load}>
          Оновити
        </Button>
      </div>
      <p className="sticker-tab-muted sticker-people-intro">
        Кожен браузер, що відкрив табло з наклейки, — пасажир із номером у місті (за порядком появи). Без імен і
        телефонів: лише анонімний id браузера, як у статистиці відкриттів. Телефон людини памʼятає те саме — для майбутніх
        привітань.
      </p>
      {error && <p className="sticker-tab-status--error">{error}</p>}
      {stats && (
        <>
          <dl className="sticker-stats-tiles" aria-label="Пасажири з наклейок">
            <div>
              <dt>Пасажирів усього</dt>
              <dd>
                {stats.total}
                {stats.total > 0 && <span className="sticker-tab-muted"> · останній № {stats.total}</span>}
              </dd>
            </div>
            <div>
              <dt>Нових {periodText(days)}</dt>
              <dd>{stats.newInPeriod}</dd>
            </div>
            <div>
              <dt>Повертались</dt>
              <dd>
                {stats.returning}
                <span className="sticker-tab-muted">{pctOf(stats.returning, stats.total)}</span>
              </dd>
            </div>
            <div>
              <dt>На ≥ 2 зупинках</dt>
              <dd>
                {stats.multiStop}
                <span className="sticker-tab-muted">{pctOf(stats.multiStop, stats.total)}</span>
              </dd>
            </div>
            <div>
              <dt>Досмотріли тизер «Доведе»</dt>
              <dd>
                {stats.teaser}
                <span className="sticker-tab-muted">{pctOf(stats.teaser, stats.total)}</span>
              </dd>
            </div>
          </dl>
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
