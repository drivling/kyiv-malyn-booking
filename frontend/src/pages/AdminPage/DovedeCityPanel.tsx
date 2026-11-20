import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import type { DovedeCityDemandRow, DovedeCityStats, DovedeLearnCity } from '@/types';
import { learnCityName, useLearnCities } from './dovede/useLearnCities';
import { DovedeCityPlaces } from './DovedeCityPlaces';
import { StatTile, StatTiles } from './kit';
import { googleErrorLine, quotaTime } from './dovede/googleError';
import { dovedePath } from './dovede/sections';
import './dovede/learn/learn.css';

type CityTab = string;
/** `?misto=` з адреси: місто навчання з таким кодом, інакше перше (Київ) */
const cityFrom = (raw: string | null, cities: readonly DovedeLearnCity[]): CityTab => cities.find((c) => c.code === raw)?.code ?? cities[0].code;

const SOURCE: Record<string, string> = { google: 'з Google', own: 'свої', open: 'відкриті дані' };
/** скільки пар попиту показати одразу */
const DEMAND_SHOWN = 15;

const num = (n: number) => n.toLocaleString('uk-UA');
const count = (rows: Array<{ city: string; count: number }>, city: string) => rows.filter((r) => r.city === city).reduce((n, r) => n + r.count, 0);

