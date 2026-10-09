/**
 * Pure checks for the post-build SEO smoke (scripts/seo-smoke.mjs).
 * Kept dependency-free so vitest can import it without a DOM.
 *
 * Rules (Docs/seo-aeo-plan-2026-09.md 1.8, review §10):
 *  - every sitemap URL that is prerendered has its own <title>, one <h1>, a canonical equal to itself
 *  - no "? — ?" placeholders (D1), no raw route slugs like "Kyiv-Malyn" in visible text (D8)
 *  - no "will load in the app" fallback copy (D10)
 *  - JSON-LD present
 */

export const SITE_ORIGIN = 'https://malin.kiev.ua';

const POINT_CODES = 'Kyiv|Malyn|Zhytomyr|Korosten|Irpin|Bucha';
export const RAW_SLUG_RE = new RegExp(`\\b(?:${POINT_CODES})-(?:${POINT_CODES})(?:-(?:${POINT_CODES}))?\\b`);
export const PLACEHOLDER_RE = /\?\s*—\s*\?|(^|\s)\?(\s|$)/;
export const FALLBACK_RE = /підвантаж|загружа[ею]тся|will load/i;

/** @returns {string[]} absolute URLs listed in a sitemap */
export function parseSitemap(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

export function urlToPath(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Visible text: drops <head>, scripts, styles and all tags. */
export function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<head[\s\S]*?<\/head>/i, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractHead(html) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim() ?? null;
  const canonicalTag = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? null;
  const canonical = canonicalTag ? attr(canonicalTag, 'href') : null;
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim());
  const jsonLdCount = (html.match(/<script[^>]+type=["']application\/ld\+json["']/gi) || []).length;
  return { title, canonical, h1s, jsonLdCount };
}

/**
 * @param {string} html            page HTML
 * @param {{url: string, shellTitle: string|null}} ctx
 * @returns {{errors: string[], warnings: string[]}}
 */
export function analyzeHtml(html, { url, shellTitle }) {
  const errors = [];
  const warnings = [];
  const { title, canonical, h1s, jsonLdCount } = extractHead(html);
  const expectedCanonical = `${SITE_ORIGIN}${urlToPath(url)}`;

  const text = visibleText(html);
  if (!title) errors.push('no <title>');
  else if (shellTitle && title === shellTitle && text.length < 300) {
    // The home page legitimately shares the shell title; an empty body is what betrays a bare shell.
    errors.push(`title equals SPA shell title ("${title}") and the page has no visible content`);
  }

  if (h1s.length === 0) errors.push('no <h1>');
  else if (h1s.length > 1) warnings.push(`${h1s.length} <h1> elements`);

  if (!canonical) errors.push('no canonical');
  else if (canonical.replace(/\/$/, '') !== expectedCanonical.replace(/\/$/, '')) {
    errors.push(`canonical "${canonical}" ≠ "${expectedCanonical}"`);
  }

  for (const [what, value] of [['title', title], ...h1s.map((h) => ['h1', h])]) {
    if (value && PLACEHOLDER_RE.test(value)) errors.push(`placeholder "?" in ${what}: "${value}"`);
  }

  const rawSlug = text.match(RAW_SLUG_RE);
  if (rawSlug) errors.push(`raw route slug "${rawSlug[0]}" in visible text (D8)`);
  const fallback = text.match(FALLBACK_RE);
  if (fallback) errors.push(`fallback copy "${fallback[0]}" in visible text (D10)`);
  if (PLACEHOLDER_RE.test(text.replace(/\?(?=[&=])/g, ''))) {
    const m = text.match(/.{0,30}\?\s*—\s*\?.{0,30}/);
    if (m) errors.push(`placeholder "? — ?" in text: "…${m[0]}…"`);
  }

  if (jsonLdCount === 0) warnings.push('no JSON-LD');
  if (text.length < 300) warnings.push(`thin page: ${text.length} chars of visible text`);

  return { errors, warnings };
}
