/**
 * Час у дорозі трьома джерелами (Docs/dovede-learning-roadmap.md, аналіз 2026-11-23, пункт 5): наш розклад (сегменти),
 * GPS-треки автобусів (`transport-gps-times.ts`) — головне джерело, і звірка з Google (кампанія «Звірити свій розклад з
 * Google», `dovede/city-check.ts`) — друга думка. На парах звірки (початок → кінець, початок → середина, середина → кінець
 * кожного напрямку — ділянки на кілька кілометрів, де GPS надійний) кажемо, де наш час варто перерахувати. Чистий модуль:
 * нічого не пише; рішення («Перерахувати час») — за власником.
 */
import type { RunTimesReport, RunSpan } from './transport-gps-times';

/** Рядок звірки Google (`CheckRow` у dovede/city-check.ts) — лише те, що тут потрібно */
export interface CheckRowLike {
  from: string;
  to: string;
  verdict: string;
  /** наш маршрут, яким поїхав Google, і його хвилини */
  routeNo?: string;
  googleMin?: number;
  routes: string[];
}

/**
 * - `recalc` — GPS і Google разом кажуть інше, ніж наш розклад: перерахувати;
 * - `gps` — так каже GPS (Google згоден з нами або не поїхав нашою лінією): GPS головний — теж кандидат;
 * - `ok` — GPS підтверджує наш час (хоч би що казав Google);
 * - `google_only` — GPS даних нема, а Google розходиться з нами: перевірити, коли GPS назбирається.
 */
export type TimeVerdict = 'recalc' | 'gps' | 'ok' | 'google_only';

export interface TimeCandidate {
  routeNo: string;
  direction: 'there' | 'back';
  from: string;
  to: string;
  ourMin: number;
  gpsMin: number | null;
  googleMin: number | null;
  verdict: TimeVerdict;
  /** частина відрізків ділянки має мало проїздів GPS */
  weak: boolean;
}

/** «Різне»: більше за 2 хв і за 20 % від меншого */
export function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.max(2, 0.2 * Math.min(a, b));
}

const sameNo = (s: string) => s.toLowerCase().replace(/[-\s]/g, '').replace(/b/g, 'б');
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Відрізки напрямку від зупинки `from` до `to` за назвами (поспіль); null — пари в цьому напрямку нема */
function stretch(spans: RunSpan[], from: string, to: string): RunSpan[] | null {
  const i = spans.findIndex((s) => s.fromName === from);
  if (i < 0) return null;
  for (let j = i; j < spans.length; j++) if (spans[j].toName === to) return spans.slice(i, j + 1);
  return null;
}

export function timeCandidates(report: RunTimesReport, rows: CheckRowLike[]): TimeCandidate[] {
  const out: TimeCandidate[] = [];
  for (const row of rows) {
    // Google мусив поїхати нашою лінією — інакше його хвилини не про наш маршрут
    const nos = row.routeNo ? [row.routeNo] : row.routes;
    const googleMin = row.routeNo && row.googleMin !== undefined ? row.googleMin : null;
    for (const route of report.routes) {
      if (!nos.some((n) => sameNo(n) === sameNo(route.routeNo))) continue;
      for (const d of route.directions) {
        const part = stretch(d.spans, row.from, row.to);
        if (!part) continue;
        const ourMin = round1(part.reduce((n, s) => n + s.ourSec, 0) / 60);
        const gps = part.every((s) => s.gpsSec !== null) ? round1(part.reduce((n, s) => n + (s.gpsSec ?? 0), 0) / 60) : null;
        const weak = part.some((s) => s.confidence !== 'ok');
        let verdict: TimeVerdict;
        if (gps === null) {
          if (googleMin === null || !differs(googleMin, ourMin)) continue;
          verdict = 'google_only';
        } else if (!differs(gps, ourMin)) verdict = 'ok';
        else verdict = googleMin !== null && !differs(googleMin, gps) ? 'recalc' : 'gps';
        out.push({ routeNo: route.routeNo, direction: d.direction, from: row.from, to: row.to, ourMin, gpsMin: gps, googleMin, verdict, weak });
      }
    }
  }
  const rank: Record<TimeVerdict, number> = { recalc: 0, gps: 1, google_only: 2, ok: 3 };
  const gap = (c: TimeCandidate) => Math.abs((c.gpsMin ?? c.googleMin ?? c.ourMin) - c.ourMin);
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || gap(b) - gap(a) || a.routeNo.localeCompare(b.routeNo, 'uk', { numeric: true }));
}
