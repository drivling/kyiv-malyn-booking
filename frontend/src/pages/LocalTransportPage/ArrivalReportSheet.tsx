import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiClient } from '@/api/client';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import type { ArrivalReportKind } from '@/types';
import {
  ARRIVED_WINDOW_MIN,
  arrivalClientId,
  arrivalReportWindow,
  delayLabel,
  minsToHhmm,
  type ArrivalTarget,
} from './arrivalReport';
import { getKyivMinutesNow } from './kyivTime';
import './ArrivalReportSheet.css';

const MINUTES_AGO = [2, 5, 10] as const;
const WAITED = [10, 20, 30, 45] as const;

type Props = {
  target: ArrivalTarget | null;
  /** Обрана на сторінці дата — сьогодні (за Києвом) */
  isToday: boolean;
  onClose: () => void;
};

type Phase =
  | { step: 'choose' }
  | { step: 'missed' }
  | { step: 'sending' }
  | { step: 'done'; text: string }
  | { step: 'error'; text: string };

/**
 * Нижня панель «Факт прибуття» після довгого натискання на час рейсу: «Автобус тут» (зараз або
 * N хв тому) чи «Автобуса не було» (скільки чекали). Звіт іде в POST /transport/arrival-reports —
 * поки лише статистика для точніших графіків.
 */
export const ArrivalReportSheet: React.FC<Props> = ({ target, isToday, onClose }) => {
  const [phase, setPhase] = useState<Phase>({ step: 'choose' });
  const [nowMins, setNowMins] = useState(() => getKyivMinutesNow());
  const dialogRef = useRef<HTMLDivElement>(null);
  /**
   * Палець уже торкнувся відкритої панелі. Після довгого натискання Chrome на Android шле ще й
   * «клік» у те саме місце, коли палець піднімають, — а там уже фон або кнопка панелі. Такий клік
   * (без власного pointerdown) не закриває панель і не надсилає звіт. Клавіатура (detail = 0) — як є.
   */
  const armed = useRef(false);

  useEffect(() => {
    if (!target) return;
    armed.current = false;
    setPhase({ step: 'choose' });
    setNowMins(getKyivMinutesNow());
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target || typeof document === 'undefined') return null;

  const win = arrivalReportWindow(target.scheduledTime, nowMins, isToday);

  const send = async (kind: ArrivalReportKind, extra: { minutesAgo?: number; waitedMin?: number }) => {
    setPhase({ step: 'sending' });
    try {
      const res = await apiClient.reportArrival({
        kind,
        routeId: target.routeId,
        tripId: target.tripId,
        direction: target.direction,
        stopId: target.stopId,
        scheduledTime: target.scheduledTime,
        source: target.source,
        ...extra,
        ...(arrivalClientId() ? { clientId: arrivalClientId() as string } : {}),
      });
      gaTrackEvent('transport_arrival_report', { route_id: target.routeId, kind, source: target.source });
      const text =
        kind === 'arrived' && res.actualTime
          ? `Записали: автобус приїхав о ${res.actualTime}${res.delayMin !== null ? ` — ${delayLabel(res.delayMin)}` : ''}.`
          : 'Записали, що автобуса не було.';
      setPhase({ step: 'done', text });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setPhase({
        step: 'error',
        text: /too far/i.test(msg)
          ? 'Цей рейс уже далеко від поточного часу — оберіть найближчий.'
          : 'Не вдалося надіслати. Перевірте зʼєднання і спробуйте ще раз.',
      });
    }
  };

  const nowClock = minsToHhmm(nowMins);

  return createPortal(
    <div
      className="lt-arrival-backdrop"
      onPointerDownCapture={() => {
        armed.current = true;
      }}
      onClickCapture={(e) => {
        if (armed.current || e.detail === 0) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="lt-arrival-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lt-arrival-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="lt-arrival-close" onClick={onClose} aria-label="Закрити">
          ×
        </button>
        <h2 id="lt-arrival-title" className="lt-arrival-title">
          №{target.routeId} · {target.scheduledTime} за розкладом
        </h2>
        <p className="lt-arrival-sub">
          Зупинка «{target.stopName}»
          {target.destination ? <> · → {target.destination}</> : null}
        </p>

        {phase.step === 'done' ? (
          <div className="lt-arrival-done" role="status">
            <p>
              <strong>Дякуємо!</strong> {phase.text}
            </p>
            <p className="lt-arrival-hint">Із таких позначок ми складемо точніший розклад.</p>
            <button type="button" className="lt-arrival-btn lt-arrival-btn--primary" onClick={onClose}>
              Готово
            </button>
          </div>
        ) : !isToday ? (
          <p className="lt-arrival-note">Позначити прибуття можна лише для сьогоднішніх рейсів — оберіть «Зараз».</p>
        ) : !win.canArrive && !win.canMiss ? (
          <p className="lt-arrival-note">
            Зараз {nowClock} — цей рейс надто далеко від поточного часу. Позначте рейс у межах{' '}
            {ARRIVED_WINDOW_MIN / 60} год від зараз.
          </p>
        ) : phase.step === 'missed' ? (
          <div className="lt-arrival-block">
            <p className="lt-arrival-q">Скільки ви чекали на зупинці?</p>
            <div className="lt-arrival-chips">
              {WAITED.map((m) => (
                <button key={m} type="button" className="lt-arrival-chip" onClick={() => void send('missed', { waitedMin: m })}>
                  {m === 45 ? '45+ хв' : `${m} хв`}
                </button>
              ))}
            </div>
            <button type="button" className="lt-arrival-link" onClick={() => void send('missed', {})}>
              Не памʼятаю — просто записати
            </button>
            <button type="button" className="lt-arrival-link" onClick={() => setPhase({ step: 'choose' })}>
              ← Назад
            </button>
          </div>
        ) : (
          <div className="lt-arrival-block">
            <p className="lt-arrival-hint">Позначте, коли автобус справді приїхав, — так ми уточнимо розклад.</p>
            {win.canArrive ? (
              <>
                <button
                  type="button"
                  className="lt-arrival-btn lt-arrival-btn--primary"
                  disabled={phase.step === 'sending'}
                  onClick={() => void send('arrived', { minutesAgo: 0 })}
                >
                  Автобус тут — зараз {nowClock}
                </button>
                <div className="lt-arrival-chips" aria-label="Автобус приїхав раніше">
                  <span className="lt-arrival-chips__label">Був раніше:</span>
                  {MINUTES_AGO.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="lt-arrival-chip"
                      disabled={phase.step === 'sending'}
                      onClick={() => void send('arrived', { minutesAgo: m })}
                    >
                      {m} хв тому
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {win.canMiss ? (
              <button
                type="button"
                className="lt-arrival-btn"
                disabled={phase.step === 'sending'}
                onClick={() => setPhase({ step: 'missed' })}
              >
                Чекав(-ла), автобуса не було
              </button>
            ) : null}
            {phase.step === 'error' ? (
              <p className="lt-arrival-error" role="alert">
                {phase.text}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
