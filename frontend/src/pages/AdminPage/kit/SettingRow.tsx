import React, { useState } from 'react';
import './kit.css';

/** Опис налаштування, як його віддає сервер (`GET /admin/<…>/settings`): що діє, типове, звідки, чи заблоковано */
export interface SettingRowData {
  key: string;
  kind: 'int' | 'bool';
  label: string;
  help: string;
  unit?: string;
  min?: number;
  max?: number;
  /** м'яка межа: більше зберегти можна, але рядок попереджає, а запис іде з підтвердженням */
  warnAbove?: number;
  /** текст попередження від сервера */
  warn?: string;
  value: number | boolean;
  default: number | boolean;
  defaultSource: 'env' | 'code';
  stored: number | boolean | null;
  updatedAt: string | null;
  lockedBy: string | null;
}

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long' });
const show = (v: number | boolean) => (typeof v === 'boolean' ? (v ? 'увімкнено' : 'вимкнено') : String(v));
const grouped = (n: number) => n.toLocaleString('uk-UA');
/** Попередження понад м'яку межу; для денного ліміту — ще й скільки це за місяць */
const warnText = (s: SettingRowData, n: number) =>
  `${s.warn || `Понад ${grouped(s.warnAbove ?? 0)}.`}${s.unit === 'на день' ? ` ${grouped(n)} на день — це до ${grouped(n * 30)} на місяць.` : ''}`;

/**
 * Один рядок налаштування: підпис і пояснення ліворуч, поле чи вмикач праворуч, під ним — звідки значення
 * («типове з сервера: 300», «змінено 19 листопада») і «Скинути до типового». Зберігає одразу (вмикач) або кнопкою
 * (число). `onSave(null)` — повернути типове. Число понад `warnAbove` — попередження під полем, кнопка «Зберегти все
 * одно» і `onSave(n, true)` (сервер без підтвердження такого не запише).
 */
export const SettingRow: React.FC<{ s: SettingRowData; busy?: boolean; onSave: (value: number | boolean | null, confirm?: boolean) => void | Promise<void> }> = ({ s, busy, onSave }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const id = `setting-${s.key.replace(/\W+/g, '-')}`;
  const text = draft ?? String(s.value);
  const n = Number(text);
  const valid = s.kind === 'int' && /^\d+$/.test(text) && n >= (s.min ?? 0) && n <= (s.max ?? Number.MAX_SAFE_INTEGER);
  const changed = s.kind === 'int' && valid && n !== s.value;
  // нове число понад м'яку межу — попередження замість рядка «звідки»; збережене раніше не муляє очі
  const over = changed && s.warnAbove != null && n > s.warnAbove;
  const source =
    s.stored != null
      ? `змінено${s.updatedAt ? ` ${dayMonth(s.updatedAt)}` : ''}, типове — ${show(s.default)}`
      : s.defaultSource === 'env'
        ? `типове з сервера: ${show(s.default)}`
        : `типове: ${show(s.default)}`;

  return (
    <div className={`admin-kit-setting${s.lockedBy ? ' is-locked' : ''}`}>
      <div className="admin-kit-setting-text">
        <label htmlFor={id}>{s.label}</label>
        <p id={`${id}-help`}>{s.help}</p>
      </div>
      <div className="admin-kit-setting-control">
        {s.kind === 'bool' ? (
          // назва вмикача — підпис ліворуч (label htmlFor); «Увімкнено / Вимкнено» поруч — лише стан
          <span className="admin-kit-switch">
            <input
              id={id}
              type="checkbox"
              role="switch"
              checked={Boolean(s.value)}
              disabled={busy || Boolean(s.lockedBy)}
              onChange={(e) => void onSave(e.target.checked)}
              aria-describedby={`${id}-help ${id}-source`}
            />
            <span aria-hidden="true">{s.value ? 'Увімкнено' : 'Вимкнено'}</span>
          </span>
        ) : (
          <form
            className="admin-kit-setting-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (changed) void Promise.resolve(over ? onSave(n, true) : onSave(n)).then(() => setDraft(null));
            }}
          >
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={s.min}
              max={s.max}
              step={1}
              value={text}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={!valid}
              aria-describedby={`${id}-help ${id}-source`}
            />
            {s.unit ? <span className="admin-kit-setting-unit">{s.unit}</span> : null}
            <button type="submit" className="admin-kit-btn" disabled={busy || !changed}>
              {over ? 'Зберегти все одно' : 'Зберегти'}
            </button>
          </form>
        )}
        <p id={`${id}-source`} className={`admin-kit-setting-source${valid || s.kind === 'bool' ? (over ? ' is-warn' : '') : ' is-error'}`}>
          {s.lockedBy
            ? `Вимкнено на сервері (${s.lockedBy}) — тут не ввімкнути.`
            : s.kind === 'int' && !valid
              ? `Ціле число від ${grouped(s.min ?? 0)} до ${grouped(s.max ?? Number.MAX_SAFE_INTEGER)}.`
              : over
                ? warnText(s, n)
                : source}
          {s.stored != null && !s.lockedBy ? (
            <button type="button" className="admin-kit-linkbtn" disabled={busy} onClick={() => void Promise.resolve(onSave(null)).then(() => setDraft(null))}>
              Скинути до типового
            </button>
          ) : null}
        </p>
      </div>
    </div>
  );
};
