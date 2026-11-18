import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeCityStats } from '@/types';
import { DovedeCityPlaces } from './DovedeCityPlaces';

const CITY: Record<string, string> = { Kyiv: 'Київ', Zhytomyr: 'Житомир' };
const SOURCE: Record<string, string> = { google: 'з Google', own: 'свої', open: 'відкриті дані' };

const FRESH_MIN = 1;
const FRESH_MAX = 365;

/** «17 листопада о 23:45» за Києвом */
const quotaTime = (iso: string) => new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Що означає відмова Google — куди дивитись у Google Cloud */
const googleErrorHint = (status: number) =>
  status === 429
    ? 'вичерпано квоту в Google Cloud: вона менша за наш ліміт або її вибрали інші скрипти'
    : status === 401 || status === 403
      ? 'немає доступу: обмеження ключа, вимкнений Routes API або білінг'
      : 'збій на боці Google або запит не прийнято';

const count = (rows: Array<{ city: string; count: number }>, city: string) => rows.filter((r) => r.city === city).reduce((n, r) => n + r.count, 0);

/**
 * «Місто: що вже знаємо» — транспорт Києва й Житомира, який «Доведе» зібрала із запитів людей (Docs/dovede-roadmap.md,
 * «Місто»). Нічого не видаляється: «заархівувати» ховає дані з Google від відповідей і навчання, «відновити» повертає
 * (одне місце з неправильною відповіддю прибирає список «Місця» — `DovedeCityPlaces`),
 * «скинути лічильник попиту» обнуляє список «Що питають найчастіше» (після прогону `npm run dovede:crawl`), а строк
 * свіжості збереженої відповіді власник задає тут сам.
 */
