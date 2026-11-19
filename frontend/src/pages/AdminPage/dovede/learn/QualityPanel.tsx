import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '@/api/client';
import type { DovedeQualityItem, DovedeQualityReport } from '@/types';
import { EmptyState } from '../../kit';
import { hoursText } from './hours';
import { humanLink, num } from './campaignText';

type CityFilter = '' | 'Kyiv' | 'Zhytomyr';
const FILTERS: Array<{ id: CityFilter; label: string }> = [
  { id: '', label: 'Обидва міста' },
  { id: 'Kyiv', label: 'Київ' },
  { id: 'Zhytomyr', label: 'Житомир' },
];
const CITY: Record<string, string> = { Kyiv: 'Київ', Zhytomyr: 'Житомир' };
/** скільки місць показати одразу */
const SHOW = 30;


/**
 * «Якість» (Docs/dovede-admin-roadmap.md, крок 8): місця, дороги до яких схожі на помилку Google — одразу поруч із
 * точкою, однаково близько від далеких точок, туди й назад дуже різні, лише пішки. Біля кожного — «Відкрити як
 * людина», «В архів» (сервер про місце більше не відповідає й Google не питає) і «Нормально» (більше не показувати).
 */
export const QualityPanel: React.FC = () => {
  const [city, setCity] = useState<CityFilter>('');
  const [data, setData] = useState<DovedeQualityReport | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    setData(null);
    apiClient
      .getDovedeCityQuality(city || undefined)
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося зібрати звіт'));
  }, [city]);

  useEffect(load, [load]);

  // з «Огляду» й повідомлення в адмін-чат сюди ведуть з `#quality`
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const loaded = Boolean(data);
  useEffect(() => {
    if (hash === '#quality' && loaded) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [hash, loaded]);

  const drop = (item: DovedeQualityItem) => setData((d) => (d ? { ...d, items: d.items.filter((x) => !(x.city === item.city && x.key === item.key)) } : d));

  const act = async (item: DovedeQualityItem, what: 'ok' | 'archive') => {
    const where = `«${item.label}» (${CITY[item.city] ?? item.city})`;
    if (what === 'archive' && !window.confirm(`Прибрати ${where} в архів? Сервер більше не відповідатиме про це місце й не питатиме Google — людина побачить кнопку карти. Повернути можна в розділі «Місто» → «Місця».`)) return;
    setBusy(`${item.city}|${item.key}`);
    setNote('');
    try {
      if (what === 'ok') {
        await apiClient.dovedeCityPlaceOk(item.city, item.key, true);
        setNote(`${where} — нормально, більше не показуємо.`);
      } else {
        const r = await apiClient.dovedeCityPlaceArchive(item.city, item.key, 'archive');
        setNote(`${where} — в архіві, доріг: ${r.routes}.`);
      }
      drop(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося');
    } finally {
      setBusy('');
    }
  };

  const items = data?.items ?? [];
  const shown = all ? items : items.slice(0, SHOW);

  return (
    <section ref={ref} id="quality" className="dv-learn-card dv-learn-quality" aria-labelledby="dv-learn-quality-title">
      <div className="dv-learn-quality-head">
        <h3 id="dv-learn-quality-title">Якість: підозрілі дороги</h3>
        <div className="dv-learn-seg" role="radiogroup" aria-label="Місто звіту">
          {FILTERS.map((f) => (
            <button key={f.id || 'all'} type="button" role="radio" aria-checked={city === f.id} className={city === f.id ? 'is-on' : ''} onClick={() => setCity(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="dv-learn-hint">
        Google шукає місце за словами й інколи знаходить не те. Тут — дороги, схожі на таку помилку. Відкрийте як людина: якщо відповідь дивна — «В архів», якщо все гаразд —
        «Нормально».
      </p>
      {error ? (
        <p className="dovede-log-error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="dovede-log-note" role="status">
          {note}
        </p>
      ) : null}
      {!data && !error ? <p className="dovede-log-empty">Перевіряю…</p> : null}
      {data ? (
        <p className="dv-learn-hint">
          Перевірено місць: {num(data.places)} · підозрілих: {num(items.length)}
          {data.okPlaces ? ` · визнано нормальними раніше: ${num(data.okPlaces)}` : ''}
        </p>
      ) : null}
      {data && !items.length ? <EmptyState>Підозрілих доріг немає.</EmptyState> : null}
      {shown.length ? (
        <ul className="dv-learn-quality-list">
          {shown.map((item) => {
            const id = `${item.city}|${item.key}`;
            const first = [...item.routes].sort((a, b) => a.minutes - b.minutes)[0];
            return (
              <li key={id}>
                <div className="dv-learn-quality-title">
                  <strong>{item.label}</strong> <span className="dovede-log-dim">{CITY[item.city] ?? item.city}</span>
                </div>
                <ul className="dv-learn-quality-reasons">
                  {item.reasons.map((r) => (
                    <li key={r.code}>{r.text}</li>
                  ))}
                </ul>
                <p className="dv-learn-hint">
                  Дороги:{' '}
                  {item.routes
                    .slice(0, 6)
                    .map((r) => `${r.dir === 'from' ? `→ ${r.originLabel}` : `${r.originLabel} →`} ${r.minutes} хв (${hoursText(`${r.dayType}@${String(r.hour).padStart(2, '0')}`)})`)
                    .join('; ')}
                  {item.routes.length > 6 ? `; ще ${item.routes.length - 6}` : ''}
                </p>
                <div className="dv-learn-actions">
                  {first ? (
                    <a className="dovede-log-chip" href={humanLink(item, first)} target="_blank" rel="noreferrer">
                      Відкрити як людина
                    </a>
                  ) : null}
                  <button type="button" className="dovede-log-chip" disabled={busy === id} aria-label={`В архів: ${item.label}`} onClick={() => void act(item, 'archive')}>
                    В архів
                  </button>
                  <button type="button" className="dovede-log-chip" disabled={busy === id} aria-label={`Нормально: ${item.label}`} onClick={() => void act(item, 'ok')}>
                    Нормально
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {items.length > SHOW ? (
        <button type="button" className="admin-kit-linkbtn" onClick={() => setAll((v) => !v)}>
          {all ? 'Показати менше' : `Показати всі ${num(items.length)}`}
        </button>
      ) : null}
    </section>
  );
};
