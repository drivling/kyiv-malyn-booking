/**
 * Post-build: prerender /transport/stop/{id} + append stops/routes to sitemap.
 * Data: backend dataset (scripts/api-base.mjs), else local runtime JSON.
 *
 * PRERENDER_SITE=<key> (site-hosts.mjs; фаза 10б) — сайт іншого міста: датасет `?city=<cityCode>` з публічного API, сторінки
 * в дерево dist/sites/<key>/ (serve-dist віддає його на домені міста), тексти й адреси — того міста, свій sitemap.xml
 * у дереві (його читають prerender-spa і seo-smoke; домен міста sitemap не віддає, поки noindex). Поки транспорт міста
 * вимкнено, API відповідає 404 — дерева не пишемо, це не помилка. Без змінної — Малин, як і раніше.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE } from './api-base.mjs';
import { PUBLISHER_ORG, setCanonical, setOg, stripRobots } from './html-head.mjs';
import { OG_IMAGES, ogImageUrl } from './og-images.mjs';
import { publishableRouteIds } from './prerender-spa.mjs';
import { relatedPagesForStop } from './stop-related-pages.mjs';
import { copyCityOfSite, MALYN_COPY_CITY, stopArticleDescription, stopFallbackDescription, stopHubFaq, stopPageTitle, stopRoutesFaq } from './stop-page-copy.mjs';
import { siteTreeDir } from './serve-dist-rules.mjs';
import { SITES } from './site-hosts.mjs';
import { routeShortNames, stopRoutesFromRouteStops } from './transport-stop-routes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const distDir = path.resolve(__dirname, '../dist');
const indexPath = path.join(distDir, 'index.html');
const localJson = path.join(repoRoot, 'data/malyn-transport/runtime/malyn_transport.json');

const SITE_KEY = process.env.PRERENDER_SITE || 'malyn';
const SITE = SITES[SITE_KEY];
const IS_PRIMARY = Boolean(SITE?.isPrimary);
const ORIGIN = SITE ? `https://${SITE.domain}` : '';
const COPY_CITY = IS_PRIMARY || !SITE ? MALYN_COPY_CITY : copyCityOfSite(SITE);
/** Куди пишемо: Малин — корінь dist, інше місто — його дерево */
const outRoot = IS_PRIMARY ? distDir : path.join(distDir, siteTreeDir(SITE_KEY));
const STOP_HUB_FAQ = stopHubFaq(COPY_CITY);


function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectFromLegacyJson(data) {
  const catalog = data?.supplement?.stops?.stops_catalog || {};
  const byRoute = data?.supplement?.stops?.stops_by_route || {};
  const routesMeta = data?.supplement?.routes || {};
  // Ненадійні (приховані) маршрути: supplement.routes[id].unreliable === true
  const hiddenRouteIds = new Set(
    Object.entries(routesMeta)
      .filter(([, m]) => m && m.unreliable === true)
      .map(([id]) => String(id))
  );
  const stopToRoutes = new Map();

  for (const [routeId, arr] of Object.entries(byRoute)) {
    if (!Array.isArray(arr)) continue;
    if (hiddenRouteIds.has(String(routeId))) continue;
    for (const s of arr) {
      let id = null;
      if (s && typeof s === 'object') {
        const ot = Number(s.order_there) || 0;
        const ob = Number(s.order_back) || 0;
        if (ot <= 0 && ob <= 0) continue;
        id = (s.id && String(s.id).trim()) || null;
        if (!id && s.name && catalog) {
          const hit = Object.entries(catalog).find(([, v]) => v?.name === s.name);
          id = hit?.[0] || s.name;
        }
      } else if (typeof s === 'string') {
        const hit = Object.entries(catalog).find(([, v]) => v?.name === s);
        id = hit?.[0] || s;
      }
      if (!id || !String(id).startsWith('st_')) continue;
      if (!stopToRoutes.has(id)) stopToRoutes.set(id, new Set());
      stopToRoutes.get(id).add(String(routeId));
    }
  }

  const routeIds = new Set(
    [...Object.keys(routesMeta), ...Object.keys(byRoute)].filter((id) => !hiddenRouteIds.has(String(id)))
  );

  const allRouteIds = [...new Set([...Object.keys(routesMeta), ...Object.keys(byRoute)].map(String))].sort(compareRouteId);
  const routeNames = routeShortNames(Object.entries(routesMeta).map(([id, m]) => ({ id, shortName: m?.short_name })));
  return { catalog, stopToRoutes, routeIds: [...routeIds].sort(compareRouteId), hiddenRouteIds, allRouteIds, routeNames };
}

