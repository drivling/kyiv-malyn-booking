import { useMemo, useState } from 'react';
import type { StickerScanStats, StickerStatsDays } from '@/types';
import { ChipGroup, StatTile, StatTiles } from '../kit';
import { ScanBars, type ScanBar } from './ScanBars';
import { dailySeries, dayLabels, dayParts, hourBuckets, kyivToday, scopeAudience, scopeTotals, SILENT_DAYS } from './scanStats';

const PERIODS = [
  { value: 1 as const, label: 'Сьогодні' },
  { value: 7 as const, label: '7 днів' },
  { value: 30 as const, label: '30 днів' },
  { value: 90 as const, label: '90 днів' },
];
const CHARTS = [
  { value: 'days' as const, label: 'По днях' },
  { value: 'hours' as const, label: 'По годинах доби' },
];
const pad = (n: number) => String(n).padStart(2, '0');
const periodText = (d: StickerStatsDays) => (d === 1 ? 'сьогодні' : `за ${d} днів`);
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '');

/**
 * «Відкриття з QR» угорі вкладки наклейок: один ряд плиток (відкриття, люди, друк, мовчазні наклейки), графік по днях
 * за 7 / 30 / 90 днів або по годинах доби з частинами доби. «Сьогодні» (київська доба від півночі) — одразу по
 * годинах: стовпчик по днях там був би один. Обсяг — уся мережа або обрана зупинка (коли вона є).
 */
export function StickerStatsPanel({
  stats,
  error,
  days,
  onDays,
  stop,
  onReload,
  silent,
}: {
  stats: StickerScanStats | null;
  error: string;
  days: StickerStatsDays;
  onDays: (d: StickerStatsDays) => void;
  /** Обрана зупинка — можна звузити статистику до неї */
  stop: { id: string; name: string } | null;
  onReload: () => void;
  /** Мовчазні наклейки по всій мережі й посилання на них у списку зупинок */
  silent: { count: number; href: string };
}) {
  const [onlyStop, setOnlyStop] = useState(false);
  const [chart, setChart] = useState<'days' | 'hours'>('days');
  const today = days === 1;
  const showHours = chart === 'hours' || today;
  const scopeId = onlyStop && stop ? stop.id : '';
  const scope = scopeId ? { stopId: scopeId } : undefined;

  const totals = stats ? scopeTotals(stats, scope) : null;
  const people = stats ? scopeAudience(stats, scope) : null;
  const dayBars = useMemo<ScanBar[]>(() => {
    if (!stats) return [];
    return dailySeries(stats.daily, days, kyivToday(), scopeId ? { stopId: scopeId } : undefined).map((d) => {
      const l = dayLabels(d.day);
      return { key: d.day, label: l.short, name: l.long, value: d.count };
    });
  }, [stats, days, scopeId]);
  const hours = useMemo(() => (stats ? hourBuckets(stats.hourly, scopeId ? { stopId: scopeId } : undefined) : []), [stats, scopeId]);
  const hourBars: ScanBar[] = hours.map((v, h) => ({ key: String(h), label: pad(h), name: `${pad(h)}:00–${pad((h + 1) % 24)}:00`, value: v }));
  const parts = dayParts(hours);
  const partsTotal = parts.reduce((n, p) => n + p.count, 0);
  const scopeName = scope && stop ? `зупинка «${stop.name}»` : 'усі наклейки';

  return (
    <section className="sticker-stats" aria-labelledby="sticker-stats-title">
      <div className="sticker-stats-head">
        <h3 id="sticker-stats-title">Відкриття з QR</h3>
        <ChipGroup label="Період графіків" options={PERIODS} value={days} onChange={onDays} />
        {!today && <ChipGroup label="Графік" options={CHARTS} value={chart} onChange={setChart} />}
        {stop && (
          <label className="sticker-stats-check">
            <input type="checkbox" checked={onlyStop} onChange={(e) => setOnlyStop(e.target.checked)} />
            Лише «{stop.name}»
          </label>
        )}
        <button type="button" className="admin-kit-btn sticker-stats-reload" onClick={onReload}>
          Оновити
        </button>
      </div>
      {error && <p className="sticker-tab-status--error">{error}</p>}
      {totals && (
        <StatTiles label={`Підсумки: ${scopeName}`}>
          <StatTile label="Відкриттів усього" value={totals.total} sub={`сьогодні ${totals.today}`} />
          <StatTile label="За 7 днів" value={totals.last7d} />
          <StatTile label="За 30 днів" value={totals.last30d} />
          {people && (
            <StatTile
              label="Людей сканували"
              value={people.scanners}
              sub={`повертались ${people.returning}${people.scanners ? ` · ${pct(people.returning, people.scanners)}` : ''}`}
            />
          )}
          {people && (
            <StatTile
              label={`Повернень ${periodText(days)}`}
              value={people.returns}
              sub={people.byVia ? `табло ${people.byVia.reload} · вкладка ${people.byVia.tab ?? 0} · сайт ${people.byVia.direct}` : undefined}
            />
          )}
          <StatTile label="Наклейок надруковано" value={totals.printed} sub={`зі сканами ${totals.scanned}`} />
          {!scope && (
            <StatTile
              label={`Мовчать ≥ ${SILENT_DAYS} дн`}
              value={silent.count}
              sub={silent.count ? 'показати' : undefined}
              tone={silent.count ? 'warn' : 'default'}
              to={silent.count ? silent.href : undefined}
            />
          )}
        </StatTiles>
      )}
      {stats && !showHours && (
        <ScanBars
          title={`По днях ${periodText(days)} · ${scopeName}`}
          bars={dayBars}
          labelEvery={days === 7 ? 1 : days === 30 ? 5 : 15}
        />
      )}
      {stats && showHours && (
        <>
          <ScanBars title={`По годинах доби ${periodText(days)} · ${scopeName}`} bars={hourBars} labelEvery={3} />
          <StatTiles label="Частини доби">
            {parts.map((p) => (
              <StatTile key={p.key} label={`${p.label} ${p.range}`} value={p.count} sub={pct(p.count, partsTotal) || undefined} />
            ))}
          </StatTiles>
        </>
      )}
    </section>
  );
}
