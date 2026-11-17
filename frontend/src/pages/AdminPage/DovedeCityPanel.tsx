import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeCityStats } from '@/types';

const CITY: Record<string, string> = { Kyiv: 'Київ', Zhytomyr: 'Житомир' };
const SOURCE: Record<string, string> = { google: 'з Google', own: 'свої', open: 'відкриті дані' };

const count = (rows: Array<{ city: string; count: number }>, city: string) => rows.filter((r) => r.city === city).reduce((n, r) => n + r.count, 0);

/**
 * «Місто: що вже знаємо» — транспорт Києва й Житомира, який «Доведе» зібрала із запитів людей (Docs/dovede-roadmap.md,
 * «Місто»). Нічого не видаляється: «заархівувати» ховає дані з Google від відповідей і навчання, «відновити» повертає.
 */
export const DovedeCityPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DovedeCityStats | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

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

  const act = async (what: 'learn' | 'archive' | 'restore') => {
    if (what === 'archive' && !window.confirm('Заархівувати все, що прийшло з Google? Дані лишаться в базі, але у відповіді не підуть. Повернути можна кнопкою «Відновити з архіву».')) return;
    if (what === 'restore' && !window.confirm('Повернути з архіву все, що прийшло з Google?')) return;
    setBusy(true);
    setNote('');
    try {
      if (what === 'learn') {
        const r = await apiClient.dovedeCityLearn();
        setNote(r.asked ? `Спитано пар: ${r.asked}, отримано відповідей: ${r.learned}.` : 'Оновлювати нічого: усе свіже або вичерпано денний ліміт.');
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

  const cities = data ? [...new Set([...data.routes.map((r) => r.city), ...data.lines.map((r) => r.city), ...data.stops.map((r) => r.city), 'Kyiv', 'Zhytomyr'])].sort() : [];
  const unanswered = data ? data.demand.filter((d) => d.answered === 0) : [];

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
              `збережена відповідь свіжа ${data.freshDays} днів`,
              data.archivedRoutes ? `в архіві маршрутів: ${data.archivedRoutes}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
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
                    {CITY[d.city] ?? d.city}: {d.from} → {d.to} <span className="dovede-log-dim">— {d.asked} разів{d.answered === 0 ? ', відповіді немає' : ''}</span>
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
            <button type="button" className="dovede-log-chip" disabled={busy} onClick={() => void act('archive')}>
              Заархівувати все, що з Google
            </button>
            <button type="button" className="dovede-log-chip" disabled={busy || data.archivedRoutes === 0} onClick={() => void act('restore')}>
              Відновити з архіву
            </button>
          </div>
          {note ? <p className="dovede-log-note">{note}</p> : null}
        </>
      ) : null}
    </div>
  );
};
