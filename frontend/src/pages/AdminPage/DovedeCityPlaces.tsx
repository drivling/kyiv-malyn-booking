import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeCityPlace } from '@/types';

const CITY: Record<string, string> = { Kyiv: 'Київ', Zhytomyr: 'Житомир' };
/** скільки місць показуємо одразу; решту знаходять за назвою */
const SHOWN = 30;

const day = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long' });

const minutes = (p: DovedeCityPlace) => (p.minMinutes == null ? '' : p.minMinutes === p.maxMinutes ? `${p.minMinutes} хв` : `${p.minMinutes}–${p.maxMinutes} хв`);

/**
 * «Місця» в блоці «Місто: що вже знаємо»: архів одного місця. Google шукає місце за словами й інколи знаходить не те
 * (дорога підозріло коротка або веде не туди) — власник прибирає саме його: дороги цього місця йдуть в архів, сервер
 * про нього більше не відповідає й Google не питає, людина бачить кнопку карти. Нічого не видаляється; «Повернути»
 * скасовує.
 */
export const DovedeCityPlaces: React.FC<{ onChange?: () => void }> = ({ onChange }) => {
  const [places, setPlaces] = useState<DovedeCityPlace[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [shortFirst, setShortFirst] = useState(false);

  const load = useCallback(() => {
    apiClient
      .getDovedeCityPlaces()
      .then((r) => {
        setPlaces(r.places);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити місця'));
  }, []);

  useEffect(() => load(), [load]);

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (places ?? []).filter((p) => !q || p.label.toLowerCase().includes(q) || p.key.includes(q));
    // місця в архіві — завжди зверху: їх небагато, і саме їх шукають, щоб повернути
    return rows
      .map((p, i) => ({ p, i }))
      .sort((a, b) => Number(Boolean(b.p.archivedAt)) - Number(Boolean(a.p.archivedAt)) || (shortFirst ? (a.p.minMinutes ?? 1e9) - (b.p.minMinutes ?? 1e9) : 0) || a.i - b.i)
      .map((x) => x.p);
  }, [places, query, shortFirst]);

  const act = async (p: DovedeCityPlace, action: 'archive' | 'restore') => {
    const name = `«${p.label}» (${CITY[p.city] ?? p.city})`;
    if (
      action === 'archive' &&
      !window.confirm(`Прибрати місце ${name} в архів? Його дороги (${p.routes}) лишаться в базі, але у відповіді не підуть, і Google про це місце більше не питатимемо — людина побачить кнопку карти. Повернути можна кнопкою «Повернути».`)
    )
      return;
    setBusy(true);
    setNote('');
    try {
      const r = await apiClient.dovedeCityPlaceArchive(p.city, p.key, action);
      setNote(action === 'archive' ? `${name} — в архіві, доріг: ${r.routes}.` : `${name} — повернуто, доріг: ${r.routes}.`);
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h4>Місця</h4>
      <p className="dovede-log-dim">
        Google шукає місце за словами й інколи знаходить не те — тоді дорога підозріло коротка або веде не туди. Таке місце можна прибрати в архів: його
        дороги у відповіді не підуть, людина побачить кнопку карти. Нічого не видаляється.
      </p>
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {!places && !error ? <p className="dovede-log-empty">Завантажую місця…</p> : null}
      {places ? (
        <>
          <div className="dovede-city-places-bar">
            <label htmlFor="dovede-city-place-q">Знайти місце</label>
            <input id="dovede-city-place-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="назва або її частина" />
            <label className="dovede-city-places-check">
              <input type="checkbox" checked={shortFirst} onChange={(e) => setShortFirst(e.target.checked)} /> спершу найкоротші дороги
            </label>
          </div>
          {found.length ? (
            <ul className="dovede-city-places">
              {found.slice(0, SHOWN).map((p) => (
                <li key={`${p.city}|${p.key}`} className={p.archivedAt ? 'is-archived' : undefined}>
                  <span>
                    {CITY[p.city] ?? p.city} · <strong>{p.label}</strong>{' '}
                    <span className="dovede-log-dim">
                      {p.archivedAt
                        ? `— в архіві з ${day(p.archivedAt)}, доріг: ${p.archivedRoutes}`
                        : `— доріг: ${p.routes}${minutes(p) ? `, ${minutes(p)}` : ''}${p.archivedRoutes ? `, в архіві: ${p.archivedRoutes}` : ''}`}
                    </span>
                  </span>
                  <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act(p, p.archivedAt ? 'restore' : 'archive')} aria-label={`${p.archivedAt ? 'Повернути' : 'В архів'}: ${p.label}`}>
                    {p.archivedAt ? 'Повернути' : 'В архів'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dovede-log-empty">{places.length ? 'Такого місця серед збережених немає.' : 'Збережених доріг до місць ще немає.'}</p>
          )}
          {found.length > SHOWN ? (
            <p className="dovede-log-dim">
              Показано {SHOWN} з {found.length} — уточніть назву.
            </p>
          ) : null}
          {note ? <p className="dovede-log-note">{note}</p> : null}
        </>
      ) : null}
    </>
  );
};
