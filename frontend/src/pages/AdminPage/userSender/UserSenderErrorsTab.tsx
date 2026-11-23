import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { TelegramUserSendError } from '@/types';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles } from '../kit';
import { CONTACT_TYPE_LABEL, errorKind, errorTiles, kindCounts, kindHint, kyivDateTime, lastLine } from './userSenderText';
import '../SchedulesTab.css';
import './UserSenderErrorsTab.css';

/**
 * Вкладка «Помилки user-sender» (`/admin/user-sender-errors`): контакти, до яких особистий акаунт не достукався
 * (send_message.py). Плитки (записів, за добу, за тиждень, найчастіша помилка), фільтр за видом помилки з поясненням,
 * одна помилка — один рядок; повний текст — у згортці. «Обнулити» видаляє всі записи (з підтвердженням).
 */
export const UserSenderErrorsTab: React.FC = () => {
  const [rows, setRows] = useState<TelegramUserSendError[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [kind, setKind] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await apiClient.getTelegramUserSendErrors());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження помилок user-sender');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tiles = useMemo(() => errorTiles(rows), [rows]);
  const kinds = useMemo(() => kindCounts(rows), [rows]);
  const shown = useMemo(() => (kind ? rows.filter((r) => errorKind(r) === kind) : rows), [rows, kind]);

  const clear = async () => {
    if (!window.confirm(`Видалити всі ${rows.length} записів з таблиці помилок user-sender?`)) return;
    setClearing(true);
    setError('');
    setSuccess('');
    try {
      const r = await apiClient.clearTelegramUserSendErrors();
      setSuccess(`Обнулено: видалено ${r.deleted} записів.`);
      setRows([]);
      setKind('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка обнулення');
    } finally {
      setClearing(false);
    }
  };

  const hint = kind ? kindHint(kind) : undefined;

  return (
    <div className="tab-content usend-tab">
      <AdminSectionHeader
        title="Помилки особистого акаунта"
        purpose={
          <>
            Кому особистий Telegram-акаунт не зміг написати (send_message.py). Вимикачі й денний ліміт — у вкладці{' '}
            <Link to="/admin/notifications">«Сповіщення»</Link>.
          </>
        }
        actions={
          <>
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void load()} disabled={loading}>
              {loading ? 'Завантаження…' : 'Оновити'}
            </button>
            <button
              type="button"
              className="admin-kit-btn admin-kit-btn--quiet usend-danger"
              onClick={() => void clear()}
              disabled={clearing || rows.length === 0}
              title="Видалити всі записи"
            >
              {clearing ? 'Обнулення…' : 'Обнулити'}
            </button>
          </>
        }
      />

      <StatTiles label="Помилки">
        <StatTile label="Записів" value={tiles.total} sub={`контактів ${tiles.contacts}`} />
        <StatTile label="За добу" value={tiles.day} tone={tiles.day ? 'warn' : 'default'} />
        <StatTile label="За 7 днів" value={tiles.week} />
        <StatTile label="Найчастіше" value={tiles.top && tiles.top.count > 1 ? tiles.top.count : '—'} sub={tiles.top && tiles.top.count > 1 ? tiles.top.kind : 'жодна не повторюється'} />
      </StatTiles>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {kinds.length > 1 && (
        <ChipGroup
          label="Вид помилки"
          value={kind}
          onChange={setKind}
          options={[{ value: '', label: `Усі ${rows.length}` }, ...kinds.map((k) => ({ value: k.kind, label: `${k.kind} ${k.count}` }))]}
        />
      )}
      {hint && <p className="usend-hint">{hint}</p>}

      {loading && !rows.length ? (
        <p className="usend-muted">Завантаження…</p>
      ) : shown.length === 0 ? (
        <EmptyState>Помилок немає — акаунт достукується до всіх.</EmptyState>
      ) : (
        <ul className="usend-rows" aria-label="Помилки">
          {shown.map((r) => {
            const k = errorKind(r);
            const h = kindHint(k);
            const full = (r.errorText ?? '').trim();
            return (
              <li key={r.id} className="usend-row" aria-label={`Помилка #${r.id}`}>
                <span className="usend-when">{kyivDateTime(r.createdAt)}</span>
                <span className="usend-contact">
                  <strong>{r.contact}</strong>
                  <span className="sched-tag">{CONTACT_TYPE_LABEL[r.contactType] ?? r.contactType}</span>
                </span>
                <span className="usend-what">
                  <span className="sched-flag usend-kind" title={h}>
                    {k}
                  </span>
                  {h && <span className="usend-muted">{h}</span>}
                  {full && full !== lastLine(full) ? (
                    <details className="usend-full">
                      <summary>повний текст</summary>
                      <pre>{full}</pre>
                    </details>
                  ) : full && full !== k ? (
                    <span className="usend-muted">{full}</span>
                  ) : null}
                </span>
                <span className="usend-muted usend-id">
                  #{r.id} · код {r.errorCode}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
