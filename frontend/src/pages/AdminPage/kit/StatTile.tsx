import React from 'react';
import { Link } from 'react-router-dom';
import './kit.css';

export type StatTone = 'default' | 'warn' | 'error';

/**
 * Плитка з одним числом: підпис, значення, дрібний хвіст («/ 300»). З `to` плитка — посилання туди, де це число
 * можна розібрати (наприклад, на відфільтрований список).
 */
export const StatTile: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: StatTone; to?: string }> = ({ label, value, sub, tone = 'default', to }) => {
  const body = (
    <>
      <span className="admin-kit-tile-label">{label}</span>
      <strong className="admin-kit-tile-value">
        {value}
        {sub != null ? <small> {sub}</small> : null}
      </strong>
    </>
  );
  const cls = `admin-kit-tile${tone === 'default' ? '' : ` admin-kit-tile--${tone}`}`;
  return to ? (
    <Link to={to} className={`${cls} admin-kit-tile--link`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
};

export const StatTiles: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label }) => (
  <div className="admin-kit-tiles" role={label ? 'group' : undefined} aria-label={label}>
    {children}
  </div>
);