export const DovedeCityPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DovedeCityStats | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** рядок у полі «днів»; null — людина його не чіпала, показуємо значення сервера */
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient
      .getDovedeCity()
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити'));
  }, []);

  useEffect(() => {
    if (open && !data) load();
  }, [open, data, load]);

  const act = async (what: 'learn' | 'archive' | 'restore' | 'reset') => {
    if (
      what === 'reset' &&
      !window.confirm('Обнулити лічильник «Що питають найчастіше»? Збережені дороги, лінії й зупинки лишаються. Список почне рахувати заново — з питань людей.')
    )
      return;
    if (what === 'archive' && !window.confirm('Заархівувати все, що прийшло з Google? Дані лишаться в базі, але у відповіді не підуть. Повернути можна кнопкою «Відновити з архіву».')) return;
    if (what === 'restore' && !window.confirm('Повернути з архіву все, що прийшло з Google?')) return;
    setBusy(true);
    setNote('');
    try {
      if (what === 'learn') {
        const r = await apiClient.dovedeCityLearn();
        setNote(r.asked ? `Спитано пар: ${r.asked}, отримано відповідей: ${r.learned}.` : 'Оновлювати нічого: усе свіже або вичерпано денний ліміт.');
      } else if (what === 'reset') {
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

  const freshValue = fresh ?? String(data?.freshDays ?? '');
  const freshNumber = Number(freshValue);
  const freshOk = /^\d+$/.test(freshValue) && freshNumber >= FRESH_MIN && freshNumber <= FRESH_MAX;

  const saveFresh = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!freshOk) return;
    setBusy(true);
    setNote('');
    try {
      const r = await apiClient.setDovedeCityFreshDays(freshNumber);
      setFresh(null);
      setNote(`Збережено: відповідь свіжа ${r.freshDays} днів.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  };

  const cities = data ? [...new Set([...data.routes.map((r) => r.city), ...data.lines.map((r) => r.city), ...data.stops.map((r) => r.city), 'Kyiv', 'Zhytomyr'])].sort() : [];
  const unanswered = data ? data.demand.filter((d) => !d.answered) : [];

  return (
    <div className="dovede-syn dovede-city">
      <div className="dovede-log-head">
        <h3>Місто: що вже знаємо</h3>
        <button type="button" className="dovede-log-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Згорнути' : 'Показати'}
        </button>
      </div>
      <p className="dovede-log-note">
        Коли людина питає дорогу до місця в Києві чи Житомирі, «Доведе» шукає її у своїй базі, а якщо там немає — питає Google і запамʼятовує. Чим більше
        запитів, тим рідше потрібен Google.
      </p>
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {open && !data && !error ? <p className="dovede-log-empty">Завантажую…</p> : null}
      {open && data ? (
        <>
          <p className="dovede-log-dim">
            {[
              data.enabled ? null : 'Пошук містом вимкнено (DOVEDE_CITY_ROUTES=off)',
              data.hasKey ? null : 'немає ключа GOOGLE_MAPS_API_KEY — відповідаємо лише з бази',
              data.store ? null : 'запис у базу вимкнено (DOVEDE_CITY_STORE=0)',
              `запитів до Google сьогодні: ${data.callsToday} з ${data.dailyCap}`,
              data.googleError ? `Google відмовив (HTTP ${data.googleError.status}) ${quotaTime(data.googleError.at)} — ${googleErrorHint(data.googleError.status)}${data.googleError.message ? `; Google: «${data.googleError.message}»` : ''}` : null,
              data.staleRoutes ? `застаріло доріг: ${data.staleRoutes} — ${data.refresh ? 'сервер оновлює їх сам, потроху щогодини' : 'оновлення вимкнено (DOVEDE_CITY_REFRESH=0)'}` : null,
              data.archivedRoutes ? `в архіві маршрутів: ${data.archivedRoutes}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <form className="dovede-city-fresh" onSubmit={(e) => void saveFresh(e)}>
            <label htmlFor="dovede-city-fresh">Збережена відповідь свіжа, днів</label>
            <input
              id="dovede-city-fresh"
              type="number"
              inputMode="numeric"
              min={FRESH_MIN}
              max={FRESH_MAX}
              step={1}
              value={freshValue}
              onChange={(e) => setFresh(e.target.value)}
              aria-describedby="dovede-city-fresh-hint"
            />
            <button type="submit" className="dovede-log-chip" disabled={busy || !freshOk || freshNumber === data.freshDays}>
              Зберегти
            </button>
            <span id="dovede-city-fresh-hint" className="dovede-log-dim">
              {freshOk
                ? `Старішу відповідь сервер не віддає, а питає Google знову${data.refresh ? '; у фоні сам оновлює ті, що ось-ось застаріють' : ''}.${data.freshDaysDefault ? ` Типово ${data.freshDaysDefault}.` : ''}`
                : `Ціле число від ${FRESH_MIN} до ${FRESH_MAX}.`}
            </span>
          </form>
          <div className="dovede-log-table-wrap">
            <table className="dovede-log-table">
              <thead>
                <tr>
                  <th>Місто</th>
                  <th>Дорог у базі</th>
                  <th>Ліній</th>
                  <th>Зупинок</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((c) => {
                  const bySource = data.routes.filter((r) => r.city === c);
                  return (
                    <tr key={c}>
                      <td>{CITY[c] ?? c}</td>
                      <td>{bySource.length ? bySource.map((r) => `${r.count} ${SOURCE[r.source] ?? r.source}`).join(', ') : '0'}</td>
                      <td>{count(data.lines, c)}</td>
                      <td>{count(data.stops, c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.demand.length ? (
            <>
              <h4>Що питають найчастіше</h4>
              <ul className="dovede-city-demand">
                {data.demand.slice(0, 12).map((d, i) => (
                  <li key={i}>
                    {CITY[d.city] ?? d.city}: {d.from} → {d.to} <span className="dovede-log-dim">— {d.asked} разів{d.answered ? '' : ', відповіді немає'}</span>
                  </li>
                ))}
              </ul>
              {unanswered.length ? <p className="dovede-log-dim">Без відповіді: {unanswered.length}. Таке місце Google не знайшов або туди не ходить транспорт — людині показано кнопку Google Maps.</p> : null}
            </>
          ) : (
            <p className="dovede-log-empty">Запитів про дорогу містом ще не було.</p>
          )}
          <div className="dovede-log-chips" role="group" aria-label="Дії">
            <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('learn')}>
              Оновити зараз
            </button>
            <button type="button" className="dovede-log-chip" disabled={busy || data.demand.length === 0} onClick={() => void act('reset')}>
              Скинути лічильник попиту
            </button>
            <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('archive')}>
              Заархівувати все, що з Google
            </button>
            <button type="button" className="dovede-log-chip" disabled={busy || data.archivedRoutes === 0} onClick={() => void act('restore')}>
              Відновити з архіву
            </button>
          </div>
          {note ? <p className="dovede-log-note">{note}</p> : null}
          <DovedeCityPlaces onChange={load} />
        </>
      ) : null}
    </div>
  );
};
