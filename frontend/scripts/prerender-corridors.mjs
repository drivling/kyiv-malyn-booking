/**
 * Post-build prerender for corridor SEO pages: dist/mizhgorodski/{slug}/index.html.
 *
 * Content (title, h1, lead, ways, boarding, FAQ) comes from src/pages/MizhgorodskiPage/corridorLandings.ts
 * — the same file the SPA renders — loaded through Vite so there is one source of truth.
 * Timetables come from the backend (scripts/api-base.mjs), filtered by fromCode/toCode like the SPA.
 *
 * Data-quality rule D10 (Docs/seo-aeo-review-2026-09.md §10): never ship a "will load later" timetable.
 *   1. live API answered → use it (even an empty list is an honest answer) and refresh the snapshot
 *   2. API unreachable → committed snapshot scripts/data/corridor-schedules.snapshot.json, page shows its date
 *   3. neither → build fails (PRERENDER_ALLOW_EMPTY=1 downgrades to a warning for local experiments)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE, assertApiAlive } from './api-base.mjs';
import { setCanonical, setOg, stripRobots } from './html-head.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const distDir = path.join(frontendDir, 'dist');
const indexPath = path.join(distDir, 'index.html');
const SNAPSHOT_PATH = path.resolve(__dirname, 'data/corridor-schedules.snapshot.json');
const ALLOW_EMPTY = process.env.PRERENDER_ALLOW_EMPTY === '1';
const SITE = 'https://malin.kiev.ua';

const todayIso = () => new Date().toISOString().slice(0, 10);

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- snapshot ----------

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return { fetchedAt: null, corridors: {} };
  try {
    const data = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    return { fetchedAt: data?.fetchedAt || null, corridors: data?.corridors || {} };
  } catch (err) {
    console.warn('prerender-corridors: snapshot unreadable, ignoring:', err?.message || err);
    return { fetchedAt: null, corridors: {} };
  }
}

function saveSnapshot(snapshot) {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  const corridors = {};
  for (const key of Object.keys(snapshot.corridors).sort()) corridors[key] = snapshot.corridors[key];
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ fetchedAt: snapshot.fetchedAt, corridors }, null, 2) + '\n', 'utf8');
}

// ---------- rows ----------

/** Keep only the fields the page needs. Trains stay — they are labelled, not hidden (rule D4). */
export function normalizeRows(rows) {
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
      activeWeekdays: Array.isArray(s.activeWeekdays) ? s.activeWeekdays : null,
    }))
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime) || a.route.localeCompare(b.route));
}

export const isTrain = (s) => s.vehicleType === 'elektrichka';

/** Shared with the SPA (src/utils/vehicleLabel.ts); bound in loadSources(). */
let vehicleLabel = (s) => (isTrain(s) ? 'Електричка' : 'Маршрутка');

export function scheduleHeading(rows) {
  const trains = rows.some(isTrain);
  const buses = rows.some((s) => !isTrain(s));
  if (trains && buses) return 'Розклад маршруток та електричок';
  if (trains) return 'Розклад електричок і потягів';
  return 'Розклад маршруток';
}

/**
 * Rows for one corridor: live if the API answered (an empty array counts), else snapshot, else fail.
 * @returns {{rows: object[], source: 'api'|'snapshot'|'empty', asOf: string}}
 */
export function resolveCorridorSchedules(slug, live, snapshot, { allowEmpty = false, today = todayIso() } = {}) {
  if (Array.isArray(live[slug])) return { rows: live[slug], source: 'api', asOf: today };
  const snap = snapshot.corridors[slug];
  if (Array.isArray(snap)) return { rows: snap, source: 'snapshot', asOf: snapshot.fetchedAt || today };
  if (allowEmpty) return { rows: [], source: 'empty', asOf: today };
  throw new Error(
    `prerender-corridors: no data for /mizhgorodski/${slug} — API ${API_BASE} did not answer and no snapshot at ${SNAPSHOT_PATH}. ` +
      'Rule D10: refusing to ship a placeholder timetable. Set PRERENDER_ALLOW_EMPTY=1 only for local experiments.'
  );
}