function collectFromApiDataset(dataset) {
  const catalog = {};
  for (const s of dataset.stops || []) {
    if (s?.id) catalog[s.id] = { name: s.name || s.id };
  }
  // Ненадійні (приховані) маршрути: TransportRoute.unreliable — не в SEO/sitemap
  const hiddenRouteIds = new Set(
    (dataset.routes || []).filter((r) => r && r.unreliable === true).map((r) => String(r.id))
  );
  // Сторінки — як і раніше; маршрути в чіпах — лише ті, де зупинку не вимкнено (-1 / -1), плюс варіанти шляху
  const stopToRoutes = stopRoutesFromRouteStops(dataset.routeStops, hiddenRouteIds, dataset.routes);
  // Sitemap / route pages: not hidden AND both termini named (rule D1) — same filter as prerender-spa.
  const routeIds = publishableRouteIds(dataset).filter((id) => !hiddenRouteIds.has(id));
  const allRouteIds = [...new Set((dataset.routes || []).map((r) => String(r?.id)).filter(Boolean))].sort(compareRouteId);
  // Номери для показу («11/1») — у чіпах і текстах; адреси лишаються з id
  const routeNames = routeShortNames(dataset.routes);
  return { catalog, stopToRoutes, routeIds, hiddenRouteIds, allRouteIds, routeNames };
}

function compareRouteId(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

/**
 * Знімок датасету для сайту без бекенду (Docs/transport-pwa-2026-10.md): SPA бере його, коли локальної
 * копії ще нема, а API не відповідає; service worker кладе його в precache. Фіксований URL, тому
 * serve-dist віддає його з `no-cache`.
 */
function writeDatasetSnapshot(dataset) {
  fs.mkdirSync(path.join(distDir, 'transport'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'transport', 'dataset.json'), JSON.stringify(dataset), 'utf8');
  if (!dataset.revision) console.warn('prerender-transport-stops: dataset snapshot has no revision (old backend?)');
  console.log(`prerender-transport-stops: wrote transport/dataset.json (revision ${dataset.revision || '—'})`);
}

/**
 * Редиректи зупинок (Docs/transport-open-protocols-2026-10.md, фаза 3): `meta.stopRedirects` → `dist/transport/
 * stop-redirects.json` лише з коректними парами (старий id → жива зупинка; ланцюжки стиснуто) — serve-dist відповідає
 * 301 на `/transport/stop/<старий>`. Те саме правило, що в `src/pages/LocalTransportPage/stopRedirects.ts`.
 */
export function sanitizeStopRedirects(meta, liveStopIds) {
  const raw = meta?.stopRedirects;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const live = new Set(liveStopIds);
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!/^st_\d{1,8}$/.test(key) || live.has(key)) continue;
    let current = raw[key];
    const seen = new Set([key]);
    for (let i = 0; i < 8; i++) {
      if (typeof current !== 'string') break;
      const next = current.trim();
      if (live.has(next)) {
        out[key] = next;
        break;
      }
      if (seen.has(next) || !(next in raw)) break;
      seen.add(next);
      current = raw[next];
    }
  }
  return out;
}

function writeStopRedirects(dataset) {
  const redirects = sanitizeStopRedirects(dataset.meta, (dataset.stops || []).map((s) => s.id));
  fs.mkdirSync(path.join(outRoot, 'transport'), { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'transport', 'stop-redirects.json'), JSON.stringify(redirects), 'utf8');
  const n = Object.keys(redirects).length;
  if (n) console.log(`prerender-transport-stops: wrote transport/stop-redirects.json (${n})`);
}

/**
 * Датасет міста іншого сайту — лише з публічного API (без локального запасного файлу: дерево міста або є з живих
 * даних, або його нема). null — транспорт міста вимкнено (404) чи API не відповідає: дерево не пишемо.
 */
