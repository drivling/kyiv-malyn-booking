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
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from '../zip';
import { buildKptData, renderKptDataTs, renderKptReport } from '../dovede/kyiv-kpt';
import { buildTaxiData, renderTaxiDataTs, renderTaxiSnapshot, taxiSnapshotFrom, type TaxiSnapshot } from '../dovede/kyiv-taxi';

export const KPT_DIR = path.resolve(__dirname, '../../../data/kyiv-transport/kpt-gtfs');
export const KPT_ZIP = path.join(KPT_DIR, 'gtfs_static.zip');
export const KPT_DATA_TS = path.resolve(__dirname, '../../src/dovede/kyiv-kpt-data.ts');
export const TAXI_JSON = path.resolve(__dirname, '../../../data/kyiv-transport/taxi/routes.json');
export const TAXI_DATA_TS = path.resolve(__dirname, '../../src/dovede/kyiv-taxi-data.ts');
/** Набір «Маршрутні таксі» міста Києва на data.kyivcity.gov.ua (CKAN datastore; публічна сторінка) */
const TAXI_URL = 'https://data.kyivcity.gov.ua/api/3/action/datastore_search?resource_id=e9d7590e-55ff-4d5d-8b5a-251900ef1967&limit=1000';

export const readTaxiSnapshot = (): TaxiSnapshot => JSON.parse(fs.readFileSync(TAXI_JSON, 'utf8')) as TaxiSnapshot;

/** Текстові файли архіву: ім'я без шляху → вміст */
export function readKptZip(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readZip(fs.readFileSync(file))) {
    const name = e.name.split('/').pop() ?? e.name;
    if (name.endsWith('.txt')) out[name] = e.data.toString('utf8');
  }
  return out;
}

async function main(): Promise<void> {
  const src = process.argv[2];
  if (src === '--fetch') {
    const url = process.env.KPT_GTFS_URL;
    if (!url) throw new Error('KPT_GTFS_URL не задано: адресу експорту GTFS «Київпастрансу» має власник');
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Експорт КПТ відповів HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Експорт КПТ віддав не ZIP');
    fs.mkdirSync(KPT_DIR, { recursive: true });
    fs.writeFileSync(KPT_ZIP, buf);
  } else if (src === '--fetch-taxi') {
    const res = await fetch(TAXI_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Перелік маршруток відповів HTTP ${res.status}`);
    const snap = taxiSnapshotFrom(await res.json(), new Date().toISOString().slice(0, 10));
    fs.mkdirSync(path.dirname(TAXI_JSON), { recursive: true });
    fs.writeFileSync(TAXI_JSON, renderTaxiSnapshot(snap));
  } else if (src) {
    fs.mkdirSync(KPT_DIR, { recursive: true });
    fs.copyFileSync(path.resolve(src), KPT_ZIP);
  }
  const { data, report } = buildKptData(readKptZip(KPT_ZIP));
  fs.writeFileSync(KPT_DATA_TS, renderKptDataTs(data));
  fs.writeFileSync(path.join(KPT_DIR, 'REPORT.md'), renderKptReport(data, report));
  const taxi = buildTaxiData(readTaxiSnapshot());
  fs.writeFileSync(TAXI_DATA_TS, renderTaxiDataTs(taxi));
  console.log(`Маршрутки: ${taxi.routes.length} (знімок ${taxi.fetchedAt}) → ${path.relative(process.cwd(), TAXI_DATA_TS)}`);
  console.log(`КПТ ${data.version}: маршрутів ${report.routes}, напрямків ${report.dirs}, рейсів ${report.trips}; ${fs.statSync(KPT_DATA_TS).size} байт → ${path.relative(process.cwd(), KPT_DATA_TS)}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
