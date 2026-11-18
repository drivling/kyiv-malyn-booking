import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeCityStats } from '@/types';
import { DovedeCityPlaces } from './DovedeCityPlaces';
import { googleErrorLine, quotaTime } from './dovede/googleError';

const CITY: Record<string, string> = { Kyiv: 'Київ', Zhytomyr: 'Житомир' };
const SOURCE: Record<string, string> = { google: 'з Google', own: 'свої', open: 'відкриті дані' };

const FRESH_MIN = 1;
const FRESH_MAX = 365;
/** межі денного ліміту Google — як на сервері (квота проєкту в Google Cloud — 5000 на день) */
const CAP_MIN = 0;
const CAP_MAX = 5000;

const count = (rows: Array<{ city: string; count: number }>, city: string) => rows.filter((r) => r.city === city).reduce((n, r) => n + r.count, 0);

/**
 * «Місто: що вже знаємо» — транспорт Києва й Житомира, який «Доведе» зібрала із запитів людей (Docs/dovede-roadmap.md,
 * «Місто»). Нічого не видаляється: «заархівувати» ховає дані з Google від відповідей і навчання, «відновити» повертає
 * (одне місце з неправильною відповіддю прибирає список «Місця» — `DovedeCityPlaces`),
 * «скинути лічильник попиту» обнуляє список «Що питають найчастіше» (після прогону `npm run dovede:crawl`), а строк
 * свіжості збереженої відповіді й денний ліміт запитів до Google власник задає тут сам.
 * `defaultOpen` — розділ «Місто» (`/admin/dovede/city`) відкриває панель одразу.
 */
export const DovedeCityPanel: React.FC<{ defaultOpen?: boolean }> = ({ defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<DovedeCityStats | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** рядок у полі «днів»; null — людина його не чіпала, показуємо значення сервера */
  const [fresh, setFresh] = useState<string | null>(null);
  /** рядок у полі ліміту Google; null — не чіпали, показуємо значення сервера */
  const [cap, setCap] = useState<string | null>(null);

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

  const capValue = cap ?? String(data?.dailyCap ?? '');
  const capNumber = Number(capValue);
  const capOk = /^\d+$/.test(capValue) && capNumber >= CAP_MIN && capNumber <= CAP_MAX;

  /** null — повернути ліміт зі змінної середовища */
  const saveCap = async (value: number | null) => {
    setBusy(true);
    setNote('');
    try {
      const r = await apiClient.setDovedeCityDailyCap(value);
      setCap(null);
      setNote(value == null ? `Ліміт — як у змінній на сервері: ${r.dailyCap} на день.` : `Збережено: до ${r.dailyCap} запитів до Google на день.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
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
              `запитів до Google сьогодні: ${data.callsToday} з ${data.dailyCap}${data.today && data.callsToday ? ` (люди ${data.today.people}, навчання ${data.today.learn})` : ''}`,
              data.today?.refused ? `людям відмовили через ліміт: ${data.today.refused}` : null,
              data.blocked ? `Google не питаємо до ${quotaTime(data.blocked.until)} — ${data.blocked.reason === 'quota' ? 'вичерпано квоту' : 'відмовлено в доступі'}` : null,
              data.googleError ? googleErrorLine(data.googleError) : null,
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
          <form
            className="dovede-city-fresh"
            onSubmit={(e) => {
              e.preventDefault();
              if (capOk) void saveCap(capNumber);
            }}
          >
            <label htmlFor="dovede-city-cap">Запитів до Google на день</label>
            <input
              id="dovede-city-cap"
              type="number"
              inputMode="numeric"
              min={CAP_MIN}
              max={CAP_MAX}
              step={10}
              value={capValue}
              onChange={(e) => setCap(e.target.value)}
              aria-describedby="dovede-city-cap-hint"
            />
            <button type="submit" className="dovede-log-chip" disabled={busy || !capOk || capNumber === data.dailyCap}>
              Зберегти
            </button>
            {data.dailyCapFromAdmin ? (
              <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void saveCap(null)}>
                Як на сервері{data.dailyCapDefault != null ? ` (${data.dailyCapDefault})` : ''}
              </button>
            ) : null}
            <span id="dovede-city-cap-hint" className="dovede-log-dim">
              {capOk
                ? `Сьогодні вже ${data.callsToday}. Люди й навчання разом; фонове навчання бере не більше половини. 0 — Google не питати зовсім.${data.dailyCapFromAdmin ? '' : ' Зараз — зі змінної на сервері.'}`
                : `Ціле число від ${CAP_MIN} до ${CAP_MAX} (квота проєкту в Google Cloud).`}
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
