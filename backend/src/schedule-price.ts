/** Default marshrutka fare (UAH) by schedule route string when admin omits priceUah. */
export function defaultSchedulePriceUah(route: string): number | null {
  const r = String(route || '');
  if (r.includes('Kyiv-Malyn') || r.includes('Malyn-Kyiv')) return 280;
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
