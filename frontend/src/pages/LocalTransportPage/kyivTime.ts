/**
 * Київський час для розкладів: «зараз» у хвилинах від півночі, календарна дата за Києвом і
 * зсув обраної дати поїздки відносно сьогодні. Спільне для планувальника і табло.
 */

/** Поточний час у Києві (хвилини з півночі) */
export function getKyivMinutesNow(): number {
  const str = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

export function getKyivCalendarDate(): { d: number; m: number; y: number } {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  return { d, m: mo, y };
}

/**
 * Скільки календарних днів між обраною датою поїздки (поле «Дата», DD.MM.YY) і сьогодні за
 * Києвом. 0 — сьогодні, 1 — завтра, -1 — вчора; null — некоректний формат.
 */
export function searchDateKyivOffsetDays(searchDateStr: string): number | null {
  const m = searchDateStr?.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const k = getKyivCalendarDate();
  const msSearch = Date.UTC(year, month - 1, day, 12, 0, 0);
  const msKyiv = Date.UTC(k.y, k.m - 1, k.d, 12, 0, 0);
  return Math.round((msSearch - msKyiv) / 86400000);
}
