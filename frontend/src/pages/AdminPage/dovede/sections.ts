import type { AdminSection } from '../kit';

/** Адреса вкладки «Доведе» в адмінці; розділи — `/admin/dovede/<slug>` */
export const DOVEDE_ADMIN_BASE = '/admin/dovede';

export type DovedeSectionSlug = '' | 'questions' | 'dictionary' | 'city' | 'learning' | 'settings';

/** Розділи вкладки (Docs/dovede-admin-roadmap.md, кроки 1, 3 і 7) */
export const DOVEDE_SECTIONS: ReadonlyArray<AdminSection & { slug: DovedeSectionSlug }> = [
  { slug: '', label: 'Огляд' },
  { slug: 'questions', label: 'Питання людей' },
  { slug: 'dictionary', label: 'Словник' },
  { slug: 'city', label: 'Місто' },
  { slug: 'learning', label: 'Навчання' },
  { slug: 'settings', label: 'Налаштування' },
];

export const isDovedeSection = (slug: string): slug is DovedeSectionSlug => DOVEDE_SECTIONS.some((s) => s.slug === slug);

/** `/admin/dovede/dictionary?word=…` і подібні; порожні параметри не пишемо */
export function dovedePath(section: DovedeSectionSlug, query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return `${section ? `${DOVEDE_ADMIN_BASE}/${section}` : DOVEDE_ADMIN_BASE}${qs ? `?${qs}` : ''}`;
}
