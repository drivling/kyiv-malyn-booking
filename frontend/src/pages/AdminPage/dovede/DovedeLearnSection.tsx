import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import type { DovedeCampaign, DovedeCampaignList } from '@/types';
import { AdminSectionHeader, EmptyState } from '../kit';
import { CampaignCard } from './learn/CampaignCard';
import { NewCampaign } from './learn/NewCampaign';
import { QualityPanel } from './learn/QualityPanel';
import { isActive, isOpen, num } from './learn/campaignText';
import { dovedePath } from './sections';
import './learn/learn.css';

/** як часто оновлювати список, поки кампанія йде (сервер ставить питання раз на хвилину) */
export const LEARN_POLL_MS = 15_000;

/**
 * Розділ «Навчання» (Docs/dovede-admin-roadmap.md, крок 7): кампанії навчання міста на сервері. Власник обирає
 * заготовку, бачить оцінку в запитах до Google, погоджує число — і сервер сам обходить місто, поки не витратить
 * погоджене (`backend/src/dovede/city-campaign.ts`). Тут же — фонове навчання, що йде й без кампаній.
 */
export const DovedeLearnSection: React.FC = () => {
  const [list, setList] = useState<DovedeCampaignList | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [stepBusy, setStepBusy] = useState(false);

  const load = useCallback(() => {
    apiClient
      .getDovedeCampaigns()
      .then((r) => {
        setList(r);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити кампанії'));
  }, []);

  useEffect(load, [load]);

  const active = Boolean(list?.campaigns.some(isActive));
  useEffect(() => {
    if (!active) return undefined;
    const t = window.setInterval(load, LEARN_POLL_MS);
    return () => window.clearInterval(t);
  }, [active, load]);

  const replace = (c: DovedeCampaign) => {
    setList((l) => (l ? { ...l, campaigns: l.campaigns.map((x) => (x.id === c.id ? c : x)) } : l));
    load();
  };

  const started = (c: DovedeCampaign) => {
    setNote(`Почато: «${c.title}». Сервер ставить до 20 питань щохвилини; перші відповіді — за хвилину-дві.`);
    setList((l) => (l ? { ...l, campaigns: [c, ...l.campaigns] } : l));
    load();
  };

  const step = async () => {
    setStepBusy(true);
    setNote('');
    try {
      const r = await apiClient.dovedeCityLearn();
      setNote(r.asked ? `Фонове навчання: спитано пар — ${r.asked}, отримано відповідей — ${r.learned}.` : 'Фонове навчання: оновлювати нічого — усе свіже або вичерпано його частку ліміту.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося');
    } finally {
      setStepBusy(false);
    }
  };

  const open = list?.campaigns.filter(isOpen) ?? [];
  const closed = list?.campaigns.filter((c) => !isOpen(c)) ?? [];
  const g = list?.google;

  return (
    <section className="dv-learn">
      <AdminSectionHeader
        title="Навчання"
        purpose="Сервер сам вивчає дороги містом: ви обираєте заготовку, бачите, скільки запитів до Google це коштує, і погоджуєте число."
        actions={
          <button type="button" className="dovede-log-chip" onClick={load}>
            Оновити
          </button>
        }
      />
      {g ? (
        <p className="dv-learn-hint dv-learn-google">
          Google сьогодні: <strong>{num(g.calls)}</strong> з {num(g.cap)} · {num(g.reserve)} лишаємо людям — кампанії питають, лише поки витрачено менше ніж{' '}
          {num(Math.max(0, g.cap - g.reserve))}. Ліміт — у розділі <Link to={dovedePath('settings')}>«Налаштування»</Link>.
        </p>
      ) : null}
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

      <div className="dv-learn-layout">
        <div className="dv-learn-main">
          <h3>Кампанії</h3>
          {!list && !error ? <p className="dovede-log-empty">Завантажую…</p> : null}
          {list && !list.campaigns.length ? <EmptyState>Кампаній ще не було. Почніть із «Навчити місто» — праворуч.</EmptyState> : null}
          {open.map((c) => (
            <CampaignCard key={c.id} c={c} onChange={replace} />
          ))}
          {closed.length ? (
            <>
              {open.length ? <h4 className="dv-learn-sub">Завершені</h4> : null}
              {closed.map((c) => (
                <CampaignCard key={c.id} c={c} onChange={replace} />
              ))}
            </>
          ) : null}

          <div className="dv-learn-card dv-learn-bg">
            <h4>Фонове навчання</h4>
            <p className="dv-learn-hint">
              Без кампаній сервер щогодини сам оновлює відповіді, що застаріли, і пари, які питали люди, — у межах своєї частки ліміту (розділ{' '}
              <Link to={dovedePath('settings')}>«Налаштування»</Link>, група «Фонове навчання»).
            </p>
            <button type="button" className="dovede-log-chip" disabled={stepBusy} onClick={() => void step()}>
              {stepBusy ? 'Питаю…' : 'Крок зараз'}
            </button>
          </div>
        </div>
        <NewCampaign onStarted={started} />
      </div>
      <QualityPanel />
    </section>
  );
};
