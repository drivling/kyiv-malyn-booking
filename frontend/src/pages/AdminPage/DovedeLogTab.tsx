import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { resolvePlace } from '@/pages/DovedePage/nlu/places';
import type { PlaceRef } from '@/pages/DovedePage/nlu/types';
import type { DovedeLog, DovedeLogDays, DovedeLogFlag, DovedeLogItem } from '@/types';
import { intentLine, questionLink } from './dovedeLogText';
import { AdminSectionHeader } from './kit';
import { dovedePath } from './dovede/sections';
import { useMalynStops } from './dovede/useMalynStops';
import './DovedeLogTab.css';

const PERIODS: DovedeLogDays[] = [1, 7, 30, 90];
const DEFAULT_DAYS: DovedeLogDays = 7;
const periodChip = (d: DovedeLogDays) => (d === 1 ? 'Сьогодні' : `${d} днів`);

type Only = '' | 'problems' | DovedeLogFlag;
const FILTERS: { only: Only; label: string }[] = [
  { only: '', label: 'Усі' },
  { only: 'problems', label: 'З проблемами' },
  { only: 'unknown', label: 'Невпізнані слова' },
  { only: 'no_place', label: 'Без місця' },
  { only: 'disagree', label: 'Розбіжності' },
  { only: 'fail', label: 'ШІ не відповів' },
];

const FLAG_LABEL: Record<DovedeLogFlag, string> = {
  fail: 'ШІ не відповів',
  disagree: 'розбіжність',
  unknown: 'невпізнані слова',
  no_place: 'без місця',
  other: 'не про дорогу',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'ШІ відповів',
  disabled: 'ШІ вимкнено',
  no_key: 'немає ключа',
  cap: 'денний ліміт',
  refusal: 'відмова',
  max_tokens: 'обрізана відповідь',
  invalid: 'хибна відповідь',
  timeout: 'не встиг',
  rate_limited: 'ліміт API',
  auth: 'ключ не прийнято',
  api_error: 'збій API',
};

/** `?days=` з адреси: лише 1 / 7 / 30 / 90, інакше 7 */
const daysFrom = (raw: string | null): DovedeLogDays => PERIODS.find((d) => String(d) === raw) ?? DEFAULT_DAYS;
/** `?only=` з адреси: лише фільтри зі списку, інакше «Усі» */
const onlyFrom = (raw: string | null): Only => FILTERS.find((f) => f.only === raw)?.only ?? '';

const KYIV_DT = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const num = (n: number) => n.toLocaleString('uk-UA');

/** «2,3 с» */
const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

/**
 * Журнал «Доведе», розділ «Питання людей» (/admin/dovede/questions, Docs/dovede-roadmap.md, фаза 4): що люди питали
 * і що з цього зрозуміли браузер та Claude. Головне тут — «Чого не впізнали»: «навчити» веде слово до розділу
 * «Словник». Період і фільтр — одна панель над списком (Docs/dovede-admin-roadmap.md, крок 9) і живуть в адресі
 * (`?days=30&only=disagree`), тож «Огляд» може послати сюди одразу з потрібним фільтром. У рядку питання —
 * невпізнані слова посиланнями «навчити» і «Відкрити як людина» (та сама відповідь сторінки, без виклику Claude).
 */
