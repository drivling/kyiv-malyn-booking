import React from 'react';
import { ZUBASTYK_PHONES } from './zubastykContent';
import { PHONE_ONLY_TITLE, zubastykTelHref } from './phoneOnlyBooking';
import './PhoneOnlyNotice.css';

type Props = {
  title?: string;
  /** Текст перед номерами; за замовчуванням — «бронюються лише за телефоном» */
  lead?: React.ReactNode;
  className?: string;
};

/** Помітне попередження «Зубастика»: онлайн-бронювання не працює, лише за телефоном + усі номери. */
export const PhoneOnlyNotice: React.FC<Props> = ({ title = PHONE_ONLY_TITLE, lead, className = '' }) => (
  <div className={`phone-only-notice ${className}`.trim()} role="note">
    <p className="phone-only-notice-title">⛔️ {title}</p>
    <p className="phone-only-notice-text">
      {lead ?? (
        <>
          Маршрутки Київ ↔ Малин («Зубастик») бронюються <strong>лише за телефоном</strong>:
        </>
      )}
    </p>
    <ul className="phone-only-notice-phones">
      {ZUBASTYK_PHONES.map((p) => (
        <li key={p.digits}>
          <a href={zubastykTelHref(p.digits)}>{p.label}</a>
          {p.note ? <span className="phone-only-notice-note"> ({p.note})</span> : null}
        </li>
      ))}
    </ul>
  </div>
);