async function loadCityTransportIndex() {
  const url = `${API_BASE}/transport/dataset?city=${encodeURIComponent(SITE.cityCode)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`prerender-transport-stops[${SITE_KEY}]: API ${res.status} — транспорт міста не опубліковано, дерево сайту не пишемо`);
      return null;
    }
    const dataset = await res.json();
    if (!dataset || !Array.isArray(dataset.stops) || !dataset.stops.length) {
      console.log(`prerender-transport-stops[${SITE_KEY}]: порожній датасет — дерево сайту не пишемо`);
      return null;
    }
    console.log(`prerender-transport-stops[${SITE_KEY}]: dataset from API (revision ${dataset.revision || '—'})`);
    writeStopRedirects(dataset);
    return collectFromApiDataset(dataset);
  } catch (err) {
    console.warn(`prerender-transport-stops[${SITE_KEY}]: API fetch failed (${err?.message || err}) — дерево сайту не пишемо`);
    return null;
  }
}

async function loadTransportIndex() {
  if (!IS_PRIMARY) return loadCityTransportIndex();
  try {
    const res = await fetch(`${API_BASE}/transport/dataset`);
    if (res.ok) {
      const dataset = await res.json();
      if (dataset && Array.isArray(dataset.stops)) {
        console.log('prerender-transport-stops: dataset from API');
        writeDatasetSnapshot(dataset);
        writeStopRedirects(dataset);
        return collectFromApiDataset(dataset);
      }
    } else {
      console.warn(`prerender-transport-stops: API ${res.status}, falling back to local JSON`);
    }
  } catch (err) {
    console.warn('prerender-transport-stops: API fetch failed, using local JSON:', err?.message || err);
  }
  if (!fs.existsSync(localJson)) {
    console.warn(`prerender-transport-stops: no API and missing ${localJson} — skip stop prerender`);
    return { catalog: {}, stopToRoutes: new Map(), routeIds: [], hiddenRouteIds: new Set(), routeNames: new Map() };
  }
  const data = JSON.parse(fs.readFileSync(localJson, 'utf8'));
  console.log('prerender-transport-stops: dataset from local JSON');
  return collectFromLegacyJson(data);
}

/** Статті міста іншого сайту — JSON генератора (scripts/city-stop-articles.mjs); маршрути — з датасету */
function loadCityStopArticles() {
  const file = path.resolve(__dirname, `../src/content/stops/${SITE_KEY}-articles.json`);
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const a of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    if (a?.id && a.place) map.set(a.id, { name: a.name || a.id, place: a.place, tips: a.tips || [], coords: null });
  }
  return map;
}

function loadStopArticles() {
  if (!IS_PRIMARY) return loadCityStopArticles();
  const dir = path.resolve(__dirname, '../src/content/stops');
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    if (!/^st_\d+\.ts$/.test(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const id = f.replace(/\.ts$/, '');
    const nameM = text.match(/name:\s*['"]([^'"]+)['"]/);
    const placeM = text.match(/place:\s*`([\s\S]*?)`/) || text.match(/place:\s*['"]([^'"]+)['"]/);
    const leadM = text.match(/lead:\s*`([\s\S]*?)`/) || text.match(/lead:\s*['"]([^'"]+)['"]/);
    const routesM = text.match(/routeIds:\s*\[([^\]]*)\]/);
    const coordsM = text.match(/coords:\s*\[([^\]]+)\]/);
    const routeIds = routesM
      ? routesM[1]
          .split(',')
          .map((s) => s.replace(/['"\s]/g, ''))
          .filter(Boolean)
      : [];
    let coords = null;
    if (coordsM) {
      const parts = coordsM[1].split(',').map((s) => Number(s.trim()));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        coords = [parts[0], parts[1]];
      }
    }
    const name = nameM?.[1] || id;
    const place = placeM?.[1]?.replace(/\s+/g, ' ').trim();
    const lead = leadM?.[1]?.replace(/\s+/g, ' ').trim();
    if (place || lead) {
      map.set(id, { name, place, lead, routeIds, coords });
    }
  }
  return map;
}

/**
 * Кольори й порядок ліній зі згенерованої легенди схеми (src/pages/LocalTransportPage/scheme/
 * malyn-scheme-routes.ts). Файл — TypeScript, тому читаємо його текстом, як статті зупинок у
 * loadStopArticles: у кожному обʼєкті легенди "id" іде перед "color", а за ним — "fg" (колір номера
 * на плашці кольору лінії: білий або чорний, що контрастніше).
 */
function loadSchemeLegend() {
  const file = path.resolve(__dirname, `../src/pages/LocalTransportPage/scheme/${SITE_KEY}-scheme-routes.ts`);
  const legend = new Map();
  if (!fs.existsSync(file)) return legend;
  const src = fs.readFileSync(file, 'utf8');
  const re = /"id":\s*"([^"]+)"[\s\S]*?"color":\s*"(#[0-9a-fA-F]{6})"(?:,\s*"fg":\s*"(#[0-9a-fA-F]{6})")?/g;
  let m;
  while ((m = re.exec(src))) legend.set(m[1], { color: m[2], fg: m[3] || '#ffffff', order: legend.size });
  return legend;
}

/** Порядок чіпів ліній — як на табло: спершу лінії схеми в порядку легенди, далі числовий */
function compareLineId(a, b, legend) {
  const oa = legend.get(String(a))?.order ?? 999;
  const ob = legend.get(String(b))?.order ?? 999;
  return oa - ob || compareRouteId(a, b);
}

/**
 * Чіпи «№N» у кольорах ліній схеми (без кольору — контурний чіп), посилання на сторінку маршруту.
 * N — номер для показу (`no(id)`: «11/1»), адреса — з id.
 */
function lineChipsHtml(routeIds, legend, no = (id) => String(id)) {
  const chip = 'display:inline-block;margin:0 6px 6px 0;padding:3px 12px;border:2px solid;border-radius:999px;font-weight:700;text-decoration:none';
  return [...routeIds]
    .sort((a, b) => compareLineId(a, b, legend))
    .map((r) => {
      const line = legend.get(String(r));
      const paint = line
        ? `background:${line.color};color:${line.fg};border-color:${line.color}`
        : 'background:#fff;color:#054752;border-color:#dde3e6';
      return `<a href="/transport/route/${encodeURIComponent(r)}" style="${chip};${paint}">№${escapeHtml(no(r))}</a>`;
    })
    .join('');
}

function buildStopHtml(shell, stopId, name, routeIds, article, hiddenRouteIds = new Set(), legend = new Map(), routeNames = new Map()) {
  const no = (id) => routeNames.get(String(id)) || String(id);
  const canonical = `${ORIGIN}/transport/stop/${encodeURIComponent(stopId)}`;
  const title = stopPageTitle(name, COPY_CITY);
  // Статичні статті теж не згадують приховані маршрути; стаття без свого списку (інше місто) — маршрути з датасету
  const articleRoutes = (article?.routeIds ?? routeIds ?? []).filter((r) => !hiddenRouteIds.has(String(r)));
  const effectiveRoutes = (articleRoutes.length ? articleRoutes : routeIds) || [];
  const description =
    (article ? stopArticleDescription({ ...article, routeIds: articleRoutes.map(no) }, COPY_CITY) : '') ||
    stopFallbackDescription(name, effectiveRoutes.map(no), COPY_CITY);
  // Ті самі питання й відповіді, що на SPA-табло (stop-page-copy.mjs)
  const faq = [stopRoutesFaq(name, effectiveRoutes.map(no), stopId, COPY_CITY), STOP_HUB_FAQ[1]];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: `Транспорт ${COPY_CITY.genitive}`, item: `${ORIGIN}/transport` },
          { '@type': 'ListItem', position: 2, name: name, item: canonical },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
        publisher: PUBLISHER_ORG,
      },
    ],
  };

  // Чіпи ліній під заголовком — як .lt-line-chips на табло
  const routesHtml = effectiveRoutes.length
    ? `<p>${lineChipsHtml(effectiveRoutes, legend, no)}</p>`
    : '<p>Через цю зупинку наразі не проходить жоден активний маршрут.</p>';

  // Пов'язані сторінки (зупинка «Автостанція» → сторінка автостанції) — та сама мапа, що в SPA
  const relatedHtml = (IS_PRIMARY ? relatedPagesForStop(stopId) : [])
    .map((l) => `<p><a href="${escapeHtml(l.to)}">${escapeHtml(l.label)}</a></p>`)
    .join('');

  let articleHtml = '';
  if (article?.place) {
    const coordsHtml = article.coords
      ? `<p>Координати: <code>${article.coords[0].toFixed(5)}, ${article.coords[1].toFixed(5)}</code>
         · <a href="https://www.openstreetmap.org/?mlat=${article.coords[0]}&amp;mlon=${article.coords[1]}#map=17/${article.coords[0]}/${article.coords[1]}">на карті</a></p>`
      : '';
    const routesLine = articleRoutes.length ? `<p>Маршрути: ${lineChipsHtml(articleRoutes, legend, no)}</p>` : '';
    const tipsHtml = article.tips?.length ? `<ul>${article.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : '';
    articleHtml = `
    <h2>Про зупинку</h2>
    <p>Зупинка <strong>«${escapeHtml(name)}»</strong> у ${COPY_CITY.locative} — ${escapeHtml(article.place)}.</p>
    ${routesLine}
    ${coordsHtml}${tipsHtml}
    ${relatedHtml}
    <p style="font-size:0.75em;border:1px dashed #b7c5c9;padding:6px 9px;border-radius:6px;color:#708c91">
      Розклад — у картках інтерактивного табло (посилання вище). Маршрут до іншої зупинки — у
      <a href="/transport?from=${encodeURIComponent(stopId)}">планері «Звідки → Куди»</a>.
    </p>`;
  } else if (article?.lead) {
    articleHtml = `<h2>Про зупинку</h2><p>${escapeHtml(article.lead)}</p>${relatedHtml}`;
  } else {
    articleHtml = relatedHtml;
  }

  const body = `
<div id="root">
  <main style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#054752">
    <p><a href="/transport">Транспорт ${COPY_CITY.genitive}</a> / <a href="/transport/stop">Табло</a> / ${escapeHtml(name)}</p>
    <h1>Зупинка «${escapeHtml(name)}» — розклад</h1>
    <h2>Маршрути через зупинку</h2>
    ${routesHtml}
    <p>${escapeHtml(description)}</p>
    <p>
      <a href="/transport/stop/${encodeURIComponent(stopId)}">Відкрити інтерактивне табло</a> — наступні відправлення
      ${legend.size ? `· <a href="/transport/scheme?stop=${encodeURIComponent(stopId)}">На схемі міста</a>` : ''}
      · <a href="/transport?from=${encodeURIComponent(stopId)}">Планер Звідки → Куди</a>
    </p>
    ${articleHtml}
    <h2>Часті питання</h2>
    ${faq.map((f) => `<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`).join('\n')}
    <footer style="margin-top:24px;font-size:0.85em;color:#708c91">
      ${footerHtml()}
    </footer>
  </main>
</div>`;

  let html = shell;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(
    /<meta name="description"[^>]*>/i,
    `<meta name="description" content="${escapeHtml(description)}" />`
  );
  html = setCanonical(stripRobots(html), canonical);
  html = html.replace(
    /<meta property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(title)}" />`
  );
  html = html.replace(
    /<meta property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(description)}" />`
  );
  html = setOg(html, 'og:url', canonical);
  // Картка посилання — транспортна, як у SPA (usePageSeo), а не загальна з index.html
  html = setOg(html, 'og:image', ogImageUrl(OG_IMAGES.transport));
  html = setOg(html, 'og:image:alt', escapeHtml(OG_IMAGES.transport.alt));
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  );
  html = html.replace(/<div id="root"><\/div>/i, body);
  return html;
}

