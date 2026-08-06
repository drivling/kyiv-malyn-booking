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

function buildStopHtml(shell, stopId, name, routeIds) {
  const canonical = `https://malin.kiev.ua/transport/stop/${encodeURIComponent(stopId)}`;
  const title = `Зупинка «${name}» — розклад маршруток Малина | malin.kiev.ua`;
  const description = `Табло зупинки «${name}» у Малині: маршрути ${routeIds.map((r) => `№${r}`).join(', ') || 'міського транспорту'}. Актуальний розклад на malin.kiev.ua.`;
  const faq = [
    {
      q: `Які маршрутки зупиняються на «${name}»?`,
      a: routeIds.length
        ? `На зупинці «${name}» курсують маршрути: ${routeIds.map((r) => `№${r}`).join(', ')}. Повний розклад відправлень — на сторінці табло.`
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

  const routesHtml = routeIds.length
    ? `<ul>${routeIds
        .map(
          (r) =>
            `<li><a href="/transport/route/${encodeURIComponent(r)}">Маршрут №${escapeHtml(r)}</a></li>`
        )
        .join('')}</ul>`
    : '<p>Маршрути підвантажаться в додатку.</p>';

  const body = `
<div id="root">
  <main style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#054752">
    <p><a href="/transport">Транспорт Малина</a> / <a href="/transport/stop">Табло</a> / ${escapeHtml(name)}</p>
    <h1>Зупинка «${escapeHtml(name)}» — розклад</h1>
    <p>${escapeHtml(description)}</p>
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
  const stopIds = [...stopToRoutes.keys()].sort();

  for (const id of stopIds) {
    const name = catalog[id]?.name || id;
    const routes = [...(stopToRoutes.get(id) || [])].sort(compareRouteId);
    const html = buildStopHtml(shell, id, name, routes);
    const outDir = path.join(distDir, 'transport', 'stop', id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  }
  console.log(`prerender-transport-stops: wrote ${stopIds.length} stop pages`);
  patchSitemap(stopIds, routeIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
