/**
 * Post-build SEO smoke over dist/: what a crawler without JS receives for every sitemap URL.
 * Runs last in `npm run build`; exits 1 on any error so a broken prerender never deploys.
 *
 *   node scripts/seo-smoke.mjs            # warn on URLs still served by the SPA shell
 *   SEO_SMOKE_STRICT=1 node scripts/…     # (after plan item 1.1) shell-served URLs are errors too
 *   SEO_SMOKE_SITE=korosten …             # дерево сайту іншого міста dist/sites/<key>/ (фаза 10б): його sitemap, його
 *                                         # домен у canonical, жодного Малина; нема дерева — нема чого перевіряти
 *
 * Resolution mirrors scripts/serve-dist.mjs: /foo → dist/foo/index.html or dist/foo, else the shell.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OG_IMAGES } from './og-images.mjs';
import { analyzeHtml, extractHead, foreignCityLeaks, parseSitemap, urlToPath } from './seo-smoke-lib.mjs';
import { siteTreeDir } from './serve-dist-rules.mjs';
import { SITES } from './site-hosts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDistDir = path.resolve(__dirname, '../dist');
const STRICT = process.env.SEO_SMOKE_STRICT === '1';
const SITE_KEY = process.env.SEO_SMOKE_SITE || 'malyn';
const SITE = SITES[SITE_KEY];
const IS_PRIMARY = Boolean(SITE?.isPrimary);
/** Дерево, яке перевіряємо: Малин — корінь dist, інше місто — dist/sites/<key> (оболонка SPA — спільна) */
const distDir = IS_PRIMARY ? rootDistDir : path.join(rootDistDir, siteTreeDir(SITE_KEY));
const ORIGIN = SITE ? `https://${SITE.domain}` : undefined;

function resolveDistFile(urlPath) {
  const base = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!base.startsWith(distDir)) return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  const idx = path.join(base, 'index.html');
  if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
  return null;
}

function main() {
  if (!SITE) {
    console.error(`seo-smoke: невідомий SEO_SMOKE_SITE=${SITE_KEY}`);
    process.exit(1);
  }
  const sitemapPath = path.join(distDir, 'sitemap.xml');
  const shellPath = path.join(rootDistDir, 'index.html');
  if (!IS_PRIMARY && !fs.existsSync(sitemapPath)) {
    console.log(`seo-smoke[${SITE_KEY}]: дерева сайту нема (транспорт міста не опубліковано) — пропускаю`);
    return;
  }
  if (!fs.existsSync(sitemapPath) || !fs.existsSync(shellPath)) {
    console.error('seo-smoke: dist/sitemap.xml or dist/index.html missing — run the build first');
    process.exit(1);
  }
  const shellTitle = extractHead(fs.readFileSync(shellPath, 'utf8')).title;
  const urls = parseSitemap(fs.readFileSync(sitemapPath, 'utf8'));

  let prerendered = 0;
  const shellServed = [];
  const failures = [];
  let warningCount = 0;

  for (const url of urls) {
    const urlPath = urlToPath(url);
    const file = resolveDistFile(urlPath);
    if (!file || path.resolve(file) === shellPath) {
      shellServed.push(urlPath);
      continue;
    }
    prerendered += 1;
    const html = fs.readFileSync(file, 'utf8');
    const { errors, warnings } = analyzeHtml(html, { url, shellTitle, origin: ORIGIN });
    if (!IS_PRIMARY) errors.push(...foreignCityLeaks(html));
    if (new URL(url).origin !== ORIGIN) errors.push(`адреса ${url} не з домену ${ORIGIN}`);
    for (const w of warnings) {
      warningCount += 1;
      console.warn(`  warn  ${urlPath}: ${w}`);
    }
    if (errors.length) failures.push({ urlPath, errors });
  }

  // Картки посилань і favicon, на які посилаються сторінки, мусять бути в білді (PNG закомічені в public/)
  for (const file of [...Object.values(OG_IMAGES).map((i) => i.path), '/favicon.ico']) {
    if (!fs.existsSync(path.join(rootDistDir, file))) failures.push({ urlPath: file, errors: ['missing in dist — run npm run pwa:icons and commit public/'] });
  }

  for (const f of failures) for (const e of f.errors) console.error(`  ERROR ${f.urlPath}: ${e}`);

  const shellNote = shellServed.length
    ? `${shellServed.length} served by SPA shell${STRICT ? ' (STRICT → errors)' : ' (warn; plan 1.1 makes these errors)'}`
    : 'all prerendered';
  console.log(
    `seo-smoke${IS_PRIMARY ? '' : `[${SITE_KEY}]`}: ${urls.length} sitemap URLs — ${prerendered} prerendered, ${shellNote}; ` +
      `${failures.length} failing, ${warningCount} warnings`
  );
  if (shellServed.length && (STRICT || shellServed.length <= 40)) {
    for (const p of shellServed) console.log(`  shell ${p}`);
  }

  if (failures.length || (STRICT && shellServed.length)) process.exit(1);
}

main();
