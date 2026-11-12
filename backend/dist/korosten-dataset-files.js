"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_FILE = exports.LOCAL_REPORT_FILE = exports.LOCAL_DATASET_FILE = exports.GOOGLE_HOPS_LOCAL_FILE = exports.GOOGLE_HOPS_FILE = exports.GOOGLE_COORDS_FILE = exports.GOOGLE_CHECK_FILE = exports.OSM_STREETS_FILE = exports.OSM_SNAPSHOT_FILE = exports.REPORT_FILE = exports.DATASET_FILE = void 0;
exports.parseRoutesCsv = parseRoutesCsv;
exports.loadKorostenDatasetInput = loadKorostenDatasetInput;
exports.buildKorostenDatasetFiles = buildKorostenDatasetFiles;
/**
 * Файли чернетки датасету Коростеня: читає data/korosten-transport/ (джерела ради, проєкт 2025, знімки OSM і Google,
 * dataset-config.json) і повертає вміст dataset/korosten-dataset.json і dataset/REPORT.md. Скрипт korosten-dataset
 * їх пише, тест порівнює із закоміченими. Docs/korosten-transport-data-2026-11.md.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const korosten_project_files_1 = require("./korosten-project-files");
const korosten_stop_aliases_1 = require("./korosten-stop-aliases");
const korosten_dataset_1 = require("./korosten-dataset");
exports.DATASET_FILE = 'dataset/korosten-dataset.json';
exports.REPORT_FILE = 'dataset/REPORT.md';
exports.OSM_SNAPSHOT_FILE = 'osm/snapshot.json';
exports.OSM_STREETS_FILE = 'osm/streets.json';
exports.GOOGLE_CHECK_FILE = 'google/check.json';
/** Координати Google — лише локально (.gitignore): тимчасова заміна приблизних точок, у git не потрапляють */
exports.GOOGLE_COORDS_FILE = 'google/coords.local.json';
/** Висновки перевірки прогонів через Google (у git) і повні відповіді Google (лише локально) */
exports.GOOGLE_HOPS_FILE = 'google/hops.json';
exports.GOOGLE_HOPS_LOCAL_FILE = 'google/hops.local.json';
exports.LOCAL_DATASET_FILE = 'dataset/korosten-dataset.local.json';
exports.LOCAL_REPORT_FILE = 'dataset/REPORT.local.md';
exports.CONFIG_FILE = 'dataset-config.json';
/** routes.csv ради: роздільник «;», поля uid, fullName, description */
function parseRoutesCsv(csv) {
    const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(';');
    const col = (name) => header.indexOf(name);
    return lines.slice(1).map((line) => {
        const cells = line.split(';');
        return { uid: cells[col('uid')].trim(), fullName: (cells[col('fullName')] ?? '').trim(), description: (cells[col('description')] ?? '').trim() };
    });
}
const readJson = (file) => (node_fs_1.default.existsSync(file) ? JSON.parse(node_fs_1.default.readFileSync(file, 'utf8')) : null);
function loadKorostenDatasetInput(root, opts = {}) {
    const { directions, timetable, aliases } = (0, korosten_project_files_1.loadKorostenProject)(root);
    const streets = readJson(node_path_1.default.join(root, exports.OSM_STREETS_FILE));
    return {
        official: (0, korosten_stop_aliases_1.parseOfficialStops)(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'source', 'stops.csv'), 'utf8')),
        aliases,
        directions,
        timetable,
        routesCsv: parseRoutesCsv(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'source', 'routes.csv'), 'utf8')),
        config: readJson(node_path_1.default.join(root, exports.CONFIG_FILE)),
        osm: readJson(node_path_1.default.join(root, exports.OSM_SNAPSHOT_FILE)),
        streets: streets?.streets ?? null,
        google: readJson(node_path_1.default.join(root, exports.GOOGLE_CHECK_FILE)),
        // закомічена чернетка Google-координат не бере ніколи — лише локальна версія на прохання власника
        googleCoords: opts.withGoogleCoords ? readJson(node_path_1.default.join(root, exports.GOOGLE_COORDS_FILE)) : null,
        googleHops: readJson(node_path_1.default.join(root, exports.GOOGLE_HOPS_FILE)),
    };
}
function buildKorostenDatasetFiles(root, opts = {}) {
    if (opts.withGoogleCoords && !node_fs_1.default.existsSync(node_path_1.default.join(root, exports.GOOGLE_COORDS_FILE))) {
        throw new Error(`${exports.GOOGLE_COORDS_FILE} нема — спершу --fetch-google`);
    }
    const result = (0, korosten_dataset_1.buildKorostenDataset)(loadKorostenDatasetInput(root, opts));
    return {
        files: {
            [exports.DATASET_FILE]: `${JSON.stringify(result.dataset, null, 2)}\n`,
            [exports.REPORT_FILE]: `${result.report}\n`,
        },
        result,
    };
}
