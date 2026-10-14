/** «14.10.2026» за Києвом для мітки даних (revision або час копії); null, коли мітки нема або вона не дата */
const AS_OF_FORMAT = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kiev',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDataAsOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return AS_OF_FORMAT.format(d);
}
