import type { GpsRunSpan } from '@/types';

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
