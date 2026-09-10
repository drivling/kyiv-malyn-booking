/**
 * Post-build prerender for corridor SEO pages.
 * Writes dist/mizhgorodski/{slug}/index.html with schedule tables so crawlers
 * see timetable HTML without waiting for SPA JS.
 *
 * Backend address: scripts/api-base.mjs (hard-coded; PRERENDER_API_URL only for experiments).
 *
 * Data-quality rule D10 (Docs/seo-aeo-review-2026-09.md §10): a corridor page is never
 * shipped with an empty or placeholder timetable. Order of truth:
 *   1. live API (fresh rows) → also refreshes scripts/data/corridor-schedules.snapshot.json
 *   2. committed snapshot (last successful fetch) → page marked with the snapshot date
 *   3. neither → build fails (PRERENDER_ALLOW_EMPTY=1 downgrades to a warning for local dev)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE, assertApiAlive } from './api-base.mjs';
import { setCanonical, setOg, stripRobots } from './html-head.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const indexPath = path.join(distDir, 'index.html');


const SNAPSHOT_PATH = path.resolve(__dirname, 'data/corridor-schedules.snapshot.json');
const ALLOW_EMPTY = process.env.PRERENDER_ALLOW_EMPTY === '1';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return { fetchedAt: null, routes: {} };
  try {
    const data = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    return { fetchedAt: data?.fetchedAt || null, routes: data?.routes || {} };
  } catch (err) {
    console.warn('prerender-corridors: snapshot unreadable, ignoring:', err?.message || err);
    return { fetchedAt: null, routes: {} };
  }
}

function saveSnapshot(snapshot) {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  const routes = {};
  for (const key of Object.keys(snapshot.routes).sort()) routes[key] = snapshot.routes[key];
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ fetchedAt: snapshot.fetchedAt, routes }, null, 2) + '\n', 'utf8');
}

/** Keep only the fields the page needs (drops nested relations). Trains stay — they are labelled, not hidden (D4). */
function normalizeRows(rows) {
  return rows
    .filter((s) => s && s.departureTime)
    .map((s) => ({
      id: s.id ?? null,
      route: String(s.route),
      labelUk: s.tripRoute?.labelUk ?? null,
      departureTime: String(s.departureTime),
      supportPhone: s.supportPhone ?? null,
      priceUah: s.priceUah ?? null,
      boardingPlace: s.boardingPlace ?? null,
      vehicleType: s.vehicleType ?? 'marshrutka',
      tripNumber: s.tripNumber ?? null,
    }));
}

const isTrain = (s) => s.vehicleType === 'elektrichka';

/** «Маршрутка» / «Електричка №6621» / «Потяг №859» — never a raw slug or bare number. */
function vehicleLabel(s) {
  if (!isTrain(s)) return 'Маршрутка';
  const n = s.tripNumber ? String(s.tripNumber).trim() : '';
  const kind = /^\d{4}$/.test(n) ? 'Електричка' : 'Потяг';
  return n ? `${kind} №${n}` : kind;
}

function routeLabel(s) {
  return ROUTE_LABELS[s.route] || s.labelUk || s.route;
}

function scheduleHeading(rows) {
  const trains = rows.some(isTrain);
  const buses = rows.some((s) => !isTrain(s));
  if (trains && buses) return 'Розклад маршруток та електричок';
  if (trains) return 'Розклад електричок і потягів';
  return 'Розклад маршруток';
}

/**
 * Pick the rows for one corridor: live rows if every route answered, else snapshot.
 * Returns { rows, source: 'api' | 'snapshot', asOf } or throws when both are empty.
 */
export function resolveCorridorSchedules(corridor, liveByRoute, snapshot, { allowEmpty = false, today = todayIso() } = {}) {
  const liveComplete = corridor.routes.every((r) => Array.isArray(liveByRoute[r]) && liveByRoute[r].length > 0);
  if (liveComplete) {
    return { rows: sortRows(corridor.routes.flatMap((r) => liveByRoute[r])), source: 'api', asOf: today };
  }
  const snapRows = corridor.routes.flatMap((r) => snapshot.routes[r] || []);
  if (snapRows.length) {
    return { rows: sortRows(snapRows), source: 'snapshot', asOf: snapshot.fetchedAt || today };
  }
  if (allowEmpty) return { rows: [], source: 'empty', asOf: today };
  throw new Error(
    `prerender-corridors: no schedule rows for /mizhgorodski/${corridor.slug} ` +
      `(routes ${corridor.routes.join(', ')}) — API ${API_BASE} gave nothing and no snapshot at ${SNAPSHOT_PATH}. ` +
      'Rule D10: refusing to ship a placeholder timetable. Set PRERENDER_ALLOW_EMPTY=1 only for local experiments.'
  );
}

function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      String(a.departureTime).localeCompare(String(b.departureTime)) ||
      String(a.route).localeCompare(String(b.route))
  );
}

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

/** @returns {Promise<Record<string, object[]>>} route key → normalized rows (missing key = fetch failed) */
async function fetchSchedulesByRoute(routeKeys) {
  const byRoute = {};
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
    if (Array.isArray(rows)) byRoute[route] = normalizeRows(rows);
  }
  return byRoute;
}

