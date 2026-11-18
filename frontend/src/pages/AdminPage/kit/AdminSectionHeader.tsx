import React from 'react';
import './kit.css';

/** Заголовок розділу: назва, один рядок «навіщо цей розділ» і місце для кнопок праворуч */
export const AdminSectionHeader: React.FC<{ title: string; purpose?: React.ReactNode; actions?: React.ReactNode }> = ({ title, purpose, actions }) => (
  <header className="admin-kit-head">
    <div className="admin-kit-head-text">
      <h2>{title}</h2>
      {purpose ? <p>{purpose}</p> : null}
    </div>
    {actions ? <div className="admin-kit-head-actions">{actions}</div> : null}
  </header>
);
