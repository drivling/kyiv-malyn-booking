import React, { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeCampaign, DovedeCampaignDetail } from '@/types';
import { StatusPill } from '../../kit';
import { campaignState, isActive, isOpen, num, planText } from './campaignText';
import { hoursText } from './hours';

const ASK_STATUS: Record<string, string> = {
  ok: 'є дорога',
  no_route: 'дороги немає',
  archived: 'місце в архіві',
  failed: 'Google не відповів',
  queued: 'у черзі',
  asking: 'питаємо',
};
const SOURCE: Record<string, string> = { google: 'Google', stored: 'з бази', own: 'свої дані' };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Хід кампанії: останні відповіді, місця за кроками, без дороги (після завершення) */
const CampaignDetails: React.FC<{ id: number; version: string }> = ({ id, version }) => {
  const [d, setD] = useState<DovedeCampaignDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiClient
      .getDovedeCampaign(id)
      .then((r) => {
        setD(r);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити'));
  }, [id, version]);
  if (error) return <p className="dovede-log-error">{error}</p>;
  if (!d) return <p className="dovede-log-empty">Завантажую…</p>;
  return (
    <div className="dv-learn-details">
      <p className="dv-learn-hint">
        Місць за кроками: {d.byDepth.map((b) => `${b.depth === 0 ? 'зі списку' : `крок ${b.depth}`} — ${num(b.places)}`).join(', ') || '—'}.{' '}
        Питання: {Object.entries(d.asks).map(([s, n]) => `${ASK_STATUS[s] ?? s} ${num(n)}`).join(', ') || '—'}.
      </p>
      {d.recent.length ? (
        <div className="dovede-log-table-wrap">
          <table className="dovede-log-table dovede-log-table--cards">
            <caption className="dv-learn-caption">Останні відповіді</caption>
            <thead>
              <tr>
                <th>Місце</th>
                <th>Звідки / куди</th>
                <th>Коли</th>
                <th>Результат</th>
                <th>Нових місць</th>
                <th>Час</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((r, i) => (
                <tr key={i}>
                  <td data-label="Місце">
                    {r.place}
                    {r.depth ? <span className="dovede-log-dim"> · крок {r.depth}</span> : null}
                  </td>
                  <td data-label="Звідки / куди">{r.dir === 'from' ? `→ ${r.origin}` : `${r.origin} →`}</td>
                  <td data-label="Коли">{hoursText(r.slot)}</td>
                  <td data-label="Результат">
                    {ASK_STATUS[r.status] ?? r.status}
                    {r.status === 'ok' ? `, ${r.minutes} хв, ${SOURCE[r.source ?? ''] ?? r.source}` : ''}
                  </td>
                  <td data-label="Нових місць">{r.added || ''}</td>
                  <td data-label="Час">{when(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="dovede-log-empty">Ще нічого не питали.</p>
      )}
      {d.report?.noRoute.length ? (
        <p className="dv-learn-hint">
          Без дороги ({num(d.report.noRoute.length)}): {d.report.noRoute.join(', ')}. Якщо серед них є не місця — їх можна прибрати в розділі «Місто» → «Місця».
        </p>
      ) : null}
    </div>
  );
};

/**
 * Одна кампанія: стан, скільки запитів до Google витрачено з погодженого, що вже знайдено, і керування — пауза,
 * продовжити, скасувати, додати бюджету, сховати завершену. `onChange` — оновити список після дії.
 */
export const CampaignCard: React.FC<{ c: DovedeCampaign; onChange: (c: DovedeCampaign) => void }> = ({ c, onChange }) => {
  const [open, setOpen] = useState(false);
  const [extend, setExtend] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tone, label, why] = campaignState(c);
  const pct = c.budget ? Math.min(100, Math.round((c.googleCalls / c.budget) * 100)) : 0;
  const reopenable = isOpen(c) || (c.status === 'done' && c.stopReason === 'budget');

  const act = async (action: 'pause' | 'resume' | 'cancel' | 'extend' | 'archive', extra: { budget?: number } = {}) => {
    if (action === 'cancel' && !window.confirm(`Скасувати «${c.title}»? Знайдене лишиться в базі, продовжити кампанію вже не можна.`)) return;
    setBusy(true);
    setError('');
    try {
      const next = await apiClient.dovedeCampaignAction(c.id, action, extra);
      setExtend(null);
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося');
    } finally {
      setBusy(false);
    }
  };

  const more = Number(extend);
  const extendOk = extend !== null && Number.isInteger(more) && more > 0;

  return (
    <article className={`dv-learn-card dv-learn-campaign${isActive(c) ? ' is-active' : ''}`} aria-label={c.title}>
      <header className="dv-learn-campaign-head">
        <h4>{c.title}</h4>
        <StatusPill tone={tone}>{label}</StatusPill>
        {why ? <span className="dv-learn-hint">{why}</span> : null}
      </header>
      <div className="dv-learn-progress" role="progressbar" aria-label="Витрачено запитів до Google" aria-valuemin={0} aria-valuemax={c.budget} aria-valuenow={c.googleCalls}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="dv-learn-numbers">
        <strong>
          Google: {num(c.googleCalls)} з {num(c.budget)}
        </strong>
        {isOpen(c) ? (
          <span>
            сьогодні {num(c.spentToday)} з {num(c.dailyBudget)}
          </span>
        ) : null}
        <span>
          питань {num(c.asked)}, з дорогою {num(c.ok)}
          {c.fromDb ? ` (з бази ${num(c.fromDb)})` : ''}, без дороги {num(c.noRoute)}
          {c.failed ? `, не вдалося ${num(c.failed)}` : ''}
        </span>
        <span>місць {num(c.places)}</span>
        {c.left && c.status !== 'cancelled' ? <span>у черзі {num(c.left)}</span> : null}
      </p>
      <p className="dv-learn-hint">{planText(c.plan)}</p>
      {c.lastError && c.status === 'waiting' ? <p className="dv-learn-hint">Остання помилка: {c.lastError}</p> : null}
      {error ? (
        <p className="dovede-log-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dv-learn-actions">
        {isActive(c) ? (
          <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('pause')}>
            Пауза
          </button>
        ) : null}
        {c.status === 'paused' || c.status === 'waiting' ? (
          <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('resume')}>
            {c.status === 'waiting' ? 'Спробувати зараз' : 'Продовжити'}
          </button>
        ) : null}
        {reopenable ? (
          extend === null ? (
            <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => setExtend('100')}>
              Додати бюджету
            </button>
          ) : (
            <span className="dv-learn-extend">
              <label>
                + запитів{' '}
                <input type="number" inputMode="numeric" min={1} value={extend} aria-label="Скільки запитів додати" aria-invalid={!extendOk} onChange={(ev) => setExtend(ev.target.value)} />
              </label>
              <button type="button" className="admin-kit-btn" disabled={busy || !extendOk} onClick={() => void act('extend', { budget: c.budget + more })}>
                Додати
              </button>
              <button type="button" className="admin-kit-linkbtn" onClick={() => setExtend(null)}>
                скасувати
              </button>
            </span>
          )
        ) : null}
        {isOpen(c) ? (
          <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('cancel')}>
            Скасувати
          </button>
        ) : null}
        {c.status === 'done' || c.status === 'cancelled' ? (
          <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('archive')}>
            Сховати
          </button>
        ) : null}
        <button type="button" className="admin-kit-linkbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Згорнути' : 'Хід кампанії'}
        </button>
      </div>
      {open ? <CampaignDetails id={c.id} version={`${c.asked}|${c.status}`} /> : null}
    </article>
  );
};
