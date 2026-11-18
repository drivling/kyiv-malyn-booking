import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import type { StopLike } from '@/pages/DovedePage/nlu/stopPlaces';
import type { DovedeSynonymRow } from '@/types';
import { placeOptions, searchPlaceOptions, type PlaceOption } from './dovedePlaceOptions';

/**
 * Синоніми «Доведе» (Docs/dovede-roadmap.md): навчити сторінку слову з журналу — «епіцентр» → місце. Діє одразу,
 * без деплою: сторінка й Claude читають список із сервера. `seed` — слово з таблиці «Чого не впізнали»
 * (розділ «Словник» бере його з `?word=`; новий обʼєкт `seed` — нове заповнення форми).
 */
export const DovedeSynonymsPanel: React.FC<{ stops: StopLike[]; seed: { word: string; n: number } | null }> = ({ stops, seed }) => {
  const [rows, setRows] = useState<DovedeSynonymRow[] | null>(null);
  const [phrase, setPhrase] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<PlaceOption | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const placeInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const options = useMemo(() => placeOptions(stops), [stops]);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const found = useMemo(() => (chosen ? [] : searchPlaceOptions(options, query)), [options, query, chosen]);

  const load = useCallback(() => {
    apiClient
      .getDovedeSynonyms()
      .then((r) => setRows(r.synonyms))
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити синоніми'));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!seed) return;
    setPhrase(seed.word);
    setChosen(null);
    setQuery('');
    setError('');
    box.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    placeInput.current?.focus();
  }, [seed]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phrase.trim() || !chosen || saving) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.saveDovedeSynonym(phrase, chosen.id);
      setPhrase('');
      setQuery('');
      setChosen(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: DovedeSynonymRow) => {
    if (!window.confirm(`Забути синонім «${row.phrase}»?`)) return;
    try {
      await apiClient.deleteDovedeSynonym(row.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося видалити');
    }
  };

  return (
    <div className="dovede-syn" ref={box}>
      <h3>Синоніми</h3>
      <p className="dovede-log-note">
        Навчіть сторінку слову, яким люди називають місце. Діє одразу: наступне питання з цим словом піде до вибраного
        місця. Пишіть у називному відмінку — «епіцентр», «нова пошта на бамі»; відмінки сторінка впізнає сама.
      </p>
      <form className="dovede-syn-form" onSubmit={save}>
        <label className="dovede-syn-field">
          <span>Як кажуть люди</span>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="епіцентр" maxLength={60} />
        </label>
        <div className="dovede-syn-field dovede-syn-place">
          <label htmlFor="dovede-syn-place">Яке це місце</label>
          {chosen ? (
            <p className="dovede-syn-chosen">
              <strong>{chosen.label}</strong> <span>{chosen.hint}</span>
              <button type="button" onClick={() => setChosen(null)} aria-label="Вибрати інше місце">
                змінити
              </button>
            </p>
          ) : (
            <input id="dovede-syn-place" ref={placeInput} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="почніть писати назву: атб, вокзал, городищанська…" autoComplete="off" />
          )}
          {found.length ? (
            <ul className="dovede-syn-found" aria-label="Знайдені місця">
              {found.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => setChosen(o)}>
                    <strong>{o.label}</strong> <span>{o.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !chosen && query.trim() ? (
            <p className="dovede-log-empty">Такого місця у словнику немає.</p>
          ) : null}
        </div>
        <button type="submit" className="dovede-log-chip dovede-syn-save" disabled={!phrase.trim() || !chosen || saving}>
          {saving ? 'Зберігаю…' : 'Навчити'}
        </button>
      </form>
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {rows && rows.length ? (
        <div className="dovede-log-scroll">
          <table className="dovede-log-table dovede-log-table--cards">
            <thead>
              <tr>
                <th>Як кажуть</th>
                <th>Місце</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const place = byId.get(row.placeId);
                return (
                  <tr key={row.id}>
                    <td data-label="Як кажуть">
                      <strong>{row.phrase}</strong>
                    </td>
                    <td className="dovede-log-text" data-label="Місце">{place ? `${place.label} · ${place.hint}` : `${row.placeId} — такого місця вже немає`}</td>
                    <td>
                      <button type="button" className="dovede-syn-del" onClick={() => void remove(row)} aria-label={`Забути синонім «${row.phrase}»`}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : rows ? (
        <p className="dovede-log-empty">Синонімів ще немає. Слова, яких сторінка не впізнала, — у розділі «Питання людей»: кнопка «навчити» біля слова.</p>
      ) : null}
    </div>
  );
};
