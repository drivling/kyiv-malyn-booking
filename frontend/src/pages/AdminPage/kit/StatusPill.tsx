import React from 'react';
import './kit.css';

/** ok — працює, warn — працює з застереженням, error — зламано, off — вимкнено свідомо, busy — зараз іде */
export type StatusTone = 'ok' | 'warn' | 'error' | 'off' | 'busy';

/** Короткий стан одним словом-двома: «ШІ: працює», «Google: відмова» */
export const StatusPill: React.FC<{ tone: StatusTone; children: React.ReactNode; title?: string }> = ({ tone, children, title }) => (
  <span className={`admin-kit-pill admin-kit-pill--${tone}`} title={title}>
    {children}
  </span>
);
