"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const korosten_source_parser_1 = require("../korosten-source-parser");
const transport_source_watch_1 = require("../transport-source-watch");
const korosten_project_files_1 = require("../korosten-project-files");
const OUT_DIR = node_path_1.default.resolve(__dirname, '../../../data/korosten-transport/source');
const sha256 = (data) => (0, node_crypto_1.createHash)('sha256').update(data).digest('hex');
const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
};
async function main() {
    if (process.argv.includes('--project')) {
        const root = node_path_1.default.resolve(OUT_DIR, '..');
        for (const [file, content] of Object.entries((0, korosten_project_files_1.buildKorostenProjectFiles)(root))) {
            node_fs_1.default.writeFileSync(node_path_1.default.join(root, file), content);
            console.log(`${file}: ${content.length} chars`);
        }
        return;
    }
    node_fs_1.default.mkdirSync(OUT_DIR, { recursive: true });
    const files = [];
    const page = transport_source_watch_1.WATCHED_SOURCES.find((s) => s.key === 'korosten-rada-timetable');
    if (!page)
        throw new Error('korosten-rada-timetable is not in WATCHED_SOURCES');
    const pageFile = arg('--page');
    const html = pageFile ? node_fs_1.default.readFileSync(pageFile, 'utf8') : await (0, transport_source_watch_1.fetchSourceText)(page.fetchUrl);
    const fragment = (0, korosten_source_parser_1.extractTimetableFragment)(html);
    const timetable = (0, korosten_source_parser_1.parseKorostenTimetable)(fragment);
    node_fs_1.default.writeFileSync(node_path_1.default.join(OUT_DIR, 'rada-timetable.html'), fragment);
    const json = `${JSON.stringify(timetable, null, 2)}\n`;
    node_fs_1.default.writeFileSync(node_path_1.default.join(OUT_DIR, 'timetable.json'), json);
    files.push({ file: 'rada-timetable.html', source: page.url, sha256: sha256(fragment), modified: timetable.modified });
    files.push({ file: 'timetable.json', source: 'korosten-source-parser.ts ← rada-timetable.html', sha256: sha256(json), modified: timetable.modified });
    console.log(`rada-timetable: ${timetable.routes.length} routes, ${timetable.routes.reduce((n, r) => n + r.runs.length, 0)} runs`);
    if (!process.argv.includes('--no-csv')) {
        for (const source of transport_source_watch_1.WATCHED_SOURCES.filter((s) => s.kind === 'ckan' && s.cityCode === 'Korosten')) {
            const pkg = JSON.parse(await (0, transport_source_watch_1.fetchSourceText)(source.fetchUrl));
            for (const res of pkg.result.resources) {
                if (!/\.csv($|\?)/i.test(res.url))
                    continue; // GPS-набір — посилання на живий JSON, у знімок не йде
                const name = `${res.name.replace(/\.csv$/i, '').replace(/[^a-z0-9_-]/gi, '')}.csv`;
                const response = await fetch(res.url, { headers: { 'User-Agent': 'transport-source-watch/1.0' }, signal: AbortSignal.timeout(30000) });
                if (!response.ok)
                    throw new Error(`${res.url}: HTTP ${response.status}`);
                const data = Buffer.from(await response.arrayBuffer());
                node_fs_1.default.writeFileSync(node_path_1.default.join(OUT_DIR, name), data);
                files.push({ file: name, source: res.url, sha256: sha256(data), modified: res.last_modified ?? null });
                console.log(`${name}: ${data.length} bytes`);
            }
        }
    }
    else if (node_fs_1.default.existsSync(node_path_1.default.join(OUT_DIR, 'manifest.json'))) {
        const prev = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(OUT_DIR, 'manifest.json'), 'utf8'));
        files.push(...prev.files.filter((f) => f.file.endsWith('.csv')));
    }
    const manifest = { fetchedAt: new Date().toISOString(), files };
    node_fs_1.default.writeFileSync(node_path_1.default.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