async function fetchCorridor(landing) {
  const url = `${API_BASE}/schedules?fromCode=${encodeURIComponent(landing.from)}&toCode=${encodeURIComponent(landing.to)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('not an array');
    return normalizeRows(data);
  } catch (err) {
    console.warn(`prerender-corridors: ${url} → ${err?.message || err}`);
    return null;
  }
}

// ---------- phones ----------

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
  if (digits.length === 12 && digits.startsWith('38')) return `+380(${digits.slice(3, 5)})${digits.slice(5)}`;
  return '+' + digits;
}

// ---------- html ----------

function routeLabel(s, ROUTES) {
  return ROUTES[s.route] || s.labelUk || s.route;
}

function buildTableRows(rows, { ROUTES, weekdaysLabel }) {
  if (!rows.length) {
    // Honest empty state (API answered with no rows) — never a "will load later" promise (D10).
    return '<tr><td colspan="6">Регулярних рейсів на цьому напрямку в базі зараз немає. Попутки — у пошуку на /mizhgorodski.</td></tr>';
  }
  return rows
    .map((s) => {
      const phones = splitPhones(s.supportPhone);
      const phoneHtml = phones.length ? phones.map((d) => `<a href="tel:${d}">${escapeHtml(formatPhone(d))}</a>`).join(', ') : '—';
      const price = s.priceUah != null ? `${escapeHtml(String(s.priceUah))} грн` : '—';
      return `<tr><td><strong>${escapeHtml(s.departureTime)}</strong></td><td>${escapeHtml(routeLabel(s, ROUTES))}</td><td>${escapeHtml(vehicleLabel(s))}</td><td>${escapeHtml(weekdaysLabel(s.activeWeekdays))}</td><td>${price}</td><td>${phoneHtml}</td></tr>`;
    })
    .join('\n');
}

export function buildPageHtml(shell, landing, rows, asOf, helpers) {
  const { ROUTES, weekdaysLabel, tripsPerDayText } = helpers;
  const canonical = `${SITE}/mizhgorodski/${landing.slug}`;
  const searchHref = `/mizhgorodski?from=${landing.from}&to=${landing.to}`;
  const busHref = `${searchHref}&type=bus`;

  // First/last are computed per vehicle kind so trains never inflate "маршрутка" facts (D4).
  const buses = rows.filter((s) => !isTrain(s));
  const trains = rows.filter(isTrain);
  const range = (list) => {
    const t = list.map((s) => s.departureTime).sort();
    return t.length ? { first: t[0], last: t[t.length - 1], count: t.length } : null;
  };
  const busRange = range(buses);
  const trainRange = range(trains);
  const summary = [
    busRange ? `маршрутки та автобуси: ${tripsPerDayText(buses)}, з ${busRange.first} до ${busRange.last}` : null,
    trainRange ? `електрички та потяги: ${trainRange.count} рейсів, з ${trainRange.first} до ${trainRange.last}` : null,
  ]
    .filter(Boolean)
    .join('; ');
  const desc = summary ? `${landing.description} Розклад — ${summary}.` : landing.description;

  const faq = [];
  if (busRange) {
    faq.push({
      q: `О котрій перший та останній рейс ${landing.fromLabel} — ${landing.toLabel}?`,
      a: `За розкладом malin.kiev.ua: перший рейс о ${busRange.first}, останній о ${busRange.last}; ${tripsPerDayText(buses)}${trainRange ? `; окремо ${trainRange.count} електричок і потягів` : ''}. Дні курсування кожного рейсу — у таблиці на цій сторінці.`,
    });
  } else if (trainRange) {
    faq.push({
      q: `Чи є маршрутка або автобус ${landing.fromLabel} — ${landing.toLabel}?`,
      a: `Регулярних автобусних рейсів на цьому напрямку в нашій базі зараз немає. Є ${trainRange.count} електричок і потягів: перший о ${trainRange.first}, останній о ${trainRange.last}. Попутку можна знайти в пошуку на malin.kiev.ua/mizhgorodski.`,
    });
  }
  faq.push(...landing.faq);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Міжміські', item: `${SITE}/mizhgorodski` },
          { '@type': 'ListItem', position: 2, name: `${landing.fromLabel} — ${landing.toLabel}`, item: canonical },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
      ...(rows.length
        ? [
            {
              '@type': 'ItemList',
              name: `${scheduleHeading(rows)} ${landing.fromLabel} — ${landing.toLabel}`,
              numberOfItems: rows.length,
              itemListElement: rows.map((s, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: `${s.departureTime} · ${routeLabel(s, ROUTES)} · ${vehicleLabel(s)} · ${weekdaysLabel(s.activeWeekdays)}${s.priceUah != null ? ` · ${s.priceUah} грн` : ''}`,
              })),
            },
          ]
        : []),
    ],
  };

  const prerenderBody = `
<div id="root">
  <main style="font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#054752">
    <p><a href="/mizhgorodski">Міжміські</a> / ${escapeHtml(landing.fromLabel)} — ${escapeHtml(landing.toLabel)}</p>
    <h1>${escapeHtml(landing.h1)}</h1>
    <p>${escapeHtml(landing.lead)}</p>
    <p><a href="${escapeHtml(searchHref)}">Шукати зараз ${escapeHtml(landing.fromLabel)} → ${escapeHtml(landing.toLabel)}</a> · <a href="${escapeHtml(busHref)}">Лише маршрутки</a></p>
    <h2>${escapeHtml(scheduleHeading(rows))}</h2>
    <p>Розклад актуальний на ${escapeHtml(asOf)} — з бази бронювання malin.kiev.ua. Перед поїздкою оберіть дату в пошуку та забронюйте місце.</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
      <thead><tr><th>Відправлення</th><th>Маршрут</th><th>Тип</th><th>Дні</th><th>Ціна</th><th>Контакт</th></tr></thead>
      <tbody>
        ${buildTableRows(rows, helpers)}
      </tbody>
    </table>
    <h2>Як доїхати</h2>
    <ul>
      ${landing.ways.map((w) => `<li><strong>${escapeHtml(w.title)}.</strong> ${escapeHtml(w.text)}</li>`).join('\n      ')}
    </ul>
    <h2>Посадка й час у дорозі</h2>
    <p>${escapeHtml(landing.boarding)}</p>
    <p>${escapeHtml(landing.travelTimeHint)}</p>
    <h2>Часті питання</h2>
    ${faq.map((f) => `<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`).join('\n    ')}
    <p>Зворотний напрямок: <a href="/mizhgorodski/${escapeHtml(landing.reverseSlug)}">${escapeHtml(landing.toLabel)} — ${escapeHtml(landing.fromLabel)}</a> · <a href="/support/travel">Як доїхати до Малина</a> · <a href="/support/prices">Скільки коштує</a> · <a href="/transport">Транспорт Малина</a></p>
  </main>
</div>`;

  let html = shell;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(landing.title)}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${escapeHtml(desc)}" />`);
  html = setCanonical(stripRobots(html), canonical);
  html = html.replace(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${escapeHtml(landing.title)}" />`);
  html = html.replace(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${escapeHtml(desc)}" />`);
  html = setOg(html, 'og:url', canonical);
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  );
  html = html.replace(/<div id="root"><\/div>/i, prerenderBody);
  return html;
}

