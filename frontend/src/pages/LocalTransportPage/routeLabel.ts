/**
 * Public label of a city route line. Rule D1 (Docs/seo-aeo-review-2026-09.md §10): a route without
 * both terminus names is never rendered as "? — ?" — the number alone is shown instead.
 */
export type RouteLike = { id: string; from?: string | null; to?: string | null };

export function routeLine(r: RouteLike, reverse = false): string {
  const from = (r.from ?? '').trim();
  const to = (r.to ?? '').trim();
  if (!from || !to) return '';
  return reverse ? `${to} — ${from}` : `${from} — ${to}`;
}

/** «№5 Лікарня — Залізничний вокзал» or just «№1» when the line is unnamed. */
export function routeTitle(r: RouteLike): string {
  const line = routeLine(r);
  return line ? `№${r.id} ${line}` : `№${r.id}`;
}

export function hasNamedLine(r: RouteLike): boolean {
  return routeLine(r) !== '';
}
