import React from 'react';
import './kit.css';

/** Одне речення там, де нічого показати або робити нічого; `action` — посилання чи кнопка поруч */
export const EmptyState: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="admin-kit-empty">
    <p>{children}</p>
    {action ?? null}
  </div>
);
