/**
 * «Доведе» · Київ: якими лініями Google возить у збережених відповідях і що з них є в наших даних
 * (Docs/dovede-learning-roadmap.md, крок 8в-1). Лінії КПТ, маршрутки з переліку міста, метро, кільцева електричка —
 * наші; приміські автобуси й решта — «немає в наших даних» (список для проєкту Київради). Плюс перевірка «чи ходить
 * лінія КПТ о цій годині» для звіту якості. Чисті функції.
 */
import type { CityStep } from './city-route';
import type { KptData } from './kyiv-kpt';
import { KYIV_KPT } from './kyiv-kpt-data';
import type { KyivTaxiData } from './kyiv-taxi';
import { KYIV_TAXI } from './kyiv-taxi-data';
import { normLineNo, taxiFor } from './kyiv-own-lines';

export type LineKind = 'kpt' | 'taxi' | 'metro' | 'ring' | 'rail' | 'funicular' | 'none';
export const LINE_KINDS: readonly LineKind[] = ['kpt', 'taxi', 'metro', 'ring', 'rail', 'funicular', 'none'];

export interface LineUse {
  mode: string;
  line: string;
  kind: LineKind;
  /** скільки разів ця лінія трапляється в кроках збережених відповідей */
  rides: number;
  /** у скількох різних парах «звідки → куди» */
  roads: number;
  /** назва маршруту з наших даних (КПТ — кінцеві, маршрутка — опис), якщо є */
  name?: string;
}

export interface KyivLinesReport {
  roads: number;
  lines: LineUse[];
  byKind: Record<LineKind, { lines: number; rides: number }>;
}

const isRail = (mode: string) => /RAIL|TRAIN/.test(mode) && !/LIGHT_RAIL/.test(mode);

/** Що це за лінія для нас: своя (КПТ, маршрутка з переліку, метро, кільцева, фунікулер) чи немає в наших даних */
export function lineKind(step: Pick<CityStep, 'mode' | 'line' | 'headsign'>, kpt: KptData = KYIV_KPT, taxi: KyivTaxiData = KYIV_TAXI): { kind: LineKind; name?: string } {
  const mode = String(step.mode ?? '').toUpperCase();
  const line = String(step.line ?? '');
  if (mode === 'SUBWAY') return { kind: 'metro' };
  if (mode === 'FUNICULAR' || /фунікулер/i.test(line)) return { kind: 'funicular' };
  if (isRail(mode)) return /city express/i.test(line) || /^E[12]\b/.test(String(step.headsign ?? '')) ? { kind: 'ring' } : { kind: 'rail' };
  const no = normLineNo(line);
  const dir = kpt.dirs.find((d) => d.mode === mode && normLineNo(d.no) === no);
  if (dir) return { kind: 'kpt', name: dir.name };
  const tx = taxiFor({ kind: 'transit', minutes: 0, mode, line }, kpt, taxi);
  if (tx) return { kind: 'taxi', name: tx.name };
  return { kind: 'none' };
}

/** Звіт по збережених відповідях Google (не в архіві) */
export function kyivLinesReport(rows: Array<{ fromKey: string; toKey: string; steps: unknown }>, kpt: KptData = KYIV_KPT, taxi: KyivTaxiData = KYIV_TAXI): KyivLinesReport {
  const byLine = new Map<string, LineUse & { pairs: Set<string> }>();
  const roads = new Set<string>();
  for (const r of rows) {
    const pair = `${r.fromKey}|${r.toKey}`;
    roads.add(pair);
    const steps = Array.isArray(r.steps) ? (r.steps as CityStep[]) : [];
    for (const s of steps) {
      if (s?.kind !== 'transit' || !s.line) continue;
      const mode = String(s.mode ?? 'BUS').toUpperCase();
      const key = `${mode}|${s.line.trim()}`;
      let u = byLine.get(key);
      if (!u) {
        const k = lineKind(s, kpt, taxi);
        u = { mode, line: s.line.trim(), kind: k.kind, rides: 0, roads: 0, pairs: new Set(), ...(k.name ? { name: k.name } : {}) };
        byLine.set(key, u);
      }
      u.rides++;
      u.pairs.add(pair);
    }
  }
  const byKind = Object.fromEntries(LINE_KINDS.map((k) => [k, { lines: 0, rides: 0 }])) as KyivLinesReport['byKind'];
  const lines: LineUse[] = [];
  for (const { pairs, ...u } of byLine.values()) {
    u.roads = pairs.size;
    byKind[u.kind].lines++;
    byKind[u.kind].rides += u.rides;
    lines.push(u);
  }
  lines.sort((a, b) => b.rides - a.rides || a.line.localeCompare(b.line, 'uk', { numeric: true }));
  return { roads: roads.size, lines, byKind };
}

/**
 * Чи ходить лінія КПТ (вид + номер) цього типу дня близько до цієї години: відправлення від першої точки будь-якого
 * напрямку за 90 хв до початку години … до її кінця (рейс, що вирушив раніше, ще в дорозі). null — такої лінії КПТ нема
 */
export function kptLineRunsAt(mode: string, line: string, dayType: string, hour: number, kpt: KptData = KYIV_KPT): boolean | null {
  const no = normLineNo(line);
  const dirs = kpt.dirs.filter((d) => d.mode === String(mode).toUpperCase() && normLineNo(d.no) === no);
  if (!dirs.length) return null;
  const from = hour * 60 - 90;
  const to = hour * 60 + 59;
  const weekend = dayType === 'saturday' || dayType === 'sunday';
  return dirs.some((d) => (weekend ? d.we : d.wd).some((t) => (t >= from && t <= to) || (t >= 1440 && t - 1440 >= from && t - 1440 <= to)));
}
