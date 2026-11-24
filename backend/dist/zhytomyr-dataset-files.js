"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EASYWAY_FILES = exports.EASYWAY_DIR = exports.CONFIG_FILE = exports.REPORT_FILE = exports.DATASET_FILE = void 0;
exports.loadEasywayFiles = loadEasywayFiles;
exports.loadEasyway = loadEasyway;
exports.buildZhytomyrDatasetFiles = buildZhytomyrDatasetFiles;
/**
 * Файли датасету міського транспорту Житомира: читає data/zhytomyr-transport/ (знімок zt.rozklad.in.ua, точки
 * зупинок, OSM, знімок EasyWay у easyway/, dataset-config.json) і повертає вміст dataset/zhytomyr-dataset.json і
 * dataset/REPORT.md. Скрипт zhytomyr-dataset їх пише, тест порівнює із закоміченими. Docs/zhytomyr-transport-2026-11.md.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const zhytomyr_routes_1 = require("./zhytomyr-routes");
const zhytomyr_easyway_1 = require("./zhytomyr-easyway");
const zhytomyr_dataset_1 = require("./zhytomyr-dataset");
exports.DATASET_FILE = 'dataset/zhytomyr-dataset.json';
exports.REPORT_FILE = 'dataset/REPORT.md';
exports.CONFIG_FILE = 'dataset-config.json';
exports.EASYWAY_DIR = 'easyway';
/** що копіюємо зі знімка EasyWay у репозиторій (решта — службове) */
exports.EASYWAY_FILES = ['README.md', 'routes.csv', 'stop_sequence.csv', 'departures.csv', 'electric_routes.csv'];
const read = (file) => (node_fs_1.default.existsSync(file) ? node_fs_1.default.readFileSync(file, 'utf8') : null);
function listRaw(dir, prefix = 'raw') {
    const out = {};
    const full = node_path_1.default.join(dir, prefix);
    if (!node_fs_1.default.existsSync(full))
        return out;
    for (const name of node_fs_1.default.readdirSync(full).sort()) {
        const rel = `${prefix}/${name}`;
        if (node_fs_1.default.statSync(node_path_1.default.join(dir, rel)).isDirectory())
            Object.assign(out, listRaw(dir, rel));
        else
            out[rel] = node_fs_1.default.readFileSync(node_path_1.default.join(dir, rel), 'utf8');
    }
    return out;
}
function loadEasywayFiles(dir) {
    if (!node_fs_1.default.existsSync(dir))
        return null;
    return {
        routesCsv: read(node_path_1.default.join(dir, 'routes.csv')),
        stopSequenceCsv: read(node_path_1.default.join(dir, 'stop_sequence.csv')),
        departuresCsv: read(node_path_1.default.join(dir, 'departures.csv')),
        electricRoutesCsv: read(node_path_1.default.join(dir, 'electric_routes.csv')),
        raw: listRaw(dir),
    };
}
function loadEasyway(root) {
    const files = loadEasywayFiles(node_path_1.default.join(root, exports.EASYWAY_DIR));
    return files ? (0, zhytomyr_easyway_1.parseEasywaySnapshot)(files) : null;
}
function buildZhytomyrDatasetFiles(root) {
    const { routes, stops, dirs } = (0, zhytomyr_routes_1.zhytomyrTimedDirections)(root);
    const osm = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(root, 'osm/stops.json'), 'utf8')).stops;
    const fileConfig = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(root, exports.CONFIG_FILE), 'utf8'));
    const validFrom = routes.routes.flatMap((r) => r.directions.map((d) => d.validFrom)).find(Boolean) ?? null;
    const config = { ...fileConfig, zt: { sourceUrl: routes.source, fetchedAt: routes.fetchedAt, validFrom, ...(fileConfig.zt ?? {}) } };
    const result = (0, zhytomyr_dataset_1.buildZhytomyrDataset)({ timed: dirs, ztStops: stops, osm, easyway: loadEasyway(root), config });
    return {
        files: {
            [exports.DATASET_FILE]: `${JSON.stringify(result.dataset, null, 2)}\n`,
            [exports.REPORT_FILE]: `${result.report}\n`,
        },
        result,
    };
}
