/**
 * «Ролик-вступ досмотрено» (Docs/dovede-roadmap.md, «Ролик-вступ»). Хто досмотрив ролик до кінця, більше його не
 * бачить — ні після перезавантаження, ні з посиланням `?q=…`. Новий ролик для всіх (і тих, хто бачив старий) —
 * змінити ключ на `v3` (v1 → v2 — 2026-11-18, ролик ще раз усім перед запуском домену dovede.online); новий файл ролика без зміни ключа повторно не показується. Сховище — ads/seen.ts.
 */
import { isSeen, markSeen } from '@/ads/seen';

export const INTRO_SEEN_KEY = 'dovede-intro:v2';

export function introSeen(): boolean {
  return isSeen(INTRO_SEEN_KEY);
}

/** Ролик досмотрено: спершу localStorage, якщо не вийшло — sessionStorage, далі памʼять вкладки */
export function markIntroSeen(at: Date = new Date()): void {
  markSeen(INTRO_SEEN_KEY, at);
}
