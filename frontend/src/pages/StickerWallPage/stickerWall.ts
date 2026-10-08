/**
 * Віджет «Відкриття з QR» на стіну — чиста логіка: зупинки зі знімка + назви й кольори ліній зі
 * схеми, «Топ дня» і «Зараз ростуть», святкування нових сканів (перше за день, рубежі, рекорд),
 * тихі години й підписи часу за Києвом.
 */
import type { TransportDataset } from '@/api/transportDataset';
import type { StickerWallSnapshot } from '@/types';
import { stickerStopCatalog } from '@/pages/AdminPage/stopSticker/scanStats';
import { brightestLineColor, prettyStopName } from '@/pages/AdminPage/stopSticker/stickerModel';
import { SCHEME_ROUTES } from '@/pages/LocalTransportPage/scheme/malyn-scheme-routes';

/** Як часто віджет тягне знімок: скани поодинокі, 30 с — «одразу» для людини біля стіни */
export const WALL_POLL_MS = 30_000;
/** Скільки триває одне святкування */
export const CELEBRATION_MS = 7_000;
/** Автоперемикання вкладок «Топ дня» / «Зараз ростуть» */
export const TAB_ROTATE_MS = 20_000;

/** Палітра ліній схеми — для смуги, конфеті й зупинок без кольору */
export const SCHEME_PALETTE: string[] = SCHEME_ROUTES.map((r) => r.color);
const FALLBACK_COLOR = '#2a78d6';

export type WallLine = { routeId: string; color: string | null };

export type WallStop = StickerWallSnapshot['stops'][number] & {
  name: string;
  lines: WallLine[];
  /** Найяскравіший колір ліній зупинки (як назва на наклейці) */
  color: string;
};

export type StopInfo = { name: string; lines: WallLine[]; color: string };

/** Назви й лінії всіх зупинок датасету (у т. ч. без відправлень — для старих наклейок) */
export function stopDirectory(dataset: TransportDataset | null): Map<string, StopInfo> {
  const dir = new Map<string, StopInfo>();
  if (!dataset) return dir;
  for (const s of dataset.stops) dir.set(s.id, { name: prettyStopName(s.name), lines: [], color: FALLBACK_COLOR });
  for (const c of stickerStopCatalog(dataset)) {
    dir.set(c.stopId, { name: c.name, lines: c.lines, color: brightestLineColor(c.lines) ?? FALLBACK_COLOR });
  }
  return dir;
}

export function wallStops(snapshot: StickerWallSnapshot | null, dir: Map<string, StopInfo>): WallStop[] {
  if (!snapshot) return [];
  return snapshot.stops.map((s) => {
    const info = dir.get(s.stopId);
    return { ...s, name: info?.name ?? s.stopId, lines: info?.lines ?? [], color: info?.color ?? FALLBACK_COLOR };
  });
}

/** «Топ дня»: найбільше відкриттів сьогодні (рівні — свіжіший скан вище) */
export function topStops(stops: WallStop[], n = 5): WallStop[] {
  return [...stops]
    .sort((a, b) => b.today - a.today || (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.name.localeCompare(b.name, 'uk'))
    .slice(0, n);
}

/** «Зараз ростуть»: відкриття за останню годину, далі за 3 години; хто мовчить 3 години — не росте */
export function growingStops(stops: WallStop[], n = 5): WallStop[] {
  return stops
    .filter((s) => s.last3h > 0)
    .sort((a, b) => b.lastHour - a.lastHour || b.last3h - a.last3h || (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
    .slice(0, n);
}

/** Останні `count` годин доби до поточної включно — міні-графік зупинки */
export function recentHours(hourly: number[], hour: number, count = 8): { hour: number; value: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const h = (hour - count + 1 + i + 24) % 24;
    return { hour: h, value: hourly[h] ?? 0 };
  });
}

export type CelebrationKind = 'scan' | 'first' | 'milestone' | 'record' | 'summary';

export type Celebration = {
  key: string;
  kind: CelebrationKind;
  /** Великий надпис над назвою */
  headline: string;
  stopId: string | null;
  name: string;
  lines: WallLine[];
  color: string;
  /** Скільки нових відкриттів святкуємо */
  added: number;
  /** Відкриттів зупинки сьогодні (після нових) */
  stopToday: number;
  /** Місце зупинки в «Топі дня» */
  rank: number;
  /** Відкриттів усього сьогодні після цього святкування */
  totalAfter: number;
};

export const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000];
/** Рекорд святкуємо, коли попередній кращий день був хоч якимось */
const RECORD_MIN = 3;
const MAX_STOP_CELEBRATIONS = 3;

/**
 * Нові скани з одного опитування → черга святкувань: по одній на зупинку (у порядку сканів).
 * Перше відкриття дня, перетнутий рубіж (10, 25, 50…) або рекорд найкращої доби — особливий
 * заголовок. Якщо зупинок більше трьох, решта збирається в одне «Ще +N на K зупинках».
 */
