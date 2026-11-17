/**
 * Статті зупинок міста, крім Малина (Docs/korosten-transport-2026-11.md, фаза 10б): лише факти з джерел — вулиця з
 * переліку зупинок міської ради (`data/korosten-transport/source/stops.csv`, колонка `addressThoroughfare`) і назва з
 * чернетки датасету. Нічого не дописуємо від себе: ні орієнтирів, ні координат (точки частини зупинок — тимчасові,
 * до об'їзду). Маршрути статті не тримає — сторінка бере їх з датасету.
 *
 *   node scripts/city-stop-articles.mjs      → src/content/stops/korosten-articles.json
 *
 * Тест `src/content/stops/cityArticles.test.ts` звіряє закомічений файл із генератором.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

export const KOROSTEN_ARTICLE_SOURCES = {
  stopsCsv: path.join(repoRoot, 'data/korosten-transport/source/stops.csv'),
  dataset: path.join(repoRoot, 'data/korosten-transport/dataset/korosten-dataset.json'),
  out: path.join(__dirname, '../src/content/stops/korosten-articles.json'),
};

const REQUEST_STOP_TIP = 'Зупинка на вимогу: попросіть водія зупинитися або подайте знак рукою.';
const SOURCE_TIP = 'Адреса — з переліку зупинок Коростенської міської ради.';

/** `;`-CSV ради → рядки-обʼєкти за заголовком */
export function parseCouncilCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = lines.shift().split(';');
  return lines.map((line) => {
    const cells = line.split(';');
    return Object.fromEntries(head.map((k, i) => [k, (cells[i] ?? '').trim()]));
  });
}

/** «вул.Бандери  Степана» → «вул. Бандери Степана»; «Вул. Князя…» → «вул. Князя…»; порожнє / NA → null */
export function normalizeStreet(raw) {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s === 'NA' || s === 'null') return null;
  return s.replace(/^(вул|пров)\.\s*/i, (_, kind) => `${kind.toLowerCase()}. `);
}

/** z-001 → st_1001, z-101 → st_1101 (як у генераторі датасету, backend/src/korosten-dataset.ts) */
export function stopIdOfCouncilUid(uid) {
  const m = /^z-(\d{3})$/.exec(uid);
  return m ? `st_${1000 + Number(m[1])}` : null;
}

/**
 * @param {string} csvText перелік зупинок ради
 * @param {{ stops: { id: string, name: string }[] }} dataset чернетка датасету (назви)
 * @returns {{ id: string, name: string, place: string, tips: string[] }[]}
 */
export function buildKorostenStopArticles(csvText, dataset) {
  const streetById = new Map();
  for (const row of parseCouncilCsv(csvText)) {
    const id = stopIdOfCouncilUid(row.uid);
    const street = normalizeStreet(row.addressThoroughfare);
    if (id && street) streetById.set(id, street);
  }
  const out = [];
  for (const stop of [...(dataset.stops || [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const street = streetById.get(stop.id);
    // Зупинка, названа вулицею («Вул. Київська»), нічого не дізнається з тієї самої вулиці
    if (!street || /^вул\./i.test(stop.name.trim())) continue;
    const tips = /на вимогу/i.test(stop.name) ? [REQUEST_STOP_TIP, SOURCE_TIP] : [SOURCE_TIP];
    out.push({ id: stop.id, name: stop.name, place: street, tips });
  }
  return out;
}

function readSources() {
  return {
    csv: fs.readFileSync(KOROSTEN_ARTICLE_SOURCES.stopsCsv, 'utf8'),
    dataset: JSON.parse(fs.readFileSync(KOROSTEN_ARTICLE_SOURCES.dataset, 'utf8')),
  };
}

/** Вміст файлу так, як його пише генератор */
export function korostenArticlesFileText() {
  const { csv, dataset } = readSources();
  return `${JSON.stringify(buildKorostenStopArticles(csv, dataset), null, 2)}\n`;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const text = korostenArticlesFileText();
  fs.writeFileSync(KOROSTEN_ARTICLE_SOURCES.out, text, 'utf8');
  console.log(`city-stop-articles: ${JSON.parse(text).length} статей → ${path.relative(process.cwd(), KOROSTEN_ARTICLE_SOURCES.out)}`);
}