/** Підвал статичної сторінки: Малин — data.gov.ua і телефон, інше місто — джерела даних з мапи сайтів */
function footerHtml() {
  if (IS_PRIMARY) {
    return '<a href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36">data.gov.ua</a> · <a href="tel:+380687771590">(068) 77-71-590</a>';
  }
  return (SITE.transportSources || []).map((src) => `<a href="${escapeHtml(src.href)}">${escapeHtml(src.label)}</a>`).join(' · ');
}

/** Sitemap дерева сайту іншого міста: хаб, схема (якщо намальована), маршрути й зупинки — для prerender-spa і seo-smoke */
function writeCitySitemap(stopIds, routeIds, hasScheme) {
  const today = new Date().toISOString().slice(0, 10);
  const loc = (p) => `  <url><loc>${ORIGIN}${p}</loc><lastmod>${today}</lastmod></url>`;
  const paths = ['/transport', ...(hasScheme ? ['/transport/scheme'] : [])]
    .concat(routeIds.map((id) => `/transport/route/${encodeURIComponent(id)}`))
    .concat(stopIds.map((id) => `/transport/stop/${encodeURIComponent(id)}`));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(loc).join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(outRoot, 'sitemap.xml'), xml, 'utf8');
  console.log(`prerender-transport-stops[${SITE_KEY}]: sitemap.xml у дереві — ${paths.length} адрес`);
}

