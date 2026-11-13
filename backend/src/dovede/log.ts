/**
 * «Доведе» — журнал питань для адмінки (Docs/dovede-roadmap.md, фаза 4): що люди питали, що з цього зрозумів
 * браузер, що Claude, і де вони розійшлись. Чиста логіка над рядками DovedeQuery: позначки проблем і зведення
 * (скільки питань, скільки викликів ШІ, які слова ніхто не впізнав — з них видно, які місця додавати далі).
 */
import type { TripIntent } from './intent';

export const DOVEDE_LOG_DAYS = [1, 7, 30, 90] as const;
export type DovedeLogDays = (typeof DOVEDE_LOG_DAYS)[number];
/** Скільки рядків за період читаємо для зведення і скільки останніх віддаємо в таблицю */
export const DOVEDE_LOG_SCAN = 5000;
export const DOVEDE_LOG_ROWS = 300;

/**
 * fail — ШІ не відповів (збій, ліміт, вимкнено); disagree — браузер і Claude зрозуміли по-різному;
 * unknown — лишились невпізнані слова; no_place — питання про дорогу без «звідки» або «куди»;
 * other — питання не про дорогу.
 */
export type DovedeLogFlag = 'fail' | 'disagree' | 'unknown' | 'no_place' | 'other';

export interface DovedeQueryRow {
  id: number;
  createdAt: Date;
  text: string;
  localIntent: unknown;
  aiIntent: unknown;
  agree: boolean | null;
  status: string;
  aiCalled: boolean;
  model: string | null;
  promptVersion: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  error: string | null;
}

export interface DovedeLogItem {
  id: number;
  createdAt: string;
  text: string;
  status: string;
  aiCalled: boolean;
  agree: boolean | null;
  latencyMs: number | null;
  model: string | null;
  promptVersion: string | null;
  error: string | null;
  local: TripIntent | null;
  ai: TripIntent | null;
  flags: DovedeLogFlag[];
}

export interface DovedeLogSummary {
  total: number;
  aiCalls: number;
  aiOk: number;
  aiFailed: number;
  /** з тих, де було що порівнювати */
  agreed: number;
  disagreed: number;
  withUnknown: number;
  noPlace: number;
  medianLatencyMs: number | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  byStatus: { status: string; count: number }[];
  /** слова, яких не впізнав ніхто: найчастіші першими, з прикладом питання */
  topUnknown: { word: string; count: number; example: string }[];
}

function asIntent(v: unknown): TripIntent | null {
  if (!v || typeof v !== 'object') return null;
  const i = v as Partial<TripIntent>;
  return typeof i.intent === 'string' && i.when != null && Array.isArray(i.unknown) ? (i as TripIntent) : null;
}

/** Остаточне розуміння питання: Claude, а коли його не було — браузер */
export function finalIntent(row: Pick<DovedeQueryRow, 'localIntent' | 'aiIntent'>): TripIntent | null {
  return asIntent(row.aiIntent) ?? asIntent(row.localIntent);
}

export function flagsOf(row: DovedeQueryRow): DovedeLogFlag[] {
  const flags: DovedeLogFlag[] = [];
  if (row.status !== 'ok') flags.push('fail');
  if (row.agree === false) flags.push('disagree');
  const intent = finalIntent(row);
  if (intent) {
    if (intent.unknown.length > 0) flags.push('unknown');
    // «куди їде №5» місць не потребує
    const needsPlaces = intent.intent === 'trip' || intent.intent === 'schedule' || intent.intent === 'price';
    if (needsPlaces && (!intent.from || !intent.to)) flags.push('no_place');
    if (intent.intent === 'other') flags.push('other');
  }
  return flags;
}

export function toLogItem(row: DovedeQueryRow): DovedeLogItem {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    text: row.text,
    status: row.status,
    aiCalled: row.aiCalled,
    agree: row.agree,
    latencyMs: row.latencyMs,
    model: row.model,
    promptVersion: row.promptVersion,
    error: row.error,
    local: asIntent(row.localIntent),
    ai: asIntent(row.aiIntent),
    flags: flagsOf(row),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function summarizeQueries(rows: DovedeQueryRow[], topN = 30): DovedeLogSummary {
  const byStatus = new Map<string, number>();
  const unknown = new Map<string, { word: string; count: number; example: string }>();
  const latencies: number[] = [];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let aiCalls = 0;
  let aiOk = 0;
  let agreed = 0;
  let disagreed = 0;
  let withUnknown = 0;
  let noPlace = 0;
  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    if (row.aiCalled) {
      aiCalls++;
      if (row.status === 'ok') {
        aiOk++;
        if (row.latencyMs != null) latencies.push(row.latencyMs);
      }
    }
    tokens.input += row.inputTokens ?? 0;
    tokens.output += row.outputTokens ?? 0;
    tokens.cacheRead += row.cacheReadTokens ?? 0;
    tokens.cacheWrite += row.cacheWriteTokens ?? 0;
    if (row.agree === true) agreed++;
    if (row.agree === false) disagreed++;
    const flags = flagsOf(row);
    if (flags.includes('unknown')) withUnknown++;
    if (flags.includes('no_place')) noPlace++;
    for (const raw of finalIntent(row)?.unknown ?? []) {
      const word = typeof raw === 'string' ? raw.trim() : '';
      if (!word) continue;
      const key = word.toLowerCase();
      const hit = unknown.get(key);
      if (hit) hit.count++;
      else unknown.set(key, { word, count: 1, example: row.text });
    }
  }
  return {
    total: rows.length,
    aiCalls,
    aiOk,
    aiFailed: aiCalls - aiOk,
    agreed,
    disagreed,
    withUnknown,
    noPlace,
    medianLatencyMs: median(latencies),
    tokens,
    byStatus: [...byStatus].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    topUnknown: [...unknown.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'uk')).slice(0, topN),
  };
}

export function parseLogDays(raw: unknown): DovedeLogDays {
  const n = Number(raw);
  return (DOVEDE_LOG_DAYS as readonly number[]).includes(n) ? (n as DovedeLogDays) : 7;
}
