import React from 'react';
import { NavLink } from 'react-router-dom';
import './kit.css';

export interface AdminSection {
  /** сегмент адреси після вкладки; '' — перший розділ без сегмента (`/admin/<tab>`) */
  slug: string;
  label: string;
}

/**
 * Розділи вкладки адмінки з власними адресами `/admin/<tab>/<slug>` (Docs/dovede-admin-roadmap.md, трек A).
 * Звичайні посилання: розділ можна відкрити в новій вкладці або переслати; активний має `aria-current="page"`.
 * На телефоні ряд гортається вбік, а не переноситься.
 */
export const AdminSectionNav: React.FC<{ base: string; sections: readonly AdminSection[]; label: string }> = ({ base, sections, label }) => (
  <nav className="admin-kit-nav" aria-label={label}>
    {sections.map((s) => (
      <NavLink key={s.slug || '_'} to={s.slug ? `${base}/${s.slug}` : base} end className={({ isActive }) => `admin-kit-nav-link${isActive ? ' is-active' : ''}`}>
        {s.label}
      </NavLink>
    ))}
  </nav>
);
