import React, { useState } from 'react';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { dateUrlToIso, isoToDateUrl, nowClock, todayDateUrl, tomorrowDateUrl } from './dateUrl';

export interface DateTimeValue {
  /** `DD.MM.YY` — як у `?d=` */
  date: string;
  /** `HH:MM` — як у `?h=` */
  time: string;
}

interface DateTimeControlsProps extends DateTimeValue {
  /** Будь-яка зміна: поле дати, поле часу або чіп. Завжди обидва значення разом. */
  onChange: (next: DateTimeValue) => void;
  /** Префікс для id полів (`{prefix}-date`, `{prefix}-time`, `{prefix}-datetime-panel`) */
  idPrefix?: string;
  /** Для події `transport_date_chip` */
  page: 'planner' | 'board';
}

/**
 * Згорнутий рядок «Сьогодні, 09:12 · Змінити»; панель — нативна дата, час і чіпи
 * «Зараз» / «Завтра». Спільний для планувальника і табло (там зміни застосовуються одразу).
 */
export const DateTimeControls: React.FC<DateTimeControlsProps> = ({
  date,
  time,
  onChange,
  idPrefix = 'lt-search',
  page,
}) => {
  const [open, setOpen] = useState(false);
  const summaryLabel =
    date === todayDateUrl() ? 'Сьогодні' : date === tomorrowDateUrl() ? 'Завтра' : date || 'дата не вибрана';
  const panelId = `${idPrefix}-datetime-panel`;

  return (
    <>
      <div className="lt-datetime-summary">
        <span className="lt-datetime-summary-text">
          {summaryLabel}, {time || '—'}
        </span>
        <button
          type="button"
          className="lt-chip lt-datetime-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Згорнути' : 'Змінити'}
        </button>
      </div>
      {open && (
        <div className="lt-datetime-row" id={panelId}>
          <div className="lt-datetime-field">
            <label className="lt-datetime-label" htmlFor={`${idPrefix}-date`}>
              Дата
            </label>
            <input
              id={`${idPrefix}-date`}
              type="date"
              className="lt-datetime-input"
              value={dateUrlToIso(date)}
              onChange={(e) => onChange({ date: e.target.value ? isoToDateUrl(e.target.value) : '', time })}
            />
          </div>
          <div className="lt-datetime-field">
            <label className="lt-datetime-label" htmlFor={`${idPrefix}-time`}>
              Час
            </label>
            <input
              id={`${idPrefix}-time`}
              type="time"
              className="lt-datetime-input"
              value={time}
              onChange={(e) => onChange({ date, time: e.target.value })}
            />
          </div>
          <div className="lt-datetime-chips" role="group" aria-label="Швидкий вибір часу">
            <button
              type="button"
              className="lt-chip"
              aria-pressed={date === todayDateUrl()}
              onClick={() => {
                gaTrackEvent('transport_date_chip', { chip: 'now', page });
                onChange({ date: todayDateUrl(), time: nowClock() });
              }}
            >
              Зараз
            </button>
            <button
              type="button"
              className="lt-chip"
              aria-pressed={date === tomorrowDateUrl()}
              onClick={() => {
                gaTrackEvent('transport_date_chip', { chip: 'tomorrow', page });
                onChange({ date: tomorrowDateUrl(), time });
              }}
            >
              Завтра
            </button>
          </div>
        </div>
      )}
    </>
  );
};
