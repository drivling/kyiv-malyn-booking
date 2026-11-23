import type { GpsRunSpan, GpsTimeCandidate } from '@/types';

/** «3,5 хв»: час відрізка з точністю до пів хвилини не буває — показуємо десяті */
export function minutes(sec: number | null): string {
  if (sec === null) return '—';
  return `${(sec / 60).toFixed(1).replace('.', ',')} хв`;
}

/** «+1,5 хв» / «−0,7 хв»: наскільки автобус їде довше (плюс) чи швидше (мінус), ніж у нас записано */
export function difference(ourSec: number, gpsSec: number | null): string {
  if (gpsSec === null) return '—';
  const d = (gpsSec - ourSec) / 60;
  if (Math.abs(d) < 0.05) return '0';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')} хв`;
}

/** Відрізок, де різниця помітна: щонайменше хвилина і третина нашого часу, і проїздів достатньо */
export function isNotable(span: GpsRunSpan): boolean {
  if (span.gpsSec === null || span.confidence !== 'ok') return false;
  const d = Math.abs(span.gpsSec - span.ourSec);
  return d >= 60 && d >= span.ourSec * 0.3;
}

export const DIRECTION_LABEL: Record<'there' | 'back', string> = { there: 'Туди', back: 'Назад' };

export const CONFIDENCE_LABEL: Record<GpsRunSpan['confidence'], string> = { ok: '', few: 'мало проїздів', none: 'немає даних' };

/** Висновок звірки хвилин трьома джерелами — що робити власнику */
export const TIME_VERDICT_LABEL: Record<GpsTimeCandidate['verdict'], string> = {
  recalc: 'Перерахувати: GPS і Google разом',
  gps: 'Перерахувати за GPS',
  google_only: 'Лише Google — чекати GPS',
  ok: 'GPS підтверджує наш час',
};

/** «14 хв» / «—» */
export function wholeMinutes(value: number | null): string {
  return value === null ? '—' : `${String(Math.round(value * 10) / 10).replace('.', ',')} хв`;
}

/** Кандидати на «Перерахувати час» спершу; «GPS підтверджує» — окремим лічильником */
export function splitCandidates(list: GpsTimeCandidate[]): { todo: GpsTimeCandidate[]; confirmed: number } {
  return { todo: list.filter((c) => c.verdict !== 'ok'), confirmed: list.filter((c) => c.verdict === 'ok').length };
}
