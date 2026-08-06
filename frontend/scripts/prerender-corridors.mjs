/**
 * Post-build prerender for corridor SEO pages.
 * Writes dist/mizhgorodski/{slug}/index.html with schedule tables so crawlers
 * see timetable HTML without waiting for SPA JS.
 *
 * Env: PRERENDER_API_URL or VITE_API_URL (default https://malin.kiev.ua/api)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const indexPath = path.join(distDir, 'index.html');

const API_BASE = (
  process.env.PRERENDER_API_URL ||
  process.env.VITE_API_URL ||
  'https://malin.kiev.ua/api'
).replace(/\/$/, '');

const CORRIDORS = [
  {
    slug: 'kyiv-malyn',
    from: 'Kyiv',
    to: 'Malyn',
    fromLabel: 'Київ',
    toLabel: 'Малин',
    routes: ['Kyiv-Malyn-Irpin', 'Kyiv-Malyn-Bucha'],
    h1: 'Попутка та маршрутка Київ — Малин',
    description:
      'Як доїхати з Києва до Малина: попутки та маршрутки. Живий розклад і бронювання на malin.kiev.ua.',
  },
  {
    slug: 'malyn-kyiv',
    from: 'Malyn',
    to: 'Kyiv',
    fromLabel: 'Малин',
    toLabel: 'Київ',
    routes: ['Malyn-Kyiv-Irpin', 'Malyn-Kyiv-Bucha'],
    h1: 'Попутка та маршрутка Малин — Київ',
    description:
      'Маршрутка й попутка Малин — Київ: актуальний розклад і бронювання на malin.kiev.ua.',
  },
  {
    slug: 'zhytomyr-malyn',
    from: 'Zhytomyr',
    to: 'Malyn',
    fromLabel: 'Житомир',
    toLabel: 'Малин',
    routes: ['Zhytomyr-Malyn'],
    h1: 'Попутка та маршрутка Житомир — Малин',
    description:
      'Як доїхати з Житомира до Малина: попутки та маршрутки. Розклад на malin.kiev.ua.',
  },
  {
    slug: 'malyn-zhytomyr',
    from: 'Malyn',
    to: 'Zhytomyr',
    fromLabel: 'Малин',
    toLabel: 'Житомир',
    routes: ['Malyn-Zhytomyr'],
    h1: 'Попутка та маршрутка Малин — Житомир',
    description:
      'Маршрутка й попутка Малин — Житомир: розклад і бронювання на malin.kiev.ua.',
  },
  {
    slug: 'korosten-malyn',
    from: 'Korosten',
    to: 'Malyn',
    fromLabel: 'Коростень',
    toLabel: 'Малин',
    routes: ['Korosten-Malyn'],
    h1: 'Попутка та маршрутка Коростень — Малин',
    description:
      'Як доїхати з Коростеня до Малина: попутки та маршрутки на malin.kiev.ua.',
  },
  {
    slug: 'malyn-korosten',
    from: 'Malyn',
    to: 'Korosten',
    fromLabel: 'Малин',
    toLabel: 'Коростень',
    routes: ['Malyn-Korosten'],
    h1: 'Попутка та маршрутка Малин — Коростень',
    description:
      'Маршрутка й попутка Малин — Коростень: розклад на malin.kiev.ua.',
  },
];

const ROUTE_LABELS = {
  'Kyiv-Malyn-Irpin': 'Київ → Малин (через Ірпінь)',
  'Malyn-Kyiv-Irpin': 'Малин → Київ (через Ірпінь)',
  'Kyiv-Malyn-Bucha': 'Київ → Малин (через Бучу)',
  'Malyn-Kyiv-Bucha': 'Малин → Київ (через Бучу)',
  'Malyn-Zhytomyr': 'Малин → Житомир',
  'Zhytomyr-Malyn': 'Житомир → Малин',
  'Korosten-Malyn': 'Коростень → Малин',
  'Malyn-Korosten': 'Малин → Коростень',
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitPhones(phone) {
  if (!phone || !String(phone).trim()) return [];
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length >= 24 && digits.startsWith('38') && digits.length % 12 === 0) {
    const out = [];
    for (let i = 0; i < digits.length; i += 12) out.push(digits.slice(i, i + 12));
    return out;
  }
  let n = digits;
  if (n.startsWith('0')) n = '38' + n;
  return n.length >= 10 ? [n] : [];
}

function formatPhone(digits) {
  if (digits.length === 12 && digits.startsWith('38')) {
    return `+380(${digits.slice(3, 5)})${digits.slice(5)}`;
  }
  return '+' + digits;
}

async function fetchSchedulesForRoutes(routeKeys) {
  const all = [];
  let warned = false;
  for (const route of routeKeys) {
    const urls = [
      `${API_BASE}/schedules/${encodeURIComponent(route)}`,
      `${API_BASE}/schedules?route=${encodeURIComponent(route)}`,
    ];
    let rows = null;
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (!warned) {
            console.warn(`prerender-corridors: ${url} → HTTP ${res.status}`);
            warned = true;
          }
          continue;
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          rows = data;
          break;
        }
      } catch (err) {
        if (!warned) {
          console.warn(`prerender-corridors: fetch failed (${url}):`, err?.message || err);
          warned = true;
        }
      }
    }
    if (Array.isArray(rows)) all.push(...rows);
  }
  return all.sort((a, b) =>
    String(a.departureTime).localeCompare(String(b.departureTime)) ||
    String(a.route).localeCompare(String(b.route))
  );
}

function buildTableRows(schedules) {
  if (!schedules.length) {
    return '<tr><td colspan="3">Розклад підвантажиться в додатку; відкрийте сторінку для бронювання.</td></tr>';
  }
  return schedules
    .map((s) => {
      const label = ROUTE_LABELS[s.route] || s.route;
      const phones = splitPhones(s.supportPhone);
      const phoneHtml = phones.length
        ? phones
            .map((d) => `<a href="tel:${d}">${escapeHtml(formatPhone(d))}</a>`)
            .join(', ')
        : '—';
      return `<tr><td><strong>${escapeHtml(s.departureTime)}</strong></td><td>${escapeHtml(label)}</td><td>${phoneHtml}</td></tr>`;
    })
    .join('\n');
}

function buildPageHtml(shell, corridor, schedules) {
  const canonical = `https://malin.kiev.ua/mizhgorodski/${corridor.slug}`;
  const searchHref = `/mizhgorodski?from=${corridor.from}&to=${corridor.to}&type=bus`;
  const times = schedules.map((s) => s.departureTime).sort();
  const first = times[0];
  const last = times[times.length - 1];
  const desc =
    schedules.length && first && last
      ? `${corridor.description} Розклад: ${schedules.length} рейсів, з ${first} до ${last}.`
      : corridor.description;

  const faq = [];
  if (first && last) {
    faq.push({
      q: `О котрій перша та остання маршрутка ${corridor.fromLabel} — ${corridor.toLabel}?`,
      a: `За розкладом malin.kiev.ua: перший рейс о ${first}, останній о ${last}. Усього ${schedules.length} відправлень.`,
    });
  }
  faq.push({
    q: `Де забронювати маршрутку ${corridor.fromLabel} — ${corridor.toLabel}?`,
    a: 'На malin.kiev.ua/mizhgorodski оберіть міста та дату, або скористайтеся кнопкою нижче.',
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      ...(schedules.length
        ? [
            {
              '@type': 'ItemList',
              name: `Розклад маршруток ${corridor.fromLabel} — ${corridor.toLabel}`,
              numberOfItems: schedules.length,
              itemListElement: schedules.map((s, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: `${s.departureTime} · ${ROUTE_LABELS[s.route] || s.route}`,
              })),
            },
          ]
        : []),
    ],
  };

  const prerenderBody = `
<div id="root">
  <main style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#054752">
    <p><a href="/mizhgorodski">Міжміські</a> / ${escapeHtml(corridor.fromLabel)} — ${escapeHtml(corridor.toLabel)}</p>
    <h1>${escapeHtml(corridor.h1)}</h1>
    <p>${escapeHtml(desc)}</p>
    <p><a href="${escapeHtml(searchHref)}">Шукати / забронювати маршрутку</a></p>
    <h2>Розклад маршруток</h2>
    <p>Фіксований графік з бази бронювання malin.kiev.ua. Змінюється рідко.</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr><th>Відправлення</th><th>Маршрут</th><th>Контакт</th></tr></thead>
      <tbody>
        ${buildTableRows(schedules)}
      </tbody>
    </table>
    <h2>Часті питання</h2>
    ${faq.map((f) => `<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`).join('\n')}
    <p><a href="/support/travel">Як доїхати до Малина</a> · <a href="/transport">Транспорт Малина</a></p>
  </main>
</div>`;

  let html = shell;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(corridor.h1)} | malin.kiev.ua</title>`);
  html = html.replace(
    /<meta name="description"[^>]*>/i,
    `<meta name="description" content="${escapeHtml(desc)}" />`
  );
  html = html.replace(
    /<link rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${canonical}" />`
  );
  html = html.replace(
    /<meta property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(corridor.h1)}" />`
  );
  html = html.replace(
    /<meta property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`
  );
  html = html.replace(
    /<meta property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${canonical}" />`
  );
  // Drop default graph LD; inject corridor LD before </head>
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  );
  html = html.replace(/<div id="root"><\/div>/i, prerenderBody);
  return html;
}

async function main() {
  if (!fs.existsSync(indexPath)) {
    console.error('prerender-corridors: dist/index.html missing — run vite build first');
    process.exit(1);
  }
  const shell = fs.readFileSync(indexPath, 'utf8');
  console.log(`prerender-corridors: API ${API_BASE}`);

  for (const corridor of CORRIDORS) {
    const schedules = await fetchSchedulesForRoutes(corridor.routes);
    const html = buildPageHtml(shell, corridor, schedules);
    const outDir = path.join(distDir, 'mizhgorodski', corridor.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    console.log(`  wrote /mizhgorodski/${corridor.slug}/ (${schedules.length} trips)`);
  }
  console.log('prerender-corridors: done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
