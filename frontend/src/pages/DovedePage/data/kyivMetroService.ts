/**
 * Як їздить київське метро — власні дані «Доведе» (Docs/dovede-roadmap.md, «Метро Києва»). Станції й лінії —
 * у `nlu/kyivMetroData.ts`; тут те, що потрібно для часу поїздки й картки.
 *
 * Звідки (перевірено 2026-11-17):
 *  - години роботи 05:30–23:00 і ціна 30 грн (з 15.07.2026) — стаття «Київський метрополітен» української
 *    Вікіпедії; офіційний сайт metro.kyiv.ua того дня не відповідав;
 *  - час у дорозі по лінії й інтервали — виміряно запитами до Google Routes (розклад самого метрополітену):
 *    М1 Академмістечко → Лісова 2593 с на 17 перегонів і Святошин → Вокзальна 850 с на 5; М2 Героїв Дніпра →
 *    Теремки 2286 с на 17; М3 Сирець → Видубичі 1468 с на 7 і Золоті ворота → Видубичі 671 с на 4; інтервали М3
 *    225 / 360 / 420 с (пік / день / вечір) — для М1 і М2 Google їх не дав, тому беремо ті самі як оцінку згори;
 *  - на всі запити за «Видубичі» (Славутич … Червоний хутір) Google замість метро дає автобус №318 від метро до
 *    метро — тобто за розкладом поїзди туди зараз не ходять. Це записано в `METRO_SHUTTLE`; коли рух відновлять,
 *    досить зробити його `null`.
 * Усе це — середні: час кроку метро в історії завжди з «≈».
 */
import type { MetroLine } from '../nlu/kyivMetroData';

export const METRO_SERVICE = {
  checkedAt: '2026-11-17',
  /** перший вхід і закриття для пасажирів, хв від півночі */
  openMins: 5 * 60 + 30,
  closeMins: 23 * 60,
  fareUah: 30,
  /** середній перегін разом зі стоянкою, с */
  hopSeconds: { M1: 158, M2: 134, M3: 185 } as Record<MetroLine, number>,
  /** перехід між станціями пересадки пішки, с */
  transferSeconds: 240,
  /** від входу до платформи й від платформи до виходу разом, с */
  accessSeconds: 240,
  /** інтервал між поїздами, с */
  headwaySeconds: { peak: 225, day: 360, evening: 420 },
} as const;

/**
 * Дільниця, де замість поїздів ходить автобус: після станції `after` у бік кінцевої. Видубичі → Позняки автобусом —
 * 659 с (три станції), Видубичі → Бориспільська — 1072 с (шість): близько 200 с на «перегін». null — метро їздить усюди.
 */
export const METRO_SHUTTLE: { line: MetroLine; after: string; stations: string[]; bus: string; hopSeconds: number; waitSeconds: number; checkedAt: string } | null = {
  line: 'M3',
  after: 'kyiv.m.vydubychi',
  stations: ['kyiv.m.slavutych', 'kyiv.m.osokorky', 'kyiv.m.pozniaky', 'kyiv.m.kharkivska', 'kyiv.m.vyrlytsia', 'kyiv.m.boryspilska', 'kyiv.m.chervonyi-khutir'],
  bus: '318',
  hopSeconds: 200,
  waitSeconds: 300,
  checkedAt: '2026-11-17',
};

/** Кольори ліній — як у розкладі метрополітену, синя й зелена трохи темніші, щоб білий текст мав контраст ≥ 4.5:1 */
export const METRO_LINE: Record<MetroLine, { no: string; name: string; color: string; ink: string }> = {
  M1: { no: 'М1', name: 'червона лінія', color: '#dd2616', ink: '#ffffff' },
  M2: { no: 'М2', name: 'синя лінія', color: '#1f6fa9', ink: '#ffffff' },
  M3: { no: 'М3', name: 'зелена лінія', color: '#1f7a3a', ink: '#ffffff' },
};

export type MetroPeriod = 'peak' | 'day' | 'evening';

/** Пік — будні 07–10 і 17–20; вечір — після 20:00; решта — день. `isoDate` — 'YYYY-MM-DD' */
export function metroPeriod(mins: number, isoDate: string): MetroPeriod {
  const [y, m, d] = isoDate.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const weekday = wd >= 1 && wd <= 5;
  if (mins >= 20 * 60) return 'evening';
  if (weekday && ((mins >= 7 * 60 && mins < 10 * 60) || (mins >= 17 * 60 && mins < 20 * 60))) return 'peak';
  return 'day';
}

/** Чи можна зайти в метро о цій порі; після півночі (хв ≥ 1440) — це вже ніч */
export function metroOpenAt(mins: number): boolean {
  const m = ((mins % 1440) + 1440) % 1440;
  return m >= METRO_SERVICE.openMins && m < METRO_SERVICE.closeMins;
}
