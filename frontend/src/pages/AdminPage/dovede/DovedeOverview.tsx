import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import type { DovedeCityStats, DovedeLog } from '@/types';
import { AdminSectionHeader, EmptyState, StatTile, StatTiles, StatusPill, type StatusTone } from '../kit';
import { googleErrorLine } from './googleError';
import { dovedePath } from './sections';

/** скільки днів дивиться «Потребує уваги» */
const ATTENTION_DAYS = 7;
/** скільки невпізнаних слів показати одразу */
const TOP_WORDS = 5;
/** з якої частки денного ліміту плитка жовтіє */
const NEAR_CAP = 0.8;

const num = (n: number) => n.toLocaleString('uk-UA');
const nearCap = (used: number, cap: number) => cap > 0 && used >= cap * NEAR_CAP;

type Part<T> = { data: T | null; error: string };
const empty = <T,>(): Part<T> => ({ data: null, error: '' });
const failed = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const aiState = (log: DovedeLog): [StatusTone, string] =>
  !log.enabled ? ['off', 'ШІ-розбір вимкнено'] : !log.hasKey ? ['error', 'ШІ: немає ключа'] : ['ok', 'ШІ-розбір працює'];

const cityState = (c: DovedeCityStats): [StatusTone, string] =>
  !c.enabled ? ['off', 'Пошук містом вимкнено'] : !c.hasKey ? ['error', 'Google: немає ключа'] : c.googleError ? ['warn', 'Google відмовляв'] : ['ok', 'Пошук містом працює'];

/**
 * «Огляд» вкладки «Доведе» (/admin/dovede): коротко — що сьогодні й що варто виправити, з посиланнями туди, де це
 * виправляють. Своїх даних не має: журнал питань (`GET /admin/dovede/queries`) і зведення міста
 * (`GET /admin/dovede/city`). Журнал питаємо двічі: за сьогодні з фільтром «з проблемами» (бо `matched` — скільки
 * таких) і за 7 днів з фільтром «ШІ не відповів» — зведення там за весь період, а фільтр лише зменшує список питань.
 */
export const DovedeOverview: React.FC = () => {
  const [today, setToday] = useState<Part<DovedeLog>>(empty);
  const [week, setWeek] = useState<Part<DovedeLog>>(empty);
  const [city, setCity] = useState<Part<DovedeCityStats>>(empty);

  const load = useCallback(() => {
    apiClient
      .getDovedeLog(1, 'problems')
      .then((data) => setToday({ data, error: '' }))
      .catch((e) => setToday({ data: null, error: failed(e, 'Не вдалося завантажити журнал') }));
    apiClient
      .getDovedeLog(ATTENTION_DAYS, 'fail')
      .then((data) => setWeek({ data, error: '' }))
      .catch((e) => setWeek({ data: null, error: failed(e, 'Не вдалося завантажити журнал') }));
    apiClient
      .getDovedeCity()
      .then((data) => setCity({ data, error: '' }))
      .catch((e) => setCity({ data: null, error: failed(e, 'Не вдалося завантажити зведення міста') }));
  }, []);

  useEffect(load, [load]);

  const t = today.data;
  const c = city.data;
  const w = week.data?.summary;
  const words = w?.topUnknown ?? [];
  const unanswered = c?.unanswered?.length ?? 0;
  const attention = [
    words.length ? (
      <li key="words">
        Не впізнали слів: {words.length >= 30 ? '30+' : words.length}.{' '}
        {words.slice(0, TOP_WORDS).map((u, i) => (
          <React.Fragment key={u.word}>
            {i ? ', ' : null}
            <Link to={dovedePath('dictionary', { word: u.word })} title={`Навчити слову «${u.word}»`}>
              {u.word}
            </Link>{' '}
            <span className="dovede-log-dim">×{u.count}</span>
          </React.Fragment>
        ))}
        {words.length > TOP_WORDS ? (
          <>
            {' · '}
            <Link to={dovedePath('questions', { days: ATTENTION_DAYS, only: 'unknown' })}>усі</Link>
          </>
        ) : null}
      </li>
    ) : null,
    w?.disagreed ? (
      <li key="disagree">
        <Link to={dovedePath('questions', { days: ATTENTION_DAYS, only: 'disagree' })}>Словник і ШІ зрозуміли по-різному: {num(w.disagreed)}</Link>
      </li>
    ) : null,
    w?.aiFailed ? (
      <li key="fail">
        <Link to={dovedePath('questions', { days: ATTENTION_DAYS, only: 'fail' })}>ШІ не відповів: {num(w.aiFailed)}</Link>
      </li>
    ) : null,
    unanswered ? (
      <li key="city">
        <Link to={dovedePath('city')}>Пар у місті без відповіді: {unanswered >= 100 ? '100+' : num(unanswered)}</Link>{' '}
        <span className="dovede-log-dim">— місця, куди Google дороги не знайшов або ліміт не дав спитати</span>
      </li>
    ) : null,
  ].filter(Boolean);

  const errors = [today.error, week.error, city.error].filter(Boolean);
  const loaded = week.data && city.data;

  return (
    <>
      <AdminSectionHeader
        title="Огляд"
        purpose="Що сьогодні з «Доведе» і що варто виправити."
        actions={
          <button type="button" className="dovede-log-chip" onClick={load}>
            Оновити
          </button>
        }
      />
      {errors.map((e) => (
        <p key={e} className="dovede-log-error">
          {e}
        </p>
      ))}
      {t || c ? (
        <div className="dovede-overview-status">
          {t ? <StatusPill tone={aiState(t)[0]}>{aiState(t)[1]}</StatusPill> : null}
          {c ? <StatusPill tone={cityState(c)[0]}>{cityState(c)[1]}</StatusPill> : null}
        </div>
      ) : null}

      <StatTiles label="Сьогодні">
        <StatTile label="Питань сьогодні" value={t ? num(t.summary.total) : '—'} />
        <StatTile label="З проблемами" value={t ? num(t.matched) : '—'} tone={t?.matched ? 'warn' : 'default'} to={dovedePath('questions', { days: 1, only: 'problems' })} />
        <StatTile label="Claude сьогодні" value={t ? num(t.callsToday) : '—'} sub={t ? `/ ${num(t.dailyCap)}` : undefined} tone={t && nearCap(t.callsToday, t.dailyCap) ? 'warn' : 'default'} />
        <StatTile label="Google сьогодні" value={c ? num(c.callsToday) : '—'} sub={c ? `/ ${num(c.dailyCap)}` : undefined} tone={c && nearCap(c.callsToday, c.dailyCap) ? 'warn' : 'default'} to={dovedePath('city')} />
      </StatTiles>

      {c?.googleError ? (
        <p className="dovede-log-warn">
          {googleErrorLine(c.googleError)}. <Link to={dovedePath('city')}>Відкрити «Місто»</Link>
        </p>
      ) : null}

      <h3>Потребує уваги · {ATTENTION_DAYS} днів</h3>
      {attention.length ? (
        <ul className="dovede-overview-attention">{attention}</ul>
      ) : loaded ? (
        <EmptyState>Усе гаразд: слова впізнано, словник і ШІ згодні, на всі питання про місто є відповідь.</EmptyState>
      ) : !errors.length ? (
        <p className="dovede-log-empty">Завантаження…</p>
      ) : null}
    </>
  );
};
