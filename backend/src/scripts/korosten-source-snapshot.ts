/**
 * Знімок джерел міського транспорту Коростеня в репозиторій (Docs/korosten-transport-2026-11.md, фаза 2):
 *   data/korosten-transport/source/rada-timetable.html — частина сторінки ради з таблицями розкладу
 *   data/korosten-transport/source/timetable.json      — розібраний розклад (korosten-source-parser.ts)
 *   data/korosten-transport/source/*.csv               — файли наборів ради на data.gov.ua
 *   data/korosten-transport/source/manifest.json       — звідки, коли, sha256
 *
 * npm run korosten:snapshot                 — завантажити все заново (по одному запиту на файл)
 * npm run korosten:snapshot -- --page <f>   — сторінку ради взяти зі збереженого HTML-файлу
 * npm run korosten:snapshot -- --no-csv     — лише сторінка ради
 * npm run korosten:snapshot -- --project    — без мережі: проєкт власника 2025 року (project-2025/html) →
 *                                             project-2025/chains.json, stop-aliases.json, project-2025/REPORT.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractTimetableFragment, parseKorostenTimetable } from '../korosten-source-parser';
import { WATCHED_SOURCES, fetchSourceText } from '../transport-source-watch';
import { buildKorostenProjectFiles } from '../korosten-project-files';

const OUT_DIR = path.resolve(__dirname, '../../../data/korosten-transport/source');
const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

type ManifestFile = { file: string; source: string; sha256: string; modified: string | null };

async function main(): Promise<void> {
  if (process.argv.includes('--project')) {
    const root = path.resolve(OUT_DIR, '..');
    for (const [file, content] of Object.entries(buildKorostenProjectFiles(root))) {
      fs.writeFileSync(path.join(root, file), content);
      console.log(`${file}: ${content.length} chars`);
    }
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files: ManifestFile[] = [];
  const page = WATCHED_SOURCES.find((s) => s.key === 'korosten-rada-timetable');
  if (!page) throw new Error('korosten-rada-timetable is not in WATCHED_SOURCES');

  const pageFile = arg('--page');
  const html = pageFile ? fs.readFileSync(pageFile, 'utf8') : await fetchSourceText(page.fetchUrl);
  const fragment = extractTimetableFragment(html);
  const timetable = parseKorostenTimetable(fragment);
  fs.writeFileSync(path.join(OUT_DIR, 'rada-timetable.html'), fragment);
  const json = `${JSON.stringify(timetable, null, 2)}\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'timetable.json'), json);
  files.push({ file: 'rada-timetable.html', source: page.url, sha256: sha256(fragment), modified: timetable.modified });
  files.push({ file: 'timetable.json', source: 'korosten-source-parser.ts ← rada-timetable.html', sha256: sha256(json), modified: timetable.modified });
  console.log(`rada-timetable: ${timetable.routes.length} routes, ${timetable.routes.reduce((n, r) => n + r.runs.length, 0)} runs`);

  if (!process.argv.includes('--no-csv')) {
    for (const source of WATCHED_SOURCES.filter((s) => s.kind === 'ckan' && s.cityCode === 'Korosten')) {
      const pkg = JSON.parse(await fetchSourceText(source.fetchUrl)) as {
        result: { resources: Array<{ name: string; url: string; format?: string; last_modified?: string | null }> };
      };
      for (const res of pkg.result.resources) {
        if (!/\.csv($|\?)/i.test(res.url)) continue; // GPS-набір — посилання на живий JSON, у знімок не йде
        const name = `${res.name.replace(/\.csv$/i, '').replace(/[^a-z0-9_-]/gi, '')}.csv`;
        const response = await fetch(res.url, { headers: { 'User-Agent': 'transport-source-watch/1.0' }, signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`${res.url}: HTTP ${response.status}`);
        const data = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(path.join(OUT_DIR, name), data);
        files.push({ file: name, source: res.url, sha256: sha256(data), modified: res.last_modified ?? null });
        console.log(`${name}: ${data.length} bytes`);
      }
    }
  } else if (fs.existsSync(path.join(OUT_DIR, 'manifest.json'))) {
    const prev = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8')) as { files: ManifestFile[] };
    files.push(...prev.files.filter((f) => f.file.endsWith('.csv')));
  }

  const manifest = { fetchedAt: new Date().toISOString(), files };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
