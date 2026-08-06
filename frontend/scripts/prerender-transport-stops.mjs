/**
 * Post-build: prerender /transport/stop/{id} + append stops/routes to sitemap.
 * Data: PRERENDER_TRANSPORT_URL / VITE_API_URL dataset, else local runtime JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const distDir = path.resolve(__dirname, '../dist');
const indexPath = path.join(distDir, 'index.html');
const localJson = path.join(repoRoot, 'data/malyn-transport/runtime/malyn_transport.json');

const API_BASE = (
  process.env.PRERENDER_API_URL ||
  process.env.VITE_API_URL ||
  'https://malin.kiev.ua/api'
).replace(/\/$/, '');

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
  const stopToRoutes = new Map();

  for (const [routeId, arr] of Object.entries(byRoute)) {
    if (!Array.isArray(arr)) continue;
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

  const routeIds = new Set([
    ...Object.keys(routesMeta),
    ...Object.keys(byRoute),
  ]);

  return { catalog, stopToRoutes, routeIds: [...routeIds].sort(compareRouteId) };
}

function collectFromApiDataset(dataset) {
  const catalog = {};
  for (const s of dataset.stops || []) {
    if (s?.id) catalog[s.id] = { name: s.name || s.id };
  }
  const stopToRoutes = new Map();
  for (const rs of dataset.routeStops || []) {
    if (!rs?.stopId || !rs?.routeId) continue;
    if (!String(rs.stopId).startsWith('st_')) continue;
    if (!stopToRoutes.has(rs.stopId)) stopToRoutes.set(rs.stopId, new Set());
    stopToRoutes.get(rs.stopId).add(String(rs.routeId));
  }
  const routeIds = [...new Set((dataset.routes || []).map((r) => String(r.id)))].sort(compareRouteId);
  return { catalog, stopToRoutes, routeIds };
}

function compareRouteId(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

async function loadTransportIndex() {
  try {
    const res = await fetch(`${API_BASE}/transport/dataset`);
    if (res.ok) {
      const dataset = await res.json();
      if (dataset && Array.isArray(dataset.stops)) {
        console.log('prerender-transport-stops: dataset from API');
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
    return { catalog: {}, stopToRoutes: new Map(), routeIds: [] };
  }
  const data = JSON.parse(fs.readFileSync(localJson, 'utf8'));
  console.log('prerender-transport-stops: dataset from local JSON');
  return collectFromLegacyJson(data);
}

function loadStopArticles() {
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
    let description = lead || '';
    if (place) {
      const routes = routeIds.length ? ` Маршрути: ${routeIds.map((r) => `№${r}`).join(', ')}.` : '';
      description = `Зупинка «${name}» у Малині — ${place}.${routes}`;
    }
    if (description || place) {
      map.set(id, { name, place, lead, routeIds, coords, description });
    }
  }
  return map;
}

function buildStopHtml(shell, stopId, name, routeIds, article) {
  const canonical = `https://malin.kiev.ua/transport/stop/${encodeURIComponent(stopId)}`;
  const title = `Зупинка «${name}» — розклад маршруток Малина | malin.kiev.ua`;
  const effectiveRoutes = (article?.routeIds?.length ? article.routeIds : routeIds) || [];
  const description =
    article?.description ||
    article?.lead ||
    `Табло зупинки «${name}» у Малині: маршрути ${effectiveRoutes.map((r) => `№${r}`).join(', ') || 'міського транспорту'}. Актуальний розклад на malin.kiev.ua.`;
  const faq = [
    {
      q: `Які маршрутки зупиняються на «${name}»?`,
      a: effectiveRoutes.length
        ? `На зупинці «${name}» курсують маршрути: ${effectiveRoutes.map((r) => `№${r}`).join(', ')}. Повний розклад відправлень — на сторінці табло.`
        : `Відкрийте табло «${name}» на malin.kiev.ua/transport/stop/${stopId}.`,
    },
    {
      q: 'Як побудувати маршрут від цієї зупинки?',
      a: 'У планері /transport оберіть «З» = ця зупинка і потрібну «До», потім «Знайти».',
    },
  ];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Транспорт Малина', item: 'https://malin.kiev.ua/transport' },
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
      },
    ],
  };

  const routesHtml = effectiveRoutes.length
    ? `<ul>${effectiveRoutes
        .map(
          (r) =>
            `<li><a href="/transport/route/${encodeURIComponent(r)}"><strong>№${escapeHtml(r)}</strong></a></li>`
        )
        .join('')}</ul>`
    : '<p>Маршрути підвантажаться в додатку.</p>';

  let articleHtml = '';
  if (article?.place) {
    const coordsHtml = article.coords
      ? `<p>Координати: <code>${article.coords[0].toFixed(5)}, ${article.coords[1].toFixed(5)}</code>
         · <a href="https://www.openstreetmap.org/?mlat=${article.coords[0]}&amp;mlon=${article.coords[1]}#map=17/${article.coords[0]}/${article.coords[1]}">на карті</a></p>`
      : '';
    const routesLine = article.routeIds?.length
      ? `<p>Маршрути: ${article.routeIds.map((r) => `<a href="/transport/route/${encodeURIComponent(r)}"><strong>№${escapeHtml(r)}</strong></a>`).join(', ')}</p>`
      : '';
    articleHtml = `
    <h2>Про зупинку</h2>
    <p>Зупинка <strong>«${escapeHtml(name)}»</strong> у Малині — ${escapeHtml(article.place)}.</p>
    ${routesLine}
    ${coordsHtml}
    <p style="font-size:0.75em;border:1px dashed #b7c5c9;padding:6px 9px;border-radius:6px;color:#708c91">
      Розклад — у картках на інтерактивному табло. Маршрут до іншої зупинки — у
      <a href="/transport?from=${encodeURIComponent(stopId)}">планері «З → До»</a>.
    </p>`;
  } else if (article?.lead) {
    articleHtml = `<h2>Про зупинку</h2><p>${escapeHtml(article.lead)}</p>`;
  }

  const body = `
<div id="root">
  <main style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#054752">
    <p><a href="/transport">Транспорт Малина</a> / <a href="/transport/stop">Табло</a> / ${escapeHtml(name)}</p>
    <h1>Зупинка «${escapeHtml(name)}» — розклад</h1>
    <p>${escapeHtml(description)}</p>
    ${articleHtml}
    <p><a href="/transport/stop/${encodeURIComponent(stopId)}">Відкрити інтерактивне табло</a> · <a href="/transport">Планер З → До</a></p>
    <h2>Маршрути через зупинку</h2>
    ${routesHtml}
    <h2>Часті питання</h2>
    ${faq.map((f) => `<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`).join('\n')}
  </main>
</div>`;

  let html = shell;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(
    /<meta name="description"[^>]*>/i,
    `<meta name="description" content="${escapeHtml(description)}" />`
  );
  html = html.replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${canonical}" />`);
  html = html.replace(
    /<meta property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(title)}" />`
  );
  html = html.replace(
    /<meta property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(description)}" />`
  );
  html = html.replace(
    /<meta property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${canonical}" />`
  );
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  );
  html = html.replace(/<div id="root"><\/div>/i, body);
  return html;
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
  const shell = fs.readFileSync(indexPath, 'utf8');
  const { catalog, stopToRoutes, routeIds } = await loadTransportIndex();
  const articles = loadStopArticles();
  const stopIds = [...stopToRoutes.keys()].sort();

  for (const id of stopIds) {
    const name = articles.get(id)?.name || catalog[id]?.name || id;
    const routes = [...(stopToRoutes.get(id) || [])].sort(compareRouteId);
    const html = buildStopHtml(shell, id, name, routes, articles.get(id));
    const outDir = path.join(distDir, 'transport', 'stop', id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  }
  console.log(`prerender-transport-stops: wrote ${stopIds.length} stop pages (${articles.size} with articles)`);
  patchSitemap(stopIds, routeIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
