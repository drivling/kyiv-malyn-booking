/**
 * Head helpers shared by the prerender scripts.
 * The SPA shell (index.html) carries `<meta name="robots" content="noindex,follow">` and no
 * canonical (plan item 1.2): only URLs that fall through to the shell — planner, search with
 * query params, admin/user — stay out of the index. Every prerendered page must therefore
 * strip the robots tag and set its own canonical / og:url.
 */
const ROBOTS_RE = /\s*<meta\s+name="robots"[^>]*>/i;

export function stripRobots(html) {
  return html.replace(ROBOTS_RE, '');
}

/** Replace the first tag matching `re`, or insert `tag` before </head> when absent. */
export function upsertHeadTag(html, re, tag) {
  return re.test(html) ? html.replace(re, tag) : html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

export function setCanonical(html, url) {
  return upsertHeadTag(html, /<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${url}" />`);
}

export function setOg(html, property, content) {
  const re = new RegExp(`<meta\\s+property="${property.replace(':', '\\:')}"[^>]*>`, 'i');
  return upsertHeadTag(html, re, `<meta property="${property}" content="${content}" />`);
}
