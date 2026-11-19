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
 *    метро — тобто за розкладом поїзди туди зараз не ходять. Це записано в `METRO_SHUTTLE_DEFAULT`; коли рух відновлять,
 *    власник вимикає його в адмінці («Налаштування» → «Дані сторінки»), без деплою.
 * Усе це — середні: час кроку метро в історії завжди з «≈».
 */
import type { MetroLine } from '../nlu/kyivMetroData';

export interface MetroService {
  checkedAt: string;
  openMins: number;
  closeMins: number;
  fareUah: number;
  hopSeconds: Record<MetroLine, number>;
  transferSeconds: number;
  accessSeconds: number;
  headwaySeconds: { peak: number; day: number; evening: number };
}

/**
 * Типові дані метро з коду. Години й тариф власник може змінити в адмінці (крок 11 плану адмінки, «Дані сторінки»):
 * сторінка читає `GET /dovede/page-data` і кладе їх сюди (`applyMetroData`), тому `METRO_SERVICE` — живий обʼєкт.
 */
const SERVICE_DEFAULT: MetroService = {
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
};

export const METRO_SERVICE: MetroService = { ...SERVICE_DEFAULT };

/**
 * Дільниця, де замість поїздів ходить автобус: після станції `after` у бік кінцевої. Видубичі → Позняки автобусом —
 * 659 с (три станції), Видубичі → Бориспільська — 1072 с (шість): близько 200 с на «перегін». null — метро їздить усюди.
 */
export interface MetroShuttle {
  line: MetroLine;
  after: string;
  stations: string[];
  bus: string;
  hopSeconds: number;
  waitSeconds: number;
  checkedAt?: string;
}

export const METRO_SHUTTLE_DEFAULT: MetroShuttle | null = {
  line: 'M3',
  after: 'kyiv.m.vydubychi',
  stations: ['kyiv.m.slavutych', 'kyiv.m.osokorky', 'kyiv.m.pozniaky', 'kyiv.m.kharkivska', 'kyiv.m.vyrlytsia', 'kyiv.m.boryspilska', 'kyiv.m.chervonyi-khutir'],
  bus: '318',
  hopSeconds: 200,
  waitSeconds: 300,
  checkedAt: '2026-11-17',
};

let shuttle: MetroShuttle | null = METRO_SHUTTLE_DEFAULT;

/** Дільниця з автобусом замість поїздів, що діє зараз (типова з коду або з адмінки); null — метро їздить усюди */
export const metroShuttle = (): MetroShuttle | null => shuttle;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Дані метро з адмінки (`GET /dovede/page-data`, лише змінені ключі): `metro.shuttle` — обʼєкт або null («метро
 * їздить усюди»), `metro.service` — години й тариф. Незрозуміле пропускаємо — лишається типове з коду.
 */
export function applyMetroData(values: Record<string, unknown>): void {
  if ('metro.shuttle' in values) {
    const v = values['metro.shuttle'];
    if (v === null) shuttle = null;
    else if (isObj(v) && typeof v.line === 'string' && typeof v.after === 'string' && Array.isArray(v.stations) && typeof v.bus === 'string' && isInt(v.hopSeconds) && isInt(v.waitSeconds)) {
      shuttle = { line: v.line as MetroLine, after: v.after, stations: v.stations.filter((x): x is string => typeof x === 'string'), bus: v.bus, hopSeconds: v.hopSeconds, waitSeconds: v.waitSeconds, ...(typeof v.checkedAt === 'string' ? { checkedAt: v.checkedAt } : {}) };
    }
  }
  const sv = values['metro.service'];
  if (isObj(sv) && isInt(sv.openMins) && isInt(sv.closeMins) && isInt(sv.fareUah) && sv.closeMins > sv.openMins) {
    Object.assign(METRO_SERVICE, { openMins: sv.openMins, closeMins: sv.closeMins, fareUah: sv.fareUah });
  }
}

/** Назад до типового з коду (тести) */
export function resetMetroData(): void {
  shuttle = METRO_SHUTTLE_DEFAULT;
  Object.assign(METRO_SERVICE, SERVICE_DEFAULT);
}

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
