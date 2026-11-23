"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTaxiSnapshot = exports.TAXI_DATA_TS = exports.TAXI_JSON = exports.KPT_DATA_TS = exports.KPT_ZIP = exports.KPT_DIR = void 0;
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
 * npm run kyiv:kpt -- --fetch-taxi     — свіжий перелік маршруток Києва (data.kyivcity.gov.ua, крок 8б) у
 *                                        data/kyiv-transport/taxi/routes.json; далі те саме
 *
 * Щоразу пише й backend/src/dovede/kyiv-taxi-data.ts зі знімка маршруток.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const zip_1 = require("../zip");
const kyiv_kpt_1 = require("../dovede/kyiv-kpt");
const kyiv_taxi_1 = require("../dovede/kyiv-taxi");
exports.KPT_DIR = node_path_1.default.resolve(__dirname, '../../../data/kyiv-transport/kpt-gtfs');
exports.KPT_ZIP = node_path_1.default.join(exports.KPT_DIR, 'gtfs_static.zip');
exports.KPT_DATA_TS = node_path_1.default.resolve(__dirname, '../../src/dovede/kyiv-kpt-data.ts');
exports.TAXI_JSON = node_path_1.default.resolve(__dirname, '../../../data/kyiv-transport/taxi/routes.json');
exports.TAXI_DATA_TS = node_path_1.default.resolve(__dirname, '../../src/dovede/kyiv-taxi-data.ts');
/** Набір «Маршрутні таксі» міста Києва на data.kyivcity.gov.ua (CKAN datastore; публічна сторінка) */
const TAXI_URL = 'https://data.kyivcity.gov.ua/api/3/action/datastore_search?resource_id=e9d7590e-55ff-4d5d-8b5a-251900ef1967&limit=1000';
const readTaxiSnapshot = () => JSON.parse(node_fs_1.default.readFileSync(exports.TAXI_JSON, 'utf8'));
exports.readTaxiSnapshot = readTaxiSnapshot;
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
    else if (src === '--fetch-taxi') {
        const res = await fetch(TAXI_URL, { signal: AbortSignal.timeout(60000) });
        if (!res.ok)
            throw new Error(`Перелік маршруток відповів HTTP ${res.status}`);
        const snap = (0, kyiv_taxi_1.taxiSnapshotFrom)(await res.json(), new Date().toISOString().slice(0, 10));
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(exports.TAXI_JSON), { recursive: true });
        node_fs_1.default.writeFileSync(exports.TAXI_JSON, (0, kyiv_taxi_1.renderTaxiSnapshot)(snap));
    }
    else if (src) {
        node_fs_1.default.mkdirSync(exports.KPT_DIR, { recursive: true });
        node_fs_1.default.copyFileSync(node_path_1.default.resolve(src), exports.KPT_ZIP);
    }
    const { data, report } = (0, kyiv_kpt_1.buildKptData)(readKptZip(exports.KPT_ZIP));
    node_fs_1.default.writeFileSync(exports.KPT_DATA_TS, (0, kyiv_kpt_1.renderKptDataTs)(data));
    node_fs_1.default.writeFileSync(node_path_1.default.join(exports.KPT_DIR, 'REPORT.md'), (0, kyiv_kpt_1.renderKptReport)(data, report));
    const taxi = (0, kyiv_taxi_1.buildTaxiData)((0, exports.readTaxiSnapshot)());
    node_fs_1.default.writeFileSync(exports.TAXI_DATA_TS, (0, kyiv_taxi_1.renderTaxiDataTs)(taxi));
    console.log(`Маршрутки: ${taxi.routes.length} (знімок ${taxi.fetchedAt}) → ${node_path_1.default.relative(process.cwd(), exports.TAXI_DATA_TS)}`);
    console.log(`КПТ ${data.version}: маршрутів ${report.routes}, напрямків ${report.dirs}, рейсів ${report.trips}; ${node_fs_1.default.statSync(exports.KPT_DATA_TS).size} байт → ${node_path_1.default.relative(process.cwd(), exports.KPT_DATA_TS)}`);
}
if (require.main === module) {
    main().catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exit(1);
    });
}
