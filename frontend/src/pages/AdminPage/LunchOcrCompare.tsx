import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import type { LunchOcrCompareJob, LunchOcrCompareResult } from '@/types';

/**
 * Порівняння моделей розпізнавання на реальних фото й PDF дня (меню, чеки оплати).
 * Слухач проганяє кожне фото через кілька моделей Claude і показує, де дешева розходиться з дорогою.
 * Нічого не змінює: ні меню, ні оплат.
 */

const MODEL_LABEL: Record<string, string> = {
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
};
const KIND_LABEL: Record<string, string> = { menu: 'меню', receipt: 'чек', other: 'інше' };
const DEFAULT_POLL_MS = 2000;
/** слухач перезапускається під інші задачі Telegram — довше чекати немає сенсу */
const MAX_WAIT_MS = 4 * 60 * 1000;

function label(model: string): string {
  return MODEL_LABEL[model] ?? model;
}

function cellText(r: LunchOcrCompareResult): string {
  if (r.error) return 'помилка';
  const kind = KIND_LABEL[r.kind ?? ''] ?? r.kind ?? '—';
  if (r.kind === 'menu') return `${kind}: ${r.items ?? 0} страв`;
  if (r.kind === 'receipt') return r.amountUah ? `${kind}: ${r.amountUah} грн` : `${kind}: суму не видно`;
  return kind;
}

function diffLines(r: LunchOcrCompareResult): string[] {
  const d = r.menuDiff;
  if (!d) return [];
  const out: string[] = [];
  if (d.missing.length) out.push(`немає: ${d.missing.join(', ')}`);
  if (d.extra.length) out.push(`зайві: ${d.extra.join(', ')}`);
  if (d.prices.length) out.push(`ціни: ${d.prices.map((p) => `${p.name} ${p.base} → ${p.other}`).join(', ')}`);
  return out;
}

type Props = {
  /** день, відкритий в адмінці (YYYY-MM-DD) */
  defaultDate?: string;
  /** тести передають маленький інтервал опитування */
  pollIntervalMs?: number;
};

export const LunchOcrCompare: React.FC<Props> = ({ defaultDate, pollIntervalMs = DEFAULT_POLL_MS }) => {
  const [date, setDate] = useState('');
  const [job, setJob] = useState<LunchOcrCompareJob | null>(null);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const busy = job !== null && (job.status === 'pending' || job.status === 'running');
  const dateValue = date || defaultDate || '';

  const poll = (id: number, startedAt: number) => {
    timerRef.current = setTimeout(async () => {
      try {
        const { job: next } = await apiClient.getLunchOcrCompare(id);
        setJob(next);
        if (next.status === 'pending' || next.status === 'running') {
          if (Date.now() - startedAt > MAX_WAIT_MS) {
            setError('Слухач не відповів за 4 хвилини — спробуйте ще раз трохи пізніше.');
            setJob(null);
          } else {
            poll(id, startedAt);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не вдалося прочитати порівняння');
        setJob(null);
      }
    }, pollIntervalMs);
  };

  const start = async () => {
    setError('');
    try {
      const { job: created } = await apiClient.createLunchOcrCompare(dateValue ? { date: dateValue } : {});
      setJob(created);
      poll(created.id, Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося запустити порівняння');
    }
  };

  const report = job?.status === 'done' ? job.result : null;

  return (
    <section className="lunch-block">
      <h3 className="lunch-card__title">Моделі розпізнавання: порівняти на фото дня</h3>
      <p className="lunch-card__hint">
        Фото меню, чеки й PDF з групи за вибраний день проходять через три моделі Claude. Видно, де дешева
        розійшлась із дорогою, скільки це коштувало й тривало. У меню й оплатах нічого не змінюється.
      </p>
      <div className="lunch-card__row">
        <label className="lunch-compare__date">
          <span className="lunch-muted">День</span>{' '}
          <input
            type="date"
            aria-label="День для порівняння моделей"
            value={dateValue}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button type="button" className="admin-kit-btn" onClick={() => void start()} disabled={busy}>
          {busy ? 'Моделі працюють…' : 'Порівняти моделі'}
        </button>
      </div>
      {error && <p className="lunch-debt">{error}</p>}
      {job?.status === 'failed' && <p className="lunch-debt">Не вдалося: {job.error}</p>}
      {busy && (
        <p className="lunch-muted" role="status" aria-live="polite">
          {job?.status === 'pending' ? 'У черзі до слухача…' : 'Слухач проганяє фото через моделі — зазвичай до хвилини.'}
        </p>
      )}
      {report && (
        <div role="status" aria-live="polite">
          {report.media.length === 0 ? (
            <p className="lunch-muted">За {report.date} у групі немає фото чи PDF.</p>
          ) : (
            <div className="lunch-table-wrap">
              <table className="lunch-table" aria-label={`Порівняння моделей за ${report.date}`}>
                <thead>
                  <tr>
                    <th>Час</th>
                    <th>Що</th>
                    {report.models.map((m) => (
                      <th key={m}>
                        {label(m)}
                        {m === report.baseline ? ' (еталон)' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.media.map((row) => (
                    <tr key={row.messageId}>
                      <td>{row.time}</td>
                      <td>{row.source === 'pdf' ? 'PDF' : 'фото'}</td>
                      {row.results.map((r) => (
                        <td key={r.model} className={r.error || r.agree === false ? 'lunch-debt' : ''}>
                          {cellText(r)}
                          {r.model !== report.baseline && !r.error && (r.agree ? ' ✓' : ' ≠')}
                          <span className="lunch-muted"> · {r.seconds} с</span>
                          {diffLines(r).map((line) => (
                            <div key={line} className="lunch-compare__diff">
                              {line}
                            </div>
                          ))}
                          {r.error && <div className="lunch-compare__diff">{r.error}</div>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="lunch-compare__total">
                    <td colSpan={2}>Разом</td>
                    {report.summary.map((s) => (
                      <td key={s.model}>
                        {s.model === report.baseline ? 'еталон' : `збіглось ${s.agree} з ${s.media}`}
                        <span className="lunch-muted">
                          {' '}
                          · ${s.costUsd.toFixed(4)} · {s.seconds} с
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {report.skipped > 0 && (
            <p className="lunch-muted">Не порівнювали {report.skipped} файл(ів): понад ліміт на один запуск або завеликі.</p>
          )}
        </div>
      )}
    </section>
  );
};