// ---------- main ----------

async function loadSources() {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: frontendDir,
    configFile: path.join(frontendDir, 'vite.config.ts'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const landings = await vite.ssrLoadModule('/src/pages/MizhgorodskiPage/corridorLandings.ts');
    const weekdays = await vite.ssrLoadModule('/src/utils/weekdays.ts');
    vehicleLabel = (await vite.ssrLoadModule('/src/utils/vehicleLabel.ts')).vehicleLabel;
    const constants = await vite.ssrLoadModule('/src/utils/constants.ts');
    return {
      CORRIDOR_LANDINGS: landings.CORRIDOR_LANDINGS,
      helpers: { ROUTES: constants.ROUTES, weekdaysLabel: weekdays.weekdaysLabel, tripsPerDayText: weekdays.tripsPerDayText },
    };
  } finally {
    await vite.close();
  }
}

async function main() {
  if (!fs.existsSync(indexPath)) {
    console.error('prerender-corridors: dist/index.html missing — run vite build first');
    process.exit(1);
  }
  const shell = fs.readFileSync(indexPath, 'utf8');
  console.log(`prerender-corridors: API ${API_BASE}`);
  const { CORRIDOR_LANDINGS, helpers } = await loadSources();

  const snapshot = loadSnapshot();
  let apiOk = true;
  try {
    await assertApiAlive('prerender-corridors');
  } catch (err) {
    apiOk = false;
    console.warn(String(err?.message || err));
  }

  const live = {};
  if (apiOk) {
    for (const landing of CORRIDOR_LANDINGS) {
      const rows = await fetchCorridor(landing);
      if (rows) live[landing.slug] = rows;
    }
  }
  const answered = Object.keys(live).length;
  if (answered === CORRIDOR_LANDINGS.length) {
    snapshot.corridors = { ...live };
    snapshot.fetchedAt = todayIso();
    saveSnapshot(snapshot);
    console.log(`prerender-corridors: snapshot refreshed (${SNAPSHOT_PATH})`);
  } else if (answered > 0) {
    console.warn(`prerender-corridors: API answered for ${answered}/${CORRIDOR_LANDINGS.length} corridors — snapshot NOT rewritten`);
  }

  for (const landing of CORRIDOR_LANDINGS) {
    const { rows, source, asOf } = resolveCorridorSchedules(landing.slug, live, snapshot, { allowEmpty: ALLOW_EMPTY });
    const html = buildPageHtml(shell, landing, rows, asOf, helpers);
    const outDir = path.join(distDir, 'mizhgorodski', landing.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    const tag = source === 'api' ? '' : ` [${source}${asOf ? ` as of ${asOf}` : ''}]`;
    console.log(`  wrote /mizhgorodski/${landing.slug}/ (${rows.length} rows)${tag}`);
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
