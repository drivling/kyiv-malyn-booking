/**
 * Backend address for build-time scripts (prerender-*, seo-smoke).
 *
 * Hard-coded on purpose (owner's decision, 2026-09-10): the build must not depend on which
 * env vars a CI runner happens to have. `PRERENDER_API_URL` exists only for local experiments.
 *
 * How to call it (verified 2026-09-10, see Docs/seo-aeo-plan-2026-09.md "Правило API"):
 *   - https only  (http → 301)
 *   - routes live at the root: /health, /schedules/:route, /transport/dataset — there is NO /api prefix
 *   - https://malin.kiev.ua/api is NOT a proxy to the backend; it returns the SPA shell (HTML)
 *
 * When prerender starts failing with "API is not answering", first check whether the backend
 * moved (planned: a dedicated API domain) and update API_BASE here.
 */
export const API_BASE = (process.env.PRERENDER_API_URL || 'https://kyiv-malyn-booking-production.up.railway.app').replace(/\/$/, '');

/** Fail fast with an actionable message when the backend is unreachable or not JSON. */
export async function assertApiAlive(label = 'prerender') {
  const url = `${API_BASE}/health`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (err) {
    throw new Error(`${label}: API is not answering at ${url} (${err?.message || err}). Did the backend move? Update frontend/scripts/api-base.mjs.`);
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) {
    throw new Error(
      `${label}: ${url} → HTTP ${res.status} ${type || '(no content-type)'}; expected JSON {"status":"ok"}. ` +
        'Did the backend move or is this the SPA shell? Update frontend/scripts/api-base.mjs.'
    );
  }
  const body = await res.json().catch(() => null);
  if (body?.status !== 'ok') throw new Error(`${label}: ${url} returned ${JSON.stringify(body)}; expected status "ok".`);
  return body;
}
