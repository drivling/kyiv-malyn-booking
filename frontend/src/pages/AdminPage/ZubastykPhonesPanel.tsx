import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import './kit/kit.css';

type Row = { phone: string; note: string };
type View = Awaited<ReturnType<typeof apiClient.getAdminZubastykPhones>>;

const MAX = 6;
const digitsOf = (raw: string) => {
  const d = raw.replace(/\D/g, '');
  if (/^0\d{9}$/.test(d)) return `38${d}`;
  return /^380\d{9}$/.test(d) ? d : null;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Телефони «Зубастика» (маршрутки Київ ↔ Малин) — один список для всього сайту: сторінка /zubastyk, модалка
 * бронювання, «Доведе», бот і SMS (`backend/src/zubastyk-phones.ts`). Нове діє одразу (інший контейнер сервера — за
 * кілька хвилин); статична /zubastyk для пошуковиків оновиться з наступною збіркою фронтенду.
 */
export const ZubastykPhonesPanel: React.FC = () => {
  const [view, setView] = useState<View | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fill = (v: View) => {
    setView(v);
    setRows(v.phones.map((p) => ({ phone: p.label, note: p.note ?? '' })));
  };

  const load = useCallback(() => {
    apiClient
      .getAdminZubastykPhones()
      .then((v) => {
        fill(v);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити телефони'));
  }, []);
  useEffect(() => load(), [load]);

  const save = async (reset: boolean) => {
    if (reset && !window.confirm('Повернути типові телефони з коду?')) return;
    setBusy(true);
    setNote('');
    setError('');
    try {
      const v = await apiClient.setZubastykPhones(reset ? null : rows.map((r) => ({ phone: r.phone, ...(r.note.trim() ? { note: r.note.trim() } : {}) })));
      fill(v);
      setNote(reset ? 'Знову типові телефони з коду.' : 'Збережено. Сайт, «Доведе», бот і SMS беруть нові номери; статична сторінка /zubastyk для Google — після наступного деплою фронтенду.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  };

  const valid = rows.length > 0 && rows.length <= MAX && rows.every((r) => digitsOf(r.phone)) && new Set(rows.map((r) => digitsOf(r.phone))).size === rows.length;
  const set = (i: number, patch: Partial<Row>) => setRows((list) => list.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <section className="admin-kit-settings zubastyk-phones" aria-labelledby="zubastyk-phones-title">
      <h3 id="zubastyk-phones-title">Телефони «Зубастика» (Київ ↔ Малин)</h3>
      <div className="admin-kit-setting">
        <div className="admin-kit-setting-text">
          <p>Один список для всього сайту: сторінка /zubastyk, бронювання, «Доведе», бот і SMS. Перший номер — головний (кнопки й SMS).</p>
          {view ? (
            <p className="admin-kit-setting-source">{view.changed ? `змінено в адмінці${view.updatedAt ? ` ${when(view.updatedAt)}` : ''}` : 'типові з коду'}</p>
          ) : null}
          {error ? (
            <p className="admin-kit-setting-source is-error" role="alert">
              {error}
            </p>
          ) : null}
          {note ? (
            <p className="admin-kit-setting-source" role="status">
              {note}
            </p>
          ) : null}
        </div>
        <div>
          {rows.map((r, i) => (
            <div key={i} className="admin-kit-setting-form zubastyk-phones-row">
              <input aria-label={`Номер ${i + 1}`} value={r.phone} onChange={(e) => set(i, { phone: e.target.value })} aria-invalid={!digitsOf(r.phone)} placeholder="093 192 00 08" />
              <input aria-label={`Примітка ${i + 1}`} value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="примітка, напр. резервний" maxLength={30} />
              <button type="button" className="admin-kit-linkbtn" aria-label={`Прибрати номер ${i + 1}`} disabled={rows.length <= 1} onClick={() => setRows((list) => list.filter((_, k) => k !== i))}>
                прибрати
              </button>
            </div>
          ))}
          <div className="admin-kit-setting-form">
            <button type="button" className="admin-kit-linkbtn" disabled={rows.length >= MAX} onClick={() => setRows((list) => [...list, { phone: '', note: '' }])}>
              + додати номер
            </button>
          </div>
          <div className="admin-kit-setting-form">
            <button type="button" className="admin-kit-btn" disabled={busy || !valid} onClick={() => void save(false)}>
              Зберегти
            </button>
            {view?.changed ? (
              <button type="button" className="admin-kit-linkbtn" disabled={busy} onClick={() => void save(true)}>
                Скинути до типових з коду
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};
