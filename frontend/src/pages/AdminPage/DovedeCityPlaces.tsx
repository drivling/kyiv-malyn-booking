import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeCityPlace, DovedeCityPlaceRoute } from '@/types';
import { learnCityName, useLearnCities } from './dovede/useLearnCities';

/** місць на сторінці */
export const PLACES_PAGE = 30;

const DAY: Record<string, string> = { weekday: 'будні', saturday: 'субота', sunday: 'неділя' };
const SOURCE: Record<string, string> = { google: 'Google', own: 'свої', open: 'відкриті' };

const day = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long' });

const minutes = (p: DovedeCityPlace) => (p.minMinutes == null ? '' : p.minMinutes === p.maxMinutes ? `${p.minMinutes} хв` : `${p.minMinutes}–${p.maxMinutes} хв`);

/** Розгортка місця: усі його збережені дороги (і в архіві) — звідки, коли, скільки хвилин, якими лініями */
const PlaceRoutes: React.FC<{ place: DovedeCityPlace }> = ({ place }) => {
  const [routes, setRoutes] = useState<DovedeCityPlaceRoute[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiClient
      .getDovedeCityPlaceRoutes(place.city, place.key)
      .then((r) => setRoutes(r.routes))
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити дороги'));
  }, [place.city, place.key, place.routes, place.archivedRoutes]);
  if (error) return <p className="dovede-log-error">{error}</p>;
  if (!routes) return <p className="dovede-log-empty">Завантажую дороги…</p>;
  if (!routes.length) return <p className="dovede-log-empty">Збережених доріг немає.</p>;
  return (
    <div className="dovede-log-table-wrap">
      <table className="dovede-log-table dovede-log-table--cards dovede-city-routes">
        <thead>
          <tr>
            <th>Дорога</th>
            <th>Коли</th>
            <th>Хв</th>
            <th>Лінії</th>
            <th>Звідки дані</th>
            <th>Віддано</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r, i) => (
            <tr key={i} className={r.archived ? 'is-archived' : undefined}>
              <td data-label="Дорога">
                {r.from} → {r.to}
                {r.archived ? <span className="dovede-log-dim"> · в архіві</span> : null}
              </td>
              <td data-label="Коли">
                {DAY[r.dayType] ?? r.dayType} {String(r.hour).padStart(2, '0')}:00
              </td>
              <td className="dovede-log-num" data-label="Хв">
                {r.minutes}
              </td>
              <td data-label="Лінії">{r.lines.length ? r.lines.join(', ') : 'пішки'}</td>
              <td data-label="Звідки дані">
                {SOURCE[r.source] ?? r.source}, {day(r.fetchedAt)}
              </td>
              <td className="dovede-log-num" data-label="Віддано">
                {r.hits}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * «Місця» розділу «Місто»: місця словами міста `city` зі збереженими дорогами, сторінками по `PLACES_PAGE`, з пошуком і
 * розгорткою доріг кожного місця. Архів одного місця: Google шукає місце за словами й інколи знаходить не те — власник
 * прибирає саме його: дороги йдуть в архів, сервер про місце більше не відповідає й Google не питає, людина бачить
 * кнопку карти. Нічого не видаляється; «Повернути» скасовує.
 */
export const DovedeCityPlaces: React.FC<{ city?: string; onChange?: () => void }> = ({ city, onChange }) => {
  const cities = useLearnCities();
  const [places, setPlaces] = useState<DovedeCityPlace[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [shortFirst, setShortFirst] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

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
  // нове місто, пошук чи порядок — з першої сторінки
  useEffect(() => {
    setPage(0);
    setOpen(null);
  }, [city, query, shortFirst]);

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (places ?? []).filter((p) => (!city || p.city === city) && (!q || p.label.toLowerCase().includes(q) || p.key.includes(q)));
    // місця в архіві — завжди зверху: їх небагато, і саме їх шукають, щоб повернути
    return rows
      .map((p, i) => ({ p, i }))
      .sort((a, b) => Number(Boolean(b.p.archivedAt)) - Number(Boolean(a.p.archivedAt)) || (shortFirst ? (a.p.minMinutes ?? 1e9) - (b.p.minMinutes ?? 1e9) : 0) || a.i - b.i)
      .map((x) => x.p);
  }, [places, query, shortFirst, city]);

  const pages = Math.max(1, Math.ceil(found.length / PLACES_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = found.slice(current * PLACES_PAGE, (current + 1) * PLACES_PAGE);

  const act = async (p: DovedeCityPlace, action: 'archive' | 'restore') => {
    const name = `«${p.label}» (${learnCityName(cities, p.city)})`;
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
    <section aria-labelledby="dovede-city-places-title">
      <h4 id="dovede-city-places-title">Місця</h4>
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
          {shown.length ? (
            <ul className="dovede-city-places">
              {shown.map((p) => {
                const id = `${p.city}|${p.key}`;
                const expanded = open === id;
                return (
                  <li key={id} className={p.archivedAt ? 'is-archived' : undefined}>
                    <div className="dovede-city-place-row">
                      <span>
                        {city ? null : `${learnCityName(cities, p.city)} · `}
                        <strong>{p.label}</strong>{' '}
                        <span className="dovede-log-dim">
                          {p.archivedAt
                            ? `— в архіві з ${day(p.archivedAt)}, доріг: ${p.archivedRoutes}`
                            : `— доріг: ${p.routes}${minutes(p) ? `, ${minutes(p)}` : ''}${p.archivedRoutes ? `, в архіві: ${p.archivedRoutes}` : ''}`}
                        </span>
                      </span>
                      <span className="dovede-city-place-actions">
                        <button type="button" className="admin-kit-linkbtn" aria-expanded={expanded} aria-label={`Дороги: ${p.label}`} onClick={() => setOpen(expanded ? null : id)}>
                          {expanded ? 'згорнути' : 'дороги'}
                        </button>
                        <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act(p, p.archivedAt ? 'restore' : 'archive')} aria-label={`${p.archivedAt ? 'Повернути' : 'В архів'}: ${p.label}`}>
                          {p.archivedAt ? 'Повернути' : 'В архів'}
                        </button>
                      </span>
                    </div>
                    {expanded ? <PlaceRoutes place={p} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="dovede-log-empty">{query.trim() ? 'Такого місця серед збережених немає.' : 'Збережених доріг до місць ще немає.'}</p>
          )}
          {pages > 1 ? (
            <nav className="dovede-city-pages" aria-label="Сторінки місць">
              <button type="button" className="dovede-log-chip" disabled={current === 0} onClick={() => setPage(current - 1)}>
                ← Назад
              </button>
              <span className="dovede-log-dim">
                {current * PLACES_PAGE + 1}–{current * PLACES_PAGE + shown.length} з {found.length}
              </span>
              <button type="button" className="dovede-log-chip" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                Далі →
              </button>
            </nav>
          ) : null}
          {note ? <p className="dovede-log-note">{note}</p> : null}
        </>
      ) : null}
    </section>
  );
};
