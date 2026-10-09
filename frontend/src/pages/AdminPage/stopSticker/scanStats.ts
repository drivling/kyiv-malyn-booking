import type { TransportDataset } from '@/api/transportDataset';
import type { StickerScanStats, StickerSide } from '@/types';
import { prettyStopName, stickerLines } from './stickerModel';

/**
 * Статистика наклейок для адмінки (GET /admin/transport/sticker-scans): ряди для графіків по
 * добах і годинах, частини доби, список усіх зупинок з лічильниками. Чисті функції — тести без DOM.
 */

/** Обсяг графіків: уся мережа або одна зупинка */
export type ScanScope = { stopId?: string };

const inScope = (scope: ScanScope | undefined) => (r: { stopId: string }) => !scope?.stopId || r.stopId === scope.stopId;

const KYIV_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Сьогоднішня київська доба, YYYY-MM-DD */
export function kyivToday(now = new Date()): string {
  return KYIV_DAY.format(now);
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Суцільний ряд діб, що закінчується сьогодні (дні без відкриттів — нулі) */
export function dailySeries(
  daily: StickerScanStats['daily'],
  days: number,
  today: string,
  scope?: ScanScope
): { day: string; count: number }[] {
  const by = new Map<string, number>();
  for (const d of daily.filter(inScope(scope))) by.set(d.day, (by.get(d.day) ?? 0) + d.count);
  return Array.from({ length: days }, (_, i) => {
    const day = shiftDay(today, i - days + 1);
    return { day, count: by.get(day) ?? 0 };
  });
}

/** Відкриття по годинах доби 0–23 */
export function hourBuckets(hourly: StickerScanStats['hourly'], scope?: ScanScope): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const h of hourly.filter(inScope(scope))) if (h.hour >= 0 && h.hour < 24) out[h.hour] += h.count;
  return out;
}

export const DAY_PARTS = [
  { key: 'morning', label: 'Ранок', from: 5, to: 11 },
  { key: 'day', label: 'День', from: 11, to: 17 },
  { key: 'evening', label: 'Вечір', from: 17, to: 23 },
  { key: 'night', label: 'Ніч', from: 23, to: 5 },
] as const;

/** Частини доби з годин: ранок 05–11, день 11–17, вечір 17–23, ніч 23–05 (кінець не включно) */
export function dayParts(hours: number[]): { key: string; label: string; range: string; count: number }[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  return DAY_PARTS.map((p) => {
    let count = 0;
    for (let h = 0; h < 24; h += 1) {
      const inside = p.from < p.to ? h >= p.from && h < p.to : h >= p.from || h < p.to;
      if (inside) count += hours[h] ?? 0;
    }
    return { key: p.key, label: p.label, range: `${pad(p.from)}–${pad(p.to)}`, count };
  });
}

/** Підсумки обсягу: усього / 7 / 30 днів, наклейок надруковано й зі сканами */
export function scopeTotals(stats: StickerScanStats, scope?: ScanScope) {
  const rows = stats.rows.filter(inScope(scope));
  const sum = (k: 'total' | 'today' | 'last7d' | 'last30d') => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  return {
    total: sum('total'),
    today: sum('today'),
    last7d: sum('last7d'),
    last30d: sum('last30d'),
    printed: stats.printed.filter(inScope(scope)).length,
    scanned: rows.filter((r) => r.total > 0).length,
  };
}

export type StopCatalogEntry = {
  stopId: string;
  name: string;
  /** Лінії з відправленнями з зупинки, порядок легенди схеми */
  lines: { routeId: string; color: string | null }[];
};

/** Усі зупинки, з яких відправляються лінії (кандидати на наклейку) */
export function stickerStopCatalog(dataset: TransportDataset): StopCatalogEntry[] {
  return dataset.stops
    .map((s) => {
      const seen = new Map<string, string | null>();
      for (const l of stickerLines(dataset, s.id)) if (!seen.has(l.routeId)) seen.set(l.routeId, l.color);
      return { stopId: s.id, name: prettyStopName(s.name), lines: [...seen].map(([routeId, color]) => ({ routeId, color })) };
    })
    .filter((s) => s.lines.length > 0);
}

