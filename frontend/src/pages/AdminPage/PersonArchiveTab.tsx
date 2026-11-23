import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { formatPhoneDisplay } from '@/utils/constants';
import type { PersonDataArchiveDetail, PersonDataArchiveSummary } from '@/types';
import { AdminSectionHeader, EmptyState, StatTile, StatTiles } from './kit';
import { archiveTiles, countTags, kyivDateTime, payloadSections } from './archive/archiveText';
import './SchedulesTab.css';
import './PersonArchiveTab.css';

/** Знімок файлом — щоб віддати людині її дані або зберегти поза базою */
function downloadJson(detail: PersonDataArchiveDetail) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(detail.payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `archive-${detail.id}-${detail.phoneNormalized}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Вкладка «Архів» (`/admin/archive`): JSON-знімки персональних даних, зроблені кнопкою «Архівувати» у вкладці «Дані».
 * Плитки (знімків, за 30 днів, записів прибрано, виплачених збережено), пошук, один знімок — один рядок з усіма
 * лічильниками; у вікні — знімок по розділах і файлом. Тільки перегляд — відновлення й видалення тут навмисно немає.
 */
export const PersonArchiveTab: React.FC = () => {
  const [archives, setArchives] = useState<PersonDataArchiveSummary[]>([]);
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PersonDataArchiveDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError('');
    try {
      setArchives(await apiClient.getPersonDataArchives(query || undefined));
      setSearched(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити архів');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const tiles = useMemo(() => archiveTiles(archives), [archives]);
  const sections = useMemo(() => (detail ? payloadSections(detail.payload) : []), [detail]);

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
    <div className="tab-content archive-tab">
      <AdminSectionHeader
        title="Архів персональних даних"
        purpose="Знімки, зроблені кнопкою «Архівувати» у вкладці «Дані». Робочі записи цих людей видалені — тут єдина копія на момент звернення. Відновлення немає."
        actions={
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void load(searched)} disabled={loading}>
            Оновити
          </button>
        }
      />

      <StatTiles label="Архів">
        <StatTile label={searched ? `Знайдено за «${searched}»` : 'Знімків'} value={tiles.total} sub={tiles.people !== tiles.total ? `номерів ${tiles.people}` : undefined} />
        <StatTile label="За 30 днів" value={tiles.month} />
        <StatTile label="Записів прибрано" value={tiles.removed} sub="з робочих таблиць" />
        <StatTile label="Виплачених збережено" value={tiles.keptPaid} sub="знеособлені, для звіту виплат" />
      </StatTiles>

      {error && <Alert variant="error">{error}</Alert>}

      <form
        className="archive-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void load(search.trim());
        }}
      >
        <input
          type="search"
          className="archive-input"
          placeholder="Телефон, імʼя або причина — Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Пошук в архіві"
        />
        <button type="submit" className="admin-kit-btn" disabled={loading}>
          Шукати
        </button>
        {searched && (
          <button
            type="button"
            className="admin-kit-linkbtn"
            onClick={() => {
              setSearch('');
              void load('');
            }}
          >
            Увесь архів
          </button>
        )}
      </form>

      {loading && !archives.length ? (
        <p className="archive-muted">Завантаження…</p>
      ) : archives.length === 0 ? (
        <EmptyState>{searched ? 'За цим пошуком знімків немає.' : 'Архів порожній.'}</EmptyState>
      ) : (
        <ul className="archive-rows" aria-label="Знімки">
          {archives.map((a) => {
            const tags = countTags(a.deletedCounts);
            return (
              <li key={a.id} className="archive-row" aria-label={`Архів #${a.id}`}>
                <span className="archive-when">
                  <span className="archive-muted">#{a.id}</span> {kyivDateTime(a.createdAt)}
                </span>
                <span className="archive-who">
                  <strong>{a.fullName || <span className="archive-muted">без імені</span>}</strong>
                  <span className="archive-phone">{formatPhoneDisplay(a.phoneNormalized)}</span>
                  {a.personId ? <span className="archive-muted">персона #{a.personId}</span> : null}
                </span>
                <span className="archive-what">
                  <span className="archive-reason">{a.reason}</span>
                  <span className="sched-tags">
                    {tags.length ? tags.map((t) => <span key={t} className="sched-tag">{t}</span>) : <span className="sched-tag">порожньо</span>}
                  </span>
                </span>
                <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void openDetail(a.id)} disabled={detailLoadingId === a.id}>
                  {detailLoadingId === a.id ? 'Завантаження…' : 'Знімок'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {detail && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Архів #${detail.id}`} onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal-content archive-modal">
            <div className="modal-header">
              <h2>
                Архів #{detail.id} · {formatPhoneDisplay(detail.phoneNormalized)}
              </h2>
              <button type="button" className="close-btn" aria-label="Закрити" onClick={() => setDetail(null)}>
                &times;
              </button>
            </div>
            <p className="modal-hint">
              {kyivDateTime(detail.createdAt)} · {detail.fullName || 'без імені'} · причина: {detail.reason}
            </p>
            <div className="archive-sections" aria-label="Розділи знімка">
              {sections.map((s) => (
                <details key={s.key} className={`archive-section${s.count === 0 ? ' is-empty' : ''}`}>
                  <summary>
                    {s.label}
                    {s.count != null ? <span className="archive-muted"> · {s.count}</span> : null}
                  </summary>
                  <pre>{JSON.stringify(s.value, null, 2)}</pre>
                </details>
              ))}
            </div>
            <div className="form-actions">
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => downloadJson(detail)}>
                Завантажити JSON
              </button>
              <button type="button" className="admin-kit-btn" onClick={() => setDetail(null)}>
                Закрити
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