export function buildCelebrations(snapshot: StickerWallSnapshot, stops: WallStop[]): Celebration[] {
  if (!snapshot.events.length) return [];
  const byId = new Map(stops.map((s) => [s.stopId, s]));
  const ranked = topStops(stops, stops.length);
  const rankOf = (id: string) => ranked.findIndex((s) => s.stopId === id) + 1;
  const groups: { stopId: string; added: number; lastId: number }[] = [];
  for (const e of snapshot.events) {
    const g = groups.find((x) => x.stopId === e.stopId);
    if (g) {
      g.added += 1;
      g.lastId = e.id;
    } else groups.push({ stopId: e.stopId, added: 1, lastId: e.id });
  }
  let running = Math.max(0, snapshot.total - snapshot.events.length);
  const best = snapshot.bestDay && snapshot.bestDay.count >= RECORD_MIN ? snapshot.bestDay.count : null;
  const out: Celebration[] = [];
  const shown = groups.length > MAX_STOP_CELEBRATIONS + 1 ? groups.slice(0, MAX_STOP_CELEBRATIONS) : groups;
  for (const g of shown) {
    const before = running;
    running += g.added;
    const stop = byId.get(g.stopId);
    let kind: CelebrationKind = 'scan';
    let headline = g.added > 1 ? `+${g.added} відкриття з QR` : 'Нове відкриття з QR';
    const milestone = [...MILESTONES].reverse().find((m) => before < m && running >= m);
    if (before === 0) {
      kind = 'first';
      headline = 'Перше відкриття сьогодні!';
    } else if (best != null && before <= best && running > best) {
      kind = 'record';
      headline = `Рекорд дня! Уже ${running}`;
    } else if (milestone) {
      kind = 'milestone';
      headline = `Уже ${milestone} сьогодні!`;
    }
    out.push({
      key: `${g.stopId}-${g.lastId}`,
      kind,
      headline,
      stopId: g.stopId,
      name: stop?.name ?? g.stopId,
      lines: stop?.lines ?? [],
      color: stop?.color ?? FALLBACK_COLOR,
      added: g.added,
      stopToday: stop?.today ?? g.added,
      rank: rankOf(g.stopId),
      totalAfter: running,
    });
  }
  const rest = groups.slice(shown.length);
  if (rest.length) {
    const added = rest.reduce((n, g) => n + g.added, 0);
    running += added;
    out.push({
      key: `rest-${rest[rest.length - 1].lastId}`,
      kind: 'summary',
      headline: 'І ще відкриття',
      stopId: null,
      name: `Ще +${added} на ${rest.length} ${plural(rest.length, ['зупинці', 'зупинках', 'зупинках'])}`,
      lines: [],
      color: SCHEME_PALETTE[0] ?? FALLBACK_COLOR,
      added,
      stopToday: 0,
      rank: 0,
      totalAfter: running,
    });
  }
  return out;
}

/** Українські форми числа: [1, 2–4, 5+] */
export function plural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

const KYIV_HM = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const KYIV_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' });
const KYIV_DATE = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'long', day: 'numeric', month: 'long' });

export function kyivHour(now: Date): number {
  return Number(KYIV_HOUR.format(now)) % 24;
}

export function kyivClock(now: Date): { time: string; date: string } {
  return { time: KYIV_HM.format(now), date: KYIV_DATE.format(now) };
}

/** «щойно», «5 хв тому», «2 год тому» */
export function agoLabel(iso: string | null, now: Date): string {
  if (!iso) return '';
  const min = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  return `${Math.floor(min / 60)} год тому`;
}

/** Тихі години (без звуку): з 22:00 до 08:00 за Києвом */
export function isQuietHour(now: Date): boolean {
  const h = kyivHour(now);
  return h >= 22 || h < 8;
}

/** Ніч (приглушений екран): з 23:00 до 06:00 за Києвом */
export function isNightHour(now: Date): boolean {
  const h = kyivHour(now);
  return h >= 23 || h < 6;
}

/** Чи читається білий текст на кольорі (відносна яскравість WCAG) */
export function textOn(hex: string): '#ffffff' | '#10131a' {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = m.slice(1).map((x) => lin(parseInt(x, 16)));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.45 ? '#10131a' : '#ffffff';
}

export type WallSettings = { sound: boolean; quietNights: boolean };
export const DEFAULT_WALL_SETTINGS: WallSettings = { sound: true, quietNights: true };
const SETTINGS_KEY = 'stickerWallSettings';
const KEY_STORAGE = 'stickerWallKey';

export function loadWallSettings(): WallSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_WALL_SETTINGS, ...(JSON.parse(raw) as Partial<WallSettings>) } : DEFAULT_WALL_SETTINGS;
  } catch {
    return DEFAULT_WALL_SETTINGS;
  }
}

export function saveWallSettings(s: WallSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* приватний режим — налаштування лише до перезавантаження */
  }
}

export function storedWallKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function storeWallKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* без збереження ключ лишається в адресі сторінки */
  }
}

/** Посилання на віджет для QR в адмінці */
export function wallUrl(origin: string, key: string): string {
  return `${origin}/admin/wall?key=${encodeURIComponent(key)}`;
}
