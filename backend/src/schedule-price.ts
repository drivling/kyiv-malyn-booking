/**
 * Тариф маршрутки Малин ↔ Київ, грн за місце, в обидва боки (перевізник, ІнфоМалин 03.11.2026).
 * З 4 листопада 2026 — 310 (було 280). Міняючи, треба також:
 *  - міграцією оновити Schedule.priceUah (див. 20261104100000_kyiv_malyn_marshrutka_fare_310);
 *  - frontend/src/utils/fares.ts (тексти сайту) і frontend/scripts/data/corridor-schedules.snapshot.json.
 */
export const KYIV_MALYN_MARSHRUTKA_FARE_UAH = 310;

/** Default marshrutka fare (UAH) by schedule route string when admin omits priceUah. */
export function defaultSchedulePriceUah(route: string): number | null {
  const r = String(route || '');
  if (r.includes('Kyiv-Malyn') || r.includes('Malyn-Kyiv')) return KYIV_MALYN_MARSHRUTKA_FARE_UAH;
  // Zhytomyr / Korosten — TBD
  return null;
}

export function parseOptionalPriceUah(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
