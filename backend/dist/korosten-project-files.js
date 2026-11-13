"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadKorostenProject = loadKorostenProject;
exports.buildKorostenProjectFiles = buildKorostenProjectFiles;
/**
 * Похідні файли з проєкту власника 2025 року: читає data/korosten-transport/ (project-2025/html, source/,
 * stop-aliases.hints.json) і повертає вміст chains.json, stop-aliases.json і REPORT.md. Скрипт знімка їх пише,
 * тест порівнює із закоміченими. Docs/korosten-transport-2026-11.md, фаза 2б.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const korosten_project_parser_1 = require("./korosten-project-parser");
const korosten_project_report_1 = require("./korosten-project-report");
const korosten_stop_aliases_1 = require("./korosten-stop-aliases");
function loadKorostenProject(root) {
    const htmlDir = node_path_1.default.join(root, 'project-2025', 'html');
    const directions = node_fs_1.default
        .readdirSync(htmlDir)
        .filter((f) => /^\d\d\.html$/.test(f))
        .sort()
        .map((f) => (0, korosten_project_parser_1.parseProjectDirection)(node_fs_1.default.readFileSync(node_path_1.default.join(htmlDir, f), 'utf8'), f.slice(0, 2)));
    const timetable = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'source', 'timetable.json'), 'utf8'));
    const hints = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'stop-aliases.hints.json'), 'utf8'));
    const names = directions.flatMap((d) => d.stops.map((s) => ({ name: s.name, source: `project-2025:${d.code}` })));
    for (const route of timetable.routes) {
        for (const run of route.runs) {
            for (const name of [run.from, run.to, ...run.via])
                names.push({ name, source: `rada:№${route.number}` });
        }
    }
    const official = (0, korosten_stop_aliases_1.parseOfficialStops)(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'source', 'stops.csv'), 'utf8'));
    return { directions, timetable, aliases: (0, korosten_stop_aliases_1.buildStopAliases)(names, official, hints) };
}
/** Шлях відносно data/korosten-transport/ → вміст файлу */
function buildKorostenProjectFiles(root) {
    const { directions, timetable, aliases } = loadKorostenProject(root);
    return {
        'project-2025/chains.json': `${JSON.stringify({ directions }, null, 2)}\n`,
        'stop-aliases.json': `${JSON.stringify(aliases, null, 2)}\n`,
        'project-2025/REPORT.md': (0, korosten_project_report_1.buildProjectReport)(directions, timetable, aliases),
    };
}
