/**
 * Віджет «Відкриття з QR» на стіну — чиста логіка: зупинки зі знімка + назви й кольори ліній зі
 * схеми, «Топ дня» і «Зараз ростуть», святкування нових сканів (перше за день, рубежі, рекорд),
 * тихі години й підписи часу за Києвом.
 */
import type { TransportDataset } from '@/api/transportDataset';
import type { AdWallSnapshot, StickerWallSnapshot } from '@/types';
import { stickerStopCatalog } from '@/pages/AdminPage/stopSticker/scanStats';
import { brightestLineColor, prettyStopName } from '@/pages/AdminPage/stopSticker/stickerModel';
import { currentScheme, textColorOn } from '@/pages/LocalTransportPage/routeColors';
import { TRANSPORT_CITY_PARAM, isDefaultTransportCity } from '@/site/transportCity';

/** Як часто віджет тягне знімок: скани поодинокі, 30 с — «одразу» для людини біля стіни */
export const WALL_POLL_MS = 30_000;
/** Скільки триває одне святкування */
export const CELEBRATION_MS = 7_000;
/** Автоперемикання вкладок «Топ дня» / «Зараз ростуть» */
export const TAB_ROTATE_MS = 20_000;

/** Вкладки правої колонки: «Топ дня», «Зараз ростуть», «Реклама», «Люди» — у порядку автоперемикання */
export type WallTab = 'top' | 'growing' | 'ads' | 'people';
export const WALL_TABS: WallTab[] = ['top', 'growing', 'ads', 'people'];

/**
 * Палітра ліній схеми міста стіни (місто датасету, який завантажила стіна) — для смуги, конфеті й зупинок
 * без кольору; місто без схеми — порожня, тоді діє запасний колір
 */
export function schemePalette(): string[] {
  return (currentScheme()?.routes ?? []).map((r) => r.color);
}
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

/** `newcomer` — новий пасажир: уперше відсканував наклейку й досмотрів тизер «Доведе» (тизер — раз на браузер) */
export type CelebrationKind = 'scan' | 'first' | 'milestone' | 'record' | 'summary' | 'newcomer';

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
  /** Лише `newcomer`: скільки новеньких (досмотріли тизер) сьогодні разом із цим */
  newToday?: number;
  /** Лише `newcomer`: номер пасажира в місті (backend sticker-people.ts), якщо сервер його знає */
  passenger?: number | null;
};

/** Рубежі номера пасажира: «до № 400 — ще 88» на стіні й особливе святкування, коли новенький їх досягає */
export const PASSENGER_MILESTONES = [10, 25, 50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
const PASSENGER_ORDINALS: Record<number, string> = {
  10: 'Десятий',
  25: 'Двадцять пʼятий',
  50: 'Пʼятдесятий',
  100: 'Сотий',
  150: 'Сто пʼятдесятий',
  200: 'Двохсотий',
  300: 'Трьохсотий',
  400: 'Чотирьохсотий',
  500: 'Пʼятисотий',
  1000: 'Тисячний',
};

/** Найближчий рубіж після `total` (за останнім із списку — наступна тисяча) */
export function nextPassengerMilestone(total: number): number {
  return PASSENGER_MILESTONES.find((m) => m > total) ?? (Math.floor(total / 1000) + 1) * 1000;
}

/** Заголовок святкування новенького: на рубежі — «Сотий пасажир!», інакше — «Новий пасажир № 37!» */
export function newcomerHeadline(passenger: number | null | undefined): { headline: string; milestone: boolean } {
  if (passenger && PASSENGER_MILESTONES.includes(passenger)) {
    return { headline: PASSENGER_ORDINALS[passenger] ? `${PASSENGER_ORDINALS[passenger]} пасажир!` : `Пасажир № ${passenger}!`, milestone: true };
  }
  return { headline: passenger ? `Новий пасажир № ${passenger}!` : 'Новий пасажир!', milestone: false };
}

/** Ширина смужки: частка від цілого, у відсотках */
export function pctWidth(part: number, whole: number): string {
  return whole > 0 ? `${Math.min(100, (part / whole) * 100)}%` : '0%';
}

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
      color: schemePalette()[0] ?? FALLBACK_COLOR,
      added,
      stopToday: 0,
      rank: 0,
      totalAfter: running,
    });
  }
  return out;
}

type AdView = AdWallSnapshot['views'][number];
const MAX_NEWCOMERS = 3;

