import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { formatPhoneDisplay } from '@/utils/constants';
import type { PersonDataArchiveDetail, PersonDataArchiveSummary } from '@/types';
import './PersonArchiveTab.css';

/** Підсумок по знімку одним рядком — щоб не розгортати JSON заради трьох чисел. */
function countsLabel(a: PersonDataArchiveSummary): string {
  const c = a.deletedCounts;
  if (!c) return '—';
  const parts = [
    c.bookings ? `бронювань ${c.bookings}` : null,
    c.viberListings ? `оголошень ${c.viberListings}` : null,
    c.viberRideEvents ? `ViberRide ${c.viberRideEvents}` : null,
    c.referralRewardsKeptPaid ? `виплачених збережено ${c.referralRewardsKeptPaid}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'порожньо';
}

/**
 * Вкладка «Архів»: JSON-знімки персональних даних, зроблені кнопкою «Архівувати всі дані».
 * Тільки перегляд — відновлення й видалення тут навмисно немає.
 */
export const PersonArchiveTab: React.FC = () => {
  const [archives, setArchives] = useState<PersonDataArchiveSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PersonDataArchiveDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getPersonDataArchives(query);
      setArchives(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити архів');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: number) => {
    setDetailLoadingId(id);
    setError('');
    try {
      setDetail(await apiClient.getPersonDataArchive(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити знімок');
    } finally {
      setDetailLoadingId(null);
    }
  };

  return (
    <div className="tab-content">
      <h3 className="person-archive-title">Архів персональних даних</h3>
      <p className="person-archive-hint">
        Знімки, зроблені кнопкою «Архівувати всі дані» у вкладці «Дані». Робочі записи цих людей
        видалені — тут лишається єдина копія на момент звернення. Відновлення немає.
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="controls">
        <input
          type="text"
          className="control-input"
          placeholder="Пошук за телефоном, імʼям або причиною..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(search);
          }}
        />
        <Button onClick={() => void load(search)}>Пошук</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setSearch('');
            void load('');
          }}
        >
          Оновити список
        </Button>
      </div>

      {loading ? (
        <div className="admin-loading" aria-live="polite">Завантаження...</div>
      ) : archives.length === 0 ? (
        <div className="admin-empty">
          <p className="admin-empty-text">Архів порожній</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Дата</th>
                <th>Телефон</th>
                <th>Імʼя на момент архівації</th>
                <th>Причина</th>
                <th>Що було в знімку</th>
                <th>Дії</th>
              </tr>
            </thead>
            <tbody>
              {archives.map((a) => (
                <tr key={a.id}>
                  <td>#{a.id}</td>
                  <td>{new Date(a.createdAt).toLocaleString('uk-UA')}</td>
                  <td>{formatPhoneDisplay(a.phoneNormalized)}</td>
                  <td>{a.fullName ?? '—'}</td>
                  <td className="person-archive-reason" title={a.reason}>{a.reason}</td>
                  <td>{countsLabel(a)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={() => void openDetail(a.id)}
                      disabled={detailLoadingId === a.id}
                    >
                      {detailLoadingId === a.id ? 'Завантаження…' : 'Показати JSON'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Архів #{detail.id} · {formatPhoneDisplay(detail.phoneNormalized)}</h2>
              <button className="close-btn" onClick={() => setDetail(null)}>&times;</button>
            </div>
            <p className="modal-hint">Причина: {detail.reason}</p>
            <textarea
              className="person-archive-payload"
              readOnly
              rows={24}
              value={JSON.stringify(detail.payload, null, 2)}
            />
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setDetail(null)}>Закрити</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