/** «Що питають»: пари людей у місті, найчастіші першими; «Без відповіді» — усі такі, а не лише перші */
const CityDemand: React.FC<{ city: CityTab; version: number }> = ({ city, version }) => {
  const [only, setOnly] = useState(false);
  const [rows, setRows] = useState<DovedeCityDemandRow[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setAll(false);
    apiClient
      .getDovedeCityDemand(city, only)
      .then((r) => {
        setRows(r.demand);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити попит'));
  }, [city, only, version]);

  const shown = rows ? (all ? rows : rows.slice(0, DEMAND_SHOWN)) : [];
  return (
    <section aria-labelledby="dovede-city-demand-title">
      <div className="dovede-log-head">
        <h4 id="dovede-city-demand-title">Що питають</h4>
        <div className="dovede-log-chips" role="group" aria-label="Які пари">
          <button type="button" className={`dovede-log-chip ${only ? '' : 'active'}`} aria-pressed={!only} onClick={() => setOnly(false)}>
            Усі
          </button>
          <button type="button" className={`dovede-log-chip ${only ? 'active' : ''}`} aria-pressed={only} onClick={() => setOnly(true)}>
            Без відповіді
          </button>
        </div>
      </div>
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {!rows && !error ? <p className="dovede-log-empty">Завантажую…</p> : null}
      {rows && !rows.length ? <p className="dovede-log-empty">{only ? 'На всі питання про це місто є відповідь.' : 'Запитів про дорогу цим містом ще не було.'}</p> : null}
      {shown.length ? (
        <ul className="dovede-city-demand">
          {shown.map((d) => (
            <li key={`${d.fromKey}|${d.toKey}`}>
              {d.from} → {d.to}{' '}
              <span className="dovede-log-dim">
                — {d.asked} разів{d.answered ? '' : ', відповіді немає'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows && rows.length > DEMAND_SHOWN ? (
        <button type="button" className="admin-kit-linkbtn" onClick={() => setAll((v) => !v)}>
          {all ? 'Показати менше' : `Показати всі ${num(rows.length)}`}
        </button>
      ) : null}
      {only && rows?.length ? (
        <p className="dovede-log-dim">
          Таке місце Google не знайшов, туди не ходить транспорт або ліміт не дав спитати — людині показано кнопку Google Maps. Спитати ще раз можна кампанією
          «Питання людей без відповіді» в розділі <Link to={dovedePath('learning')}>«Навчання»</Link>.
        </p>
      ) : null}
    </section>
  );
};

/**
 * Розділ «Місто» (/admin/dovede/city, Docs/dovede-admin-roadmap.md, крок 10): транспорт Києва й Житомира, який
 * «Доведе» зібрала із запитів людей і навчання. Місто — у адресі (`?misto=Zhytomyr`, типово Київ): плитки, «Що
 * питають» (усі пари без відповіді — окремим фільтром), «Місця» (сторінками, з дорогами кожного й архівом одного
 * місця — `DovedeCityPlaces`). Те, що зачіпає всю базу (заархівувати все з Google, скинути лічильник попиту), — у
 * згорнутій «Небезпечній зоні». Нічого не видаляється. Строк свіжості й ліміт Google — у «Налаштуваннях», крок навчання
 * — у «Навчанні».
 */
export const DovedeCityPanel: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const cities = useLearnCities();
  const city = cityFrom(params.get('misto'), cities);
  const [data, setData] = useState<DovedeCityStats | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    apiClient
      .getDovedeCity()
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити'));
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => load(), [load]);

  const setCity = (next: CityTab) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'Kyiv') p.delete('misto');
        else p.set('misto', next);
        return p;
      },
      { replace: true },
    );

  const act = async (what: 'archive' | 'restore' | 'reset') => {
    if (
      what === 'reset' &&
      !window.confirm('Обнулити лічильник «Що питають»? Збережені дороги, лінії й зупинки лишаються. Список почне рахувати заново — з питань людей.')
    )
      return;
    if (what === 'archive' && !window.confirm('Заархівувати все, що прийшло з Google? Дані лишаться в базі, але у відповіді не підуть. Повернути можна кнопкою «Відновити з архіву».')) return;
    if (what === 'restore' && !window.confirm('Повернути з архіву все, що прийшло з Google?')) return;
    setBusy(true);
    setNote('');
    try {
      if (what === 'reset') {
        const r = await apiClient.dovedeCityResetDemand();
        setNote(r.reset ? `Лічильник скинуто: пар — ${r.reset}.` : 'Лічильник уже порожній.');
      } else {
        const r = await apiClient.dovedeCityArchive(what);
        setNote(`${what === 'archive' ? 'Заархівовано' : 'Відновлено'}: маршрутів — ${r.routes}, ліній — ${r.lines}, зупинок — ${r.stops}.`);
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося');
    } finally {
      setBusy(false);
    }
  };

  const byCity = data ? data.routes.filter((r) => r.city === city) : [];
  const unanswered = data?.unanswered?.filter((u) => u.city === city).length ?? 0;

  return (
    <div className="dovede-syn dovede-city">
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {!data && !error ? <p className="dovede-log-empty">Завантажую…</p> : null}
      {data ? (
        <>
          <p className="dovede-log-dim">
            {[
              data.enabled ? null : 'Пошук містом вимкнено (DOVEDE_CITY_ROUTES=off)',
              data.hasKey ? null : 'немає ключа GOOGLE_MAPS_API_KEY — відповідаємо лише з бази',
              data.store ? null : 'запис у базу вимкнено (DOVEDE_CITY_STORE=0)',
              `запитів до Google сьогодні: ${data.callsToday} з ${data.dailyCap}${data.today && data.callsToday ? ` (люди ${data.today.people}, навчання ${data.today.learn})` : ''}`,
              data.today?.refused ? `людям відмовили через ліміт: ${data.today.refused}` : null,
              data.blocked ? `Google не питаємо до ${quotaTime(data.blocked.until)} — ${data.blocked.reason === 'quota' ? 'вичерпано квоту' : 'відмовлено в доступі'}` : null,
              data.googleError ? googleErrorLine(data.googleError) : null,
              data.staleRoutes ? `застаріло доріг: ${data.staleRoutes} — ${data.refresh ? 'сервер оновлює їх сам, потроху щогодини' : 'фонове оновлення вимкнено в «Налаштування»'}` : null,
              data.archivedRoutes ? `в архіві маршрутів: ${data.archivedRoutes}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="dovede-log-dim">
            Відповідь свіжа {data.freshDays} днів · ліміт Google {data.dailyCap} на день — змінити в розділі <Link to={dovedePath('settings')}>«Налаштування»</Link>; навчити
            місто — у розділі <Link to={dovedePath('learning')}>«Навчання»</Link>.
          </p>

          <div className="dv-learn-seg dovede-city-switch" role="radiogroup" aria-label="Місто">
            {cities.map((c) => (
              <button key={c.code} type="button" role="radio" aria-checked={city === c.code} className={city === c.code ? 'is-on' : ''} onClick={() => setCity(c.code)}>
                {c.name}
              </button>
            ))}
          </div>

          <StatTiles label={`Що знаємо: ${learnCityName(cities, city)}`}>
            <StatTile label="Дорог у базі" value={num(byCity.reduce((n, r) => n + r.count, 0))} sub={byCity.length ? byCity.map((r) => `${num(r.count)} ${SOURCE[r.source] ?? r.source}`).join(', ') : undefined} />
            <StatTile label="Ліній" value={num(count(data.lines, city))} />
            <StatTile label="Зупинок" value={num(count(data.stops, city))} />
            <StatTile label="Пар без відповіді" value={unanswered >= 100 ? '100+' : num(unanswered)} tone={unanswered ? 'warn' : 'default'} />
          </StatTiles>

          <CityDemand city={city} version={version} />
          <DovedeCityPlaces city={city} onChange={load} />

          <details className="dovede-city-danger">
            <summary>Небезпечна зона</summary>
            <p className="dovede-log-dim">Дії над усією базою обох міст. Нічого не видаляється: архів ховає дані з Google від відповідей і навчання, «Відновити» повертає.</p>
            <div className="dovede-log-chips" role="group" aria-label="Дії над усією базою">
              <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('reset')}>
                Скинути лічильник попиту
              </button>
              <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('archive')}>
                Заархівувати все, що з Google
              </button>
              <button type="button" className="dovede-log-chip" disabled={busy || data.archivedRoutes === 0} onClick={() => void act('restore')}>
                Відновити з архіву
              </button>
            </div>
          </details>
          {note ? (
            <p className="dovede-log-note" role="status">
              {note}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