const DovedeLogTab: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const days = daysFrom(params.get('days'));
  const only = onlyFrom(params.get('only'));
  const [log, setLog] = useState<DovedeLog | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const stops = useMalynStops();
  const stopNames = useMemo(() => new Map(stops.map((s) => [s.id, s.name])), [stops]);

  /** міняє `?days=` / `?only=` без нового запису в історії; типові значення з адреси прибирає */
  const setQuery = useCallback(
    (next: { days?: DovedeLogDays; only?: Only }) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next.days !== undefined) {
            if (next.days === DEFAULT_DAYS) p.delete('days');
            else p.set('days', String(next.days));
          }
          if (next.only !== undefined) {
            if (next.only) p.set('only', next.only);
            else p.delete('only');
          }
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    apiClient
      .getDovedeLog(days, only)
      .then(setLog)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити журнал'))
      .finally(() => setLoading(false));
  }, [days, only]);

  useEffect(() => {
    load();
  }, [load]);

  const placeLabel = useMemo(
    () => (ref: PlaceRef | null) => (ref ? resolvePlace(ref.id)?.label ?? stopNames.get(ref.id) ?? ref.id : '?'),
    [stopNames],
  );

  const s = log?.summary;
  const compared = s ? s.agreed + s.disagreed : 0;

  const understanding = (it: DovedeLogItem) => {
    if (it.ai && it.local && it.agree === false) {
      return (
        <>
          <div>
            <span className="dovede-log-who">Claude:</span> {intentLine(it.ai, placeLabel)}
          </div>
          <div className="dovede-log-dim">
            <span className="dovede-log-who">браузер:</span> {intentLine(it.local, placeLabel)}
          </div>
        </>
      );
    }
    const intent = it.ai ?? it.local;
    return intent ? intentLine(intent, placeLabel) : '—';
  };

  return (
    <div className="dovede-log">
      <AdminSectionHeader
        title="Питання людей"
        purpose={
          <>
            Кожне питання зі сторінки <Link to="/dovede">«Доведе»</Link>: що зрозумів браузер за словником і що — Claude.
            Часи, маршрути й ціни ШІ не називає, тож тут лише розуміння тексту.
          </>
        }
        actions={
          <button type="button" className="dovede-log-chip" onClick={load}>
            Оновити
          </button>
        }
      />
      <div className="dovede-log-toolbar">
        <div className="dovede-log-chips" role="group" aria-label="Період">
          <span className="dovede-log-toolbar-label">Період</span>
          {PERIODS.map((d) => (
            <button key={d} type="button" className={`dovede-log-chip ${d === days ? 'active' : ''}`} aria-pressed={d === days} onClick={() => setQuery({ days: d })}>
              {periodChip(d)}
            </button>
          ))}
        </div>
        <div className="dovede-log-chips" role="group" aria-label="Фільтр">
          <span className="dovede-log-toolbar-label">Питання</span>
          {FILTERS.map((f) => (
            <button key={f.only} type="button" className={`dovede-log-chip ${f.only === only ? 'active' : ''}`} aria-pressed={f.only === only} onClick={() => setQuery({ only: f.only })}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {loading && !log ? <p>Завантаження…</p> : null}
      {log && s ? (
        <>
          {!log.enabled || !log.hasKey ? (
            <p className="dovede-log-warn">
              {log.enabled ? 'На сервері немає ключа ANTHROPIC_API_KEY' : 'ШІ-розбір вимкнено (DOVEDE_ENABLED)'} — сторінка
              відповідає лише за словником.
            </p>
          ) : null}
          <div className="dovede-log-tiles">
            <div className="dovede-log-tile">
              <span>Питань</span>
              <strong>{num(s.total)}</strong>
            </div>
            <div className="dovede-log-tile">
              <span>ШІ відповів</span>
              <strong>
                {num(s.aiOk)}
                {s.aiFailed ? <small> / збоїв {num(s.aiFailed)}</small> : null}
              </strong>
            </div>
            <div className="dovede-log-tile">
              <span>Словник = ШІ</span>
              <strong>{compared ? `${Math.round((s.agreed / compared) * 100)}%` : '—'}</strong>
            </div>
            <div className="dovede-log-tile">
              <span>З невпізнаним</span>
              <strong>{num(s.withUnknown)}</strong>
            </div>
            <div className="dovede-log-tile">
              <span>Без місця</span>
              <strong>{num(s.noPlace)}</strong>
            </div>
            <div className="dovede-log-tile">
              <span>Відповідь ШІ, медіана</span>
              <strong>{s.medianLatencyMs != null ? sec(s.medianLatencyMs) : '—'}</strong>
            </div>
            <div className="dovede-log-tile">
              <span>Викликів сьогодні</span>
              <strong>
                {num(log.callsToday)}
                <small> / {num(log.dailyCap)}</small>
              </strong>
            </div>
          </div>
          <p className="dovede-log-note">
            Токени за період: вхід {num(s.tokens.input)}, з кешу {num(s.tokens.cacheRead)}, запис у кеш {num(s.tokens.cacheWrite)},
            вихід {num(s.tokens.output)}.
            {s.byStatus.length > 1 ? ` Статуси: ${s.byStatus.map((b) => `${STATUS_LABEL[b.status] ?? b.status} — ${b.count}`).join(', ')}.` : ''}
            {log.truncated ? ' Питань за період більше, ніж уміщує зведення, — враховано найновіші.' : ''}
          </p>

          <h3>Чого не впізнали</h3>
          {s.topUnknown.length === 0 ? (
            <p className="dovede-log-empty">За цей період усі слова про місця впізнано.</p>
          ) : (
            <div className="dovede-log-scroll">
              <table className="dovede-log-table dovede-log-table--cards">
                <thead>
                  <tr>
                    <th>Слово</th>
                    <th>Разів</th>
                    <th>Приклад питання</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.topUnknown.map((u) => (
                    <tr key={u.word}>
                      <td data-label="Слово">
                        <strong>{u.word}</strong>
                      </td>
                      <td className="dovede-log-num" data-label="Разів">
                        {u.count}
                      </td>
                      <td className="dovede-log-text" data-label="Приклад">
                        {u.example}
                      </td>
                      <td>
                        <Link to={dovedePath('dictionary', { word: u.word })} className="dovede-log-chip">
                          навчити
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3>
            Питання{only ? ` · ${FILTERS.find((f) => f.only === only)?.label.toLowerCase()}` : ''}
            {' · '}
            <span className="dovede-log-dim">{periodChip(days).toLowerCase()}</span>
          </h3>
          {log.items.length === 0 ? (
            <p className="dovede-log-empty">{only ? 'Таких питань за цей період немає.' : 'За цей період питань ще не було.'}</p>
          ) : (
            <div className="dovede-log-scroll">
              <table className="dovede-log-table dovede-log-table--cards">
                <thead>
                  <tr>
                    <th>Коли</th>
                    <th>Питання</th>
                    <th>Як зрозуміли</th>
                    <th>Позначки</th>
                    <th>ШІ</th>
                  </tr>
                </thead>
                <tbody>
                  {log.items.map((it) => {
                    const unknown = (it.ai ?? it.local)?.unknown ?? [];
                    return (
                      <tr key={it.id} className={it.flags.length ? 'dovede-log-row--flagged' : undefined}>
                        <td className="dovede-log-num" data-label="Коли">
                          {KYIV_DT.format(new Date(it.createdAt))}
                        </td>
                        <td className="dovede-log-text" data-label="Питання">
                          {it.text}
                          <div>
                            <a className="dovede-log-open" href={questionLink(it)} target="_blank" rel="noreferrer" aria-label={`Відкрити як людина: ${it.text}`}>
                              відкрити як людина ↗
                            </a>
                          </div>
                        </td>
                        <td className="dovede-log-text" data-label="Як зрозуміли">
                          {understanding(it)}
                          {unknown.length ? (
                            <div className="dovede-log-unknown">
                              не впізнано:{' '}
                              {unknown.map((w, i) => (
                                <React.Fragment key={`${w}-${i}`}>
                                  {i ? ', ' : null}
                                  <Link to={dovedePath('dictionary', { word: w })} title={`Навчити слову «${w}»`}>
                                    {w}
                                  </Link>
                                </React.Fragment>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td data-label={it.flags.length ? 'Позначки' : undefined}>
                          {it.flags.map((f) => (
                            <span key={f} className={`dovede-log-flag dovede-log-flag--${f}`}>
                              {FLAG_LABEL[f]}
                            </span>
                          ))}
                        </td>
                        <td className="dovede-log-num" data-label="ШІ" title={[it.model, it.promptVersion, it.error].filter(Boolean).join(' · ') || undefined}>
                          {it.status === 'ok' && it.latencyMs != null ? sec(it.latencyMs) : STATUS_LABEL[it.status] ?? it.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {log.matched > log.items.length ? (
            <p className="dovede-log-note">
              Показано останні {log.items.length} з {num(log.matched)}.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

export default DovedeLogTab;
