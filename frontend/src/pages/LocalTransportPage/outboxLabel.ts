/**
 * «1 запис чекає на мережу» / «2 записи чекають…» / «5 записів чекають…» — лічильник outbox у смужці стану
 * (src/pwa/outbox.ts, Docs/transport-offline-writes-2026-10.md, фаза 4). Відмінки за українським правилом:
 * 1 (крім 11) — однина, 2–4 (крім 12–14) — «записи», решта — «записів».
 */
export function pendingOutboxLabel(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (last === 1 && tens !== 11) return `${n} запис чекає на мережу`;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return `${n} записи чекають на мережу`;
  return `${n} записів чекають на мережу`;
}
