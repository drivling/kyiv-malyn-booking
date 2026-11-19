/**
 * Години кампанії навчання: сервер приймає й віддає їх рядком `weekday@09,saturday@11` (як `--when` у
 * `npm run dovede:crawl`); тут — перетворення в набір для вибору клітинками й у текст для людини.
 * Сервер шукає збережену відповідь на годину ± 1, тож 09 закриває 08–10.
 */
export type DayType = 'weekday' | 'saturday' | 'sunday';

export const DAY_TYPES: DayType[] = ['weekday', 'saturday', 'sunday'];
export const DAY_LABEL: Record<DayType, string> = { weekday: 'Будні', saturday: 'Субота', sunday: 'Неділя' };
/** години, які можна вибрати */
export const HOURS: number[] = Array.from({ length: 17 }, (_, i) => i + 6);

export const hourKey = (day: DayType, hour: number) => `${day}@${String(hour).padStart(2, '0')}`;

/** `weekday@09,saturday@11:00` → набір ключів `weekday@09`; незрозуміле пропускаємо */
export function parseHours(spec: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of String(spec ?? '').split(',')) {
    const m = /^\s*(weekday|saturday|sunday)@(\d{1,2})(?::\d{2})?\s*$/.exec(part);
    if (m && Number(m[2]) <= 23) out.add(hourKey(m[1] as DayType, Number(m[2])));
  }
  return out;
}

const order = (key: string) => {
  const [day, hour] = key.split('@');
  return DAY_TYPES.indexOf(day as DayType) * 100 + Number(hour);
};

/** набір → рядок для сервера: спершу будні, далі субота й неділя, години за зростанням */
export function formatHours(set: Iterable<string>): string {
  return [...set].sort((a, b) => order(a) - order(b)).join(',');
}

/** `weekday@09,weekday@17,saturday@11` → «будні 09:00, 17:00 · субота 11:00» */
export function hoursText(spec: string | undefined): string {
  const byDay = new Map<DayType, number[]>();
  for (const key of [...parseHours(spec)].sort((a, b) => order(a) - order(b))) {
    const [day, hour] = key.split('@');
    byDay.set(day as DayType, [...(byDay.get(day as DayType) ?? []), Number(hour)]);
  }
  return [...byDay].map(([day, hours]) => `${DAY_LABEL[day].toLowerCase()} ${hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}`).join(' · ');
}