export type StopStatRow = StopCatalogEntry & {
  /** Відкриття по наклейках зупинки: a / b — боки, s — одна наклейка */
  sides: Partial<Record<StickerSide, number>>;
  total: number;
  last7d: number;
  lastScanAt: string | null;
  /** Наклейки, які друкували, і коли востаннє */
  printedSides: StickerSide[];
  lastPrintAt: string | null;
};

const maxIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Рядки списку зупинок: усі кандидати з каталогу + зупинки, що мають скани чи друк, але вже без
 * ліній (маршрут змінили) — щоб історія не губилась.
 */
export function stopStatRows(catalog: StopCatalogEntry[], stats: StickerScanStats | null, stopName: (id: string) => string): StopStatRow[] {
  const byId = new Map<string, StopStatRow>(
    catalog.map((c) => [c.stopId, { ...c, sides: {}, total: 0, last7d: 0, lastScanAt: null, printedSides: [], lastPrintAt: null }])
  );
  const row = (stopId: string) => {
    let r = byId.get(stopId);
    if (!r) {
      r = { stopId, name: stopName(stopId), lines: [], sides: {}, total: 0, last7d: 0, lastScanAt: null, printedSides: [], lastPrintAt: null };
      byId.set(stopId, r);
    }
    return r;
  };
  for (const s of stats?.rows ?? []) {
    const r = row(s.stopId);
    r.sides[s.side] = (r.sides[s.side] ?? 0) + s.total;
    r.total += s.total;
    r.last7d += s.last7d;
    r.lastScanAt = maxIso(r.lastScanAt, s.lastAt);
  }
  for (const p of stats?.printed ?? []) {
    const r = row(p.stopId);
    if (!r.printedSides.includes(p.side)) r.printedSides.push(p.side);
    r.lastPrintAt = maxIso(r.lastPrintAt, p.lastAt);
  }
  return [...byId.values()];
}

export type StopSort = 'popular' | 'name' | 'recent';

export function sortStopRows(rows: StopStatRow[], sort: StopSort): StopStatRow[] {
  const byName = (a: StopStatRow, b: StopStatRow) => a.name.localeCompare(b.name, 'uk');
  const out = [...rows];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'recent') return out.sort((a, b) => (b.lastScanAt ?? '').localeCompare(a.lastScanAt ?? '') || byName(a, b));
  return out.sort((a, b) => b.total - a.total || b.last7d - a.last7d || byName(a, b));
}

/** Пошук за назвою або id; «лише з наклейками» — надруковано або вже є скани */
export function filterStopRows(rows: StopStatRow[], opts: { query?: string; onlyWithStickers?: boolean }): StopStatRow[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q) || r.stopId.toLowerCase().includes(q)) &&
      (!opts.onlyWithStickers || r.printedSides.length > 0 || r.total > 0)
  );
}

/** Верх шкали графіка: «круглий» максимум (1, 2, 5 × 10ⁿ), щоб позначка осі читалась */
export function niceMax(max: number): number {
  if (max <= 4) return Math.max(1, Math.ceil(max));
  const p = 10 ** Math.floor(Math.log10(max));
  const m = max / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** «1 відкриття», «3 відкриття», «5 відкриттів», «11 відкриттів», «21 відкриття» */
export function opensLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const few = mod10 >= 1 && mod10 <= 4 && (mod100 < 11 || mod100 > 14);
  return `${n} ${few ? 'відкриття' : 'відкриттів'}`;
}

const WEEKDAY = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', timeZone: 'UTC' });

/** «06.10» і «06.10, вт» для київської доби YYYY-MM-DD */
export function dayLabels(day: string): { short: string; long: string } {
  const [y, m, d] = day.split('-');
  const short = `${d}.${m}`;
  return { short, long: `${short}, ${WEEKDAY.format(new Date(`${y}-${m}-${d}T12:00:00Z`))}` };
}
