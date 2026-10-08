import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import type { StickerScanStats, StickerStatsDays } from '@/types';
import { ScanBars, type ScanBar } from './ScanBars';
import { WallLinkDialog } from './WallLinkDialog';
import { dailySeries, dayLabels, dayParts, hourBuckets, kyivToday, scopeTotals } from './scanStats';

const PERIODS: StickerStatsDays[] = [1, 7, 30, 90];
const pad = (n: number) => String(n).padStart(2, '0');
const periodChip = (d: StickerStatsDays) => (d === 1 ? 'Сьогодні' : `${d} днів`);
const periodText = (d: StickerStatsDays) => (d === 1 ? 'сьогодні' : `за ${d} днів`);

/**
 * «Статистика відкриттів з QR» угорі вкладки наклейок: плитки підсумків, графік по днях за
 * 7 / 30 / 90 днів, галочкою — по годинах доби з частинами доби. «Сьогодні» (київська доба від
 * півночі) — одразу по годинах: стовпчик по днях там був би один. Обсяг — уся мережа або обрана
 * зупинка (коли вона є).
 */
export function StickerStatsPanel({
  stats,
  error,
  days,
  onDays,
  stop,
  onReload,
}: {
  stats: StickerScanStats | null;
  error: string;
  days: StickerStatsDays;
  onDays: (d: StickerStatsDays) => void;
  /** Обрана зупинка — можна звузити статистику до неї */
  stop: { id: string; name: string } | null;
  onReload: () => void;
}) {
  const [onlyStop, setOnlyStop] = useState(false);
  const [byHours, setByHours] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const today = days === 1;
  const showHours = byHours || today;
  const scopeId = onlyStop && stop ? stop.id : '';
  const scope = scopeId ? { stopId: scopeId } : undefined;

  const totals = stats ? scopeTotals(stats, scope) : null;
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
        <div className="sticker-stats-chips" role="group" aria-label="Період графіків">
          {PERIODS.map((p) => (
            <button key={p} type="button" className="sticker-chip" aria-pressed={days === p} onClick={() => onDays(p)}>
              {periodChip(p)}
            </button>
          ))}
        </div>
        {stop && (
          <label className="sticker-stats-check">
            <input type="checkbox" checked={onlyStop} onChange={(e) => setOnlyStop(e.target.checked)} />
            Лише «{stop.name}»
          </label>
        )}
        <Button type="button" variant="secondary" onClick={onReload}>
          Оновити
        </Button>
        <Button type="button" variant="secondary" onClick={() => setWallOpen(true)}>
          📺 Віджет на стіну
        </Button>
      </div>
      {wallOpen && <WallLinkDialog onClose={() => setWallOpen(false)} />}
      {error && <p className="sticker-tab-status--error">{error}</p>}
      {totals && (
        <dl className="sticker-stats-tiles" aria-label={`Підсумки: ${scopeName}`}>
          <div>
            <dt>Усього</dt>
            <dd>{totals.total}</dd>
          </div>
          <div>
            <dt>Сьогодні</dt>
            <dd>{totals.today}</dd>
          </div>
          <div>
            <dt>За 7 днів</dt>
            <dd>{totals.last7d}</dd>
          </div>
          <div>
            <dt>За 30 днів</dt>
            <dd>{totals.last30d}</dd>
          </div>
          <div>
            <dt>Наклейок надруковано</dt>
            <dd>
              {totals.printed}
              <span className="sticker-tab-muted"> · зі сканами {totals.scanned}</span>
            </dd>
          </div>
        </dl>
      )}
      {stats && !today && (
        <ScanBars
          title={`По днях ${periodText(days)} · ${scopeName}`}
          bars={dayBars}
          labelEvery={days === 7 ? 1 : days === 30 ? 5 : 15}
        />
      )}
      {stats && !today && (
        <label className="sticker-stats-check">
          <input type="checkbox" checked={byHours} onChange={(e) => setByHours(e.target.checked)} />
          По годинах доби
        </label>
      )}
      {stats && showHours && (
        <>
          <dl className="sticker-stats-tiles sticker-stats-tiles--parts" aria-label="Частини доби">
            {parts.map((p) => (
              <div key={p.key}>
                <dt>
                  {p.label} <span className="sticker-tab-muted">{p.range}</span>
                </dt>
                <dd>
                  {p.count}
                  {partsTotal > 0 && <span className="sticker-tab-muted"> · {Math.round((p.count / partsTotal) * 100)} %</span>}
                </dd>
              </div>
            ))}
          </dl>
          <ScanBars title={`По годинах доби ${periodText(days)} · ${scopeName}`} bars={hourBars} labelEvery={3} />
        </>
      )}
    </section>
  );
}
