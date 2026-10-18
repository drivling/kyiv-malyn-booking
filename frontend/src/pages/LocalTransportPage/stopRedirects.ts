/**
 * Редиректи зупинок (Docs/transport-open-protocols-2026-10.md, фаза 3): злита чи видалена зупинка лишає запис
 * «старий id → чинний» у `meta.stopRedirects` датасету. Табло `/transport/stop/<старий>` веде на чинну; те саме
 * правило — у пререндері (`stop-redirects.json`) і в serve-dist (301). Дзеркало backend/src/stop-redirects.ts.
 */
const STOP_ID_RE = /^st_\d{1,8}$/;
const MAX_CHAIN = 8;

/** Чинна зупинка, на яку веде старий id, або null (невідомий id, жива зупинка, сміття в меті). */
export function stopRedirectTarget(meta: Record<string, unknown> | null | undefined, stopId: string, liveStopIds: Iterable<string>): string | null {
  const raw = meta?.stopRedirects;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = raw as Record<string, unknown>;
  const live = new Set(liveStopIds);
  if (!STOP_ID_RE.test(stopId) || live.has(stopId)) return null;
  let current = entries[stopId];
  const seen = new Set([stopId]);
  for (let i = 0; i < MAX_CHAIN; i++) {
    if (typeof current !== 'string') return null;
    const next = current.trim();
    if (live.has(next)) return next;
    if (seen.has(next) || !(next in entries)) return null;
    seen.add(next);
    current = entries[next];
  }
  return null;
}

/** Уся мапа лише з коректними парами — для знімка `stop-redirects.json` і тестів. */
export function sanitizeStopRedirects(meta: Record<string, unknown> | null | undefined, liveStopIds: Iterable<string>): Record<string, string> {
  const raw = meta?.stopRedirects;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const live = [...liveStopIds];
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const target = stopRedirectTarget(meta, key, live);
    if (target) out[key] = target;
  }
  return out;
}
