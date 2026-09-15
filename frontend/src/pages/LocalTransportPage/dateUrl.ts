/**
 * Дата й час у форматі URL планувальника і табло: `d=DD.MM.YY`, `h=HH:MM`.
 * Спільне для LocalTransportPage і LocalTransportStopBoardPage (раніше дублювалось).
 */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Формат дати для URL як у Jakdojade: DD.MM.YY */
export function formatDateUrl(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = String(date.getFullYear()).slice(-2);
  return `${pad2(d)}.${pad2(m)}.${y}`;
}

export function parseDateUrl(s: string): Date | null {
  const m = s?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const [, day, month, year] = m;
  const y = year.length === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
  const d = new Date(y, parseInt(month, 10) - 1, parseInt(day, 10));
  return isNaN(d.getTime()) ? null : d;
}

/** `16.09.26` → `2026-09-16` (значення для `<input type="date">`); невалідне → ''. */
export function dateUrlToIso(dateUrl: string): string {
  const d = parseDateUrl(dateUrl);
  if (!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * `2026-09-16` (значення `<input type="date">`) → `16.09.26`; невалідне → ''.
 * Ручний розбір, без `Date.parse` — щоб не ловити зсув часових зон.
 */
export function isoToDateUrl(iso: string): string {
  const m = iso?.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const date = new Date(y, mo - 1, d);
  if (isNaN(date.getTime()) || date.getMonth() !== mo - 1 || date.getDate() !== d) return '';
  return formatDateUrl(date);
}

export function todayDateUrl(now: Date = new Date()): string {
  return formatDateUrl(now);
}

export function tomorrowDateUrl(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return formatDateUrl(d);
}

/** Поточний локальний час `HH:MM` — ініціалізатор поля «Час». */
export function nowClock(now: Date = new Date()): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}