/**
 * Новенькі з опитування «Реклами»: досмотрені тизери з наклейок, яких стіна ще не бачила (старі за часом — першими).
 * Перший знімок — лише точка відліку, щоб після перезавантаження стіна не святкувала вчорашніх.
 */
export function freshNewcomers(seen: ReadonlySet<string> | null, ads: AdWallSnapshot): { fresh: AdView[]; seen: Set<string> } {
  const done = ads.views.filter((v) => v.placement === 'sticker' && v.kind === 'view' && v.completed);
  const next = new Set(done.map((v) => v.viewId));
  if (!seen) return { fresh: [], seen: next };
  return { fresh: done.filter((v) => !seen.has(v.viewId)).sort((a, b) => a.at.localeCompare(b.at)), seen: next };
}

/** Особливе святкування на кожного новенького (до трьох; більше — три + «Ще +N новеньких») */
export function buildNewcomerCelebrations(fresh: AdView[], ads: AdWallSnapshot, dir: Map<string, StopInfo>): Celebration[] {
  if (!fresh.length) return [];
  const today = ads.sticker.today.completed;
  const shown = fresh.length > MAX_NEWCOMERS + 1 ? fresh.slice(0, MAX_NEWCOMERS) : fresh;
  const out: Celebration[] = shown.map((v, i) => {
    const info = v.stopId ? dir.get(v.stopId) : undefined;
    return {
      key: `new-${v.viewId}`,
      kind: 'newcomer',
      headline: newcomerHeadline(v.number).headline,
      passenger: v.number ?? null,
      stopId: v.stopId,
      name: info?.name ?? v.stopId ?? 'Табло зупинки',
      lines: info?.lines ?? [],
      color: info?.color ?? FALLBACK_COLOR,
      added: 1,
      stopToday: 0,
      rank: 0,
      totalAfter: 0,
      newToday: Math.max(1, today - (fresh.length - 1 - i)),
    };
  });
  const rest = fresh.length - shown.length;
  if (rest > 0) {
    out.push({
      key: `new-rest-${fresh[fresh.length - 1].viewId}`,
      kind: 'newcomer',
      headline: 'Нові пасажири!',
      stopId: null,
      name: `Ще +${rest} ${plural(rest, ['новенький', 'новеньких', 'новеньких'])}`,
      lines: [],
      color: FALLBACK_COLOR,
      added: rest,
      stopToday: 0,
      rank: 0,
      totalAfter: 0,
      newToday: Math.max(1, today),
    });
  }
  return out;
}

/**
 * Скани й новенькі одного опитування разом: новенький (скан + досмотрений тизер в одному опитуванні) отримує лише
 * своє, особливе святкування — звичайне «Нове відкриття з QR» тієї ж зупинки зайве. Перше за день, рубіж і рекорд
 * лишаються.
 */
export function withNewcomers(scans: Celebration[], newcomers: Celebration[]): Celebration[] {
  if (!newcomers.length) return scans;
  const stops = new Set(newcomers.map((c) => c.stopId).filter(Boolean));
  return [...scans.filter((c) => !(c.kind === 'scan' && c.added === 1 && c.stopId && stops.has(c.stopId))), ...newcomers];
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

/** «щойно» / «12 хв» / «3 год» сьогодні; раніше — «вчора 14:05» або «15 лист.» */
export function adWhen(iso: string, now: Date): string {
  const min = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв`;
  const at = new Date(iso);
  const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d);
  if (dayOf(at) === dayOf(now)) return `${Math.floor(min / 60)} год`;
  if (dayOf(at) === dayOf(new Date(now.getTime() - 86_400_000))) return `вчора ${kyivClock(at).time}`;
  return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short' }).format(at);
}

/** Сталий колір для анонімного «хто»: той самий браузер — та сама крапка */
export function whoHue(who: string): number {
  let h = 0;
  for (const ch of who) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
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

/** Текст на кольорі лінії: білий або чорний, що контрастніше (як номери на плашках схеми, WCAG ≥ 4.5:1) */
export const textOn = textColorOn;

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
export function wallUrl(origin: string, key: string, city?: string): string {
  const forCity = isDefaultTransportCity(city) ? '' : `&${TRANSPORT_CITY_PARAM}=${encodeURIComponent(city as string)}`;
  return `${origin}/admin/wall?key=${encodeURIComponent(key)}${forCity}`;
}
