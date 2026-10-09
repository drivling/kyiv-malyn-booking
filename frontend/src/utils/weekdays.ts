/**
 * Дні тижня рейсу (Schedule.activeWeekdays: 1 = понеділок … 7 = неділя; порожньо = щодня).
 * Використовується і в SPA, і в prerender (через vite.ssrLoadModule) — одне джерело правди.
 */
const SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

export function normalizeWeekdays(days: number[] | null | undefined): number[] {
  const set = new Set((days ?? []).map(Number).filter((d) => d >= 1 && d <= 7));
  return set.size ? [...set].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
}

/** «щодня» · «Пн–Сб» · «Пн, Пт–Нд» · «Пт» */
export function weekdaysLabel(days: number[] | null | undefined): string {
  const d = normalizeWeekdays(days);
  if (d.length === 7) return 'щодня';
  const parts: string[] = [];
  let i = 0;
  while (i < d.length) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j += 1;
    parts.push(j - i >= 2 ? `${SHORT[d[i]]}–${SHORT[d[j]]}` : d.slice(i, j + 1).map((x) => SHORT[x]).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

export function isDaily(days: number[] | null | undefined): boolean {
  return normalizeWeekdays(days).length === 7;
}

/** Скільки рейсів на день по кожному дню тижня → мін/макс (для FAQ «усього N відправлень»). */
export function tripsPerDay(rows: Array<{ activeWeekdays?: number[] | null }>): { min: number; max: number } {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const r of rows) for (const d of normalizeWeekdays(r.activeWeekdays)) counts[d - 1] += 1;
  return { min: Math.min(...counts), max: Math.max(...counts) };
}

/** «10 рейсів щодня» · «від 10 до 13 рейсів залежно від дня тижня» */
export function tripsPerDayText(rows: Array<{ activeWeekdays?: number[] | null }>): string {
  const { min, max } = tripsPerDay(rows);
  return min === max ? `${max} рейсів щодня` : `від ${min} до ${max} рейсів залежно від дня тижня`;
}