function buildTableRows(schedules) {
  if (!schedules.length) {
    // Only reachable with PRERENDER_ALLOW_EMPTY=1; never a "will load later" promise (D10).
    return '<tr><td colspan="5">Розклад тимчасово недоступний. Актуальні рейси — у пошуку на /mizhgorodski.</td></tr>';
  }
  return schedules
    .map((s) => {
      const phones = splitPhones(s.supportPhone);
      const phoneHtml = phones.length
        ? phones
            .map((d) => `<a href="tel:${d}">${escapeHtml(formatPhone(d))}</a>`)
            .join(', ')
        : '—';
      const price = s.priceUah != null ? `${escapeHtml(String(s.priceUah))} грн` : '—';
      return `<tr><td><strong>${escapeHtml(s.departureTime)}</strong></td><td>${escapeHtml(routeLabel(s))}</td><td>${escapeHtml(vehicleLabel(s))}</td><td>${price}</td><td>${phoneHtml}</td></tr>`;
    })
    .join('\n');
}

function buildPageHtml(shell, corridor, schedules, asOf = todayIso()) {
  const canonical = `https://malin.kiev.ua/mizhgorodski/${corridor.slug}`;
  const searchHref = `/mizhgorodski?from=${corridor.from}&to=${corridor.to}&type=bus`;
  // First/last are computed per vehicle kind so trains never inflate "маршрутка" facts (D4).
  const buses = schedules.filter((s) => !isTrain(s));
  const trains = schedules.filter(isTrain);
  const range = (rows) => {
    const t = rows.map((s) => s.departureTime).sort();
    return t.length ? { first: t[0], last: t[t.length - 1], count: t.length } : null;
  };
  const busRange = range(buses);
  const trainRange = range(trains);
  const summary = [
    busRange ? `маршрутки: ${busRange.count} рейсів, з ${busRange.first} до ${busRange.last}` : null,
    trainRange ? `електрички та потяги: ${trainRange.count} рейсів, з ${trainRange.first} до ${trainRange.last}` : null,
  ]
    .filter(Boolean)
    .join('; ');
  const desc = summary ? `${corridor.description} Розклад — ${summary}.` : corridor.description;

  const faq = [];
  if (busRange) {
    faq.push({
      q: `О котрій перша та остання маршрутка ${corridor.fromLabel} — ${corridor.toLabel}?`,
      a: `За розкладом malin.kiev.ua: перша маршрутка о ${busRange.first}, остання о ${busRange.last}. Усього ${busRange.count} відправлень маршруток${trainRange ? `; окремо ${trainRange.count} електричок і потягів` : ''}.`,
    });
  } else if (trainRange) {
    faq.push({
      q: `Чи є маршрутка ${corridor.fromLabel} — ${corridor.toLabel}?`,
      a: `Регулярних маршруток на цьому напрямку в нашій базі зараз немає. Є ${trainRange.count} електричок і потягів: перший о ${trainRange.first}, останній о ${trainRange.last}. Попутку можна знайти в пошуку на malin.kiev.ua/mizhgorodski.`,
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
              name: `${scheduleHeading(schedules)} ${corridor.fromLabel} — ${corridor.toLabel}`,
              numberOfItems: schedules.length,
              itemListElement: schedules.map((s, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: `${s.departureTime} · ${routeLabel(s)} · ${vehicleLabel(s)}${s.priceUah != null ? ` · ${s.priceUah} грн` : ''}`,
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
    <h2>${escapeHtml(scheduleHeading(schedules))}</h2>
    <p>Розклад актуальний на ${escapeHtml(asOf)} — з бази бронювання malin.kiev.ua. Перед поїздкою оберіть дату в пошуку та забронюйте місце.</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr><th>Відправлення</th><th>Маршрут</th><th>Тип</th><th>Ціна</th><th>Контакт</th></tr></thead>
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
  html = setCanonical(stripRobots(html), canonical);
  html = html.replace(
    /<meta property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(corridor.h1)}" />`
  );
  html = html.replace(
    /<meta property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`
  );
  html = setOg(html, 'og:url', canonical);
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

  const snapshot = loadSnapshot();
  try {
    await assertApiAlive('prerender-corridors');
  } catch (err) {
    // Not fatal here: the snapshot may still carry the build (D10 decides per corridor below).
    console.warn(String(err?.message || err));
  }
  const allRoutes = [...new Set(CORRIDORS.flatMap((c) => c.routes))];
  const live = await fetchSchedulesByRoute(allRoutes);

  let refreshed = 0;
  for (const route of allRoutes) {
    if (Array.isArray(live[route]) && live[route].length) {
      snapshot.routes[route] = live[route];
      refreshed += 1;
    }
  }
  if (refreshed === allRoutes.length) {
    snapshot.fetchedAt = todayIso();
    saveSnapshot(snapshot);
    console.log(`prerender-corridors: snapshot refreshed (${SNAPSHOT_PATH})`);
  } else if (refreshed > 0) {
    console.warn(`prerender-corridors: API answered for ${refreshed}/${allRoutes.length} routes — snapshot NOT rewritten`);
  }

  for (const corridor of CORRIDORS) {
    const { rows, source, asOf } = resolveCorridorSchedules(corridor, live, snapshot, { allowEmpty: ALLOW_EMPTY });
    const html = buildPageHtml(shell, corridor, rows, asOf);
    const outDir = path.join(distDir, 'mizhgorodski', corridor.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    const tag = source === 'api' ? '' : ` [${source}${asOf ? ` as of ${asOf}` : ''}]`;
    console.log(`  wrote /mizhgorodski/${corridor.slug}/ (${rows.length} trips)${tag}`);
  }
  console.log('prerender-corridors: done');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