function patchSitemap(stopIds, routeIds) {
  const sitemapPath = path.join(distDir, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    console.warn('prerender-transport-stops: dist/sitemap.xml missing, skip');
    return;
  }
  let xml = fs.readFileSync(sitemapPath, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const extra = [];
  for (const id of routeIds) {
    extra.push(`    <url>
        <loc>https://malin.kiev.ua/transport/route/${encodeURIComponent(id)}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.75</priority>
    </url>`);
  }
  for (const id of stopIds) {
    extra.push(`    <url>
        <loc>https://malin.kiev.ua/transport/stop/${encodeURIComponent(id)}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.7</priority>
    </url>`);
  }
  if (!extra.length) return;
  if (xml.includes('/transport/stop/st_')) {
    console.log('prerender-transport-stops: sitemap already has stop URLs, skip patch');
    return;
  }
  xml = xml.replace(
    '</urlset>',
    `    <!-- Міські маршрути та зупинки (генерується на build) -->\n${extra.join('\n')}\n</urlset>`
  );
  fs.writeFileSync(sitemapPath, xml, 'utf8');
  console.log(`prerender-transport-stops: sitemap +${routeIds.length} routes, +${stopIds.length} stops`);
}

async function main() {
  if (!fs.existsSync(indexPath)) {
    console.error('prerender-transport-stops: dist/index.html missing');
    process.exit(1);
  }
  if (!SITE) {
    console.error(`prerender-transport-stops: невідомий PRERENDER_SITE=${SITE_KEY}`);
    process.exit(1);
  }
  const shell = fs.readFileSync(indexPath, 'utf8');
  const index = await loadTransportIndex();
  if (!index) return;
  const { catalog, stopToRoutes, routeIds, hiddenRouteIds, allRouteIds = [], routeNames = new Map() } = index;
  // serve-dist 410s /transport/route/{id} for ids missing here (plan 1.5); empty list = rule off
  fs.mkdirSync(path.join(outRoot, 'transport'), { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'transport', 'routes.json'), JSON.stringify(allRouteIds), 'utf8');
  const articles = loadStopArticles();
  const legend = loadSchemeLegend();
  const stopIds = [...stopToRoutes.keys()].sort();
  if (hiddenRouteIds.size) {
    console.log(`prerender-transport-stops: hidden (unreliable) routes skipped: ${[...hiddenRouteIds].join(', ')}`);
  }

  for (const id of stopIds) {
    const name = articles.get(id)?.name || catalog[id]?.name || id;
    const routes = [...(stopToRoutes.get(id) || [])].sort(compareRouteId);
    const html = buildStopHtml(shell, id, name, routes, articles.get(id), hiddenRouteIds, legend, routeNames);
    const outDir = path.join(outRoot, 'transport', 'stop', id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  }
  console.log(`prerender-transport-stops: wrote ${stopIds.length} stop pages (${articles.size} with articles, ${legend.size} scheme colours)`);
  if (IS_PRIMARY) patchSitemap(stopIds, routeIds);
  else writeCitySitemap(stopIds, routeIds, legend.size > 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
