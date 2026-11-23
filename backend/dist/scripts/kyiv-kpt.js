"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KPT_DATA_TS = exports.KPT_ZIP = exports.KPT_DIR = void 0;
exports.readKptZip = readKptZip;
/**
 * GTFS КП «Київпастранс» → дані «Доведе» (Docs/dovede-learning-roadmap.md, крок 2):
 *   data/kyiv-transport/kpt-gtfs/gtfs_static.zip  — архів власника, як є
 *   backend/src/dovede/kyiv-kpt-data.ts           — дані для сервера (каталогу data/ на сервері немає)
 *   data/kyiv-transport/kpt-gtfs/REPORT.md        — що увійшло і чого в архіві немає
 *
 * npm run kyiv:kpt                     — з архіву в репозиторії (мережі не потребує)
 * npm run kyiv:kpt -- <шлях до zip>    — новий архів: копіюється на місце старого, далі те саме
 * npm run kyiv:kpt -- --fetch          — завантажити свіжий архів з експорту КПТ; адреса — у змінній KPT_GTFS_URL
 *                                        (у репозиторій її не кладемо: це сервер проєкту, не публічна сторінка)
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const zip_1 = require("../zip");
const kyiv_kpt_1 = require("../dovede/kyiv-kpt");
exports.KPT_DIR = node_path_1.default.resolve(__dirname, '../../../data/kyiv-transport/kpt-gtfs');
exports.KPT_ZIP = node_path_1.default.join(exports.KPT_DIR, 'gtfs_static.zip');
exports.KPT_DATA_TS = node_path_1.default.resolve(__dirname, '../../src/dovede/kyiv-kpt-data.ts');
/** Текстові файли архіву: ім'я без шляху → вміст */
function readKptZip(file) {
    const out = {};
    for (const e of (0, zip_1.readZip)(node_fs_1.default.readFileSync(file))) {
        const name = e.name.split('/').pop() ?? e.name;
        if (name.endsWith('.txt'))
            out[name] = e.data.toString('utf8');
    }
    return out;
}
async function main() {
    const src = process.argv[2];
    if (src === '--fetch') {
        const url = process.env.KPT_GTFS_URL;
        if (!url)
            throw new Error('KPT_GTFS_URL не задано: адресу експорту GTFS «Київпастрансу» має власник');
        const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!res.ok)
            throw new Error(`Експорт КПТ відповів HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.readUInt32LE(0) !== 0x04034b50)
            throw new Error('Експорт КПТ віддав не ZIP');
        node_fs_1.default.mkdirSync(exports.KPT_DIR, { recursive: true });
        node_fs_1.default.writeFileSync(exports.KPT_ZIP, buf);
    }
    else if (src) {
        node_fs_1.default.mkdirSync(exports.KPT_DIR, { recursive: true });
        node_fs_1.default.copyFileSync(node_path_1.default.resolve(src), exports.KPT_ZIP);
    }
    const { data, report } = (0, kyiv_kpt_1.buildKptData)(readKptZip(exports.KPT_ZIP));
    node_fs_1.default.writeFileSync(exports.KPT_DATA_TS, (0, kyiv_kpt_1.renderKptDataTs)(data));
    node_fs_1.default.writeFileSync(node_path_1.default.join(exports.KPT_DIR, 'REPORT.md'), (0, kyiv_kpt_1.renderKptReport)(data, report));
    console.log(`КПТ ${data.version}: маршрутів ${report.routes}, напрямків ${report.dirs}, рейсів ${report.trips}; ${node_fs_1.default.statSync(exports.KPT_DATA_TS).size} байт → ${node_path_1.default.relative(process.cwd(), exports.KPT_DATA_TS)}`);
}
if (require.main === module) {
    main().catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exit(1);
    });
}
