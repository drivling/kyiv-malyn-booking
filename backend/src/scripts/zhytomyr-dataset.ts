/**
 * Датасет міського транспорту Житомира (Docs/zhytomyr-transport-2026-11.md):
 *
 * npm run zhytomyr:dataset                              — без мережі: data/zhytomyr-transport/** →
 *                                                         dataset/zhytomyr-dataset.json і dataset/REPORT.md
 *                                                         (перевірка тим самим валідатором, що й PUT)
 * npm run zhytomyr:dataset -- --easyway-from <тека>     — спершу скопіювати знімок EasyWay (CSV, README, raw/) у
 *                                                         data/zhytomyr-transport/easyway/; тека-джерело не змінюється
 * npm run zhytomyr:dataset -- --dry-run                 — показати, що зміниться в базі (GET ?city=Zhytomyr)
 * npm run zhytomyr:dataset -- --apply                   — записати в базу: GET → бекап → PUT ?city=Zhytomyr з
 *                                                         baseRevision → GET і порівняння. Токен — ADMIN_TOKEN або
 *                                                         VIBER_ADMIN_TOKEN. Людям сторінки видно лише після
 *                                                         прапорця «Міський транспорт» Житомира в адмінці.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTransportDataset, type TransportDataset } from '../local-transport';
import { DATASET_FILE, EASYWAY_DIR, EASYWAY_FILES, buildZhytomyrDatasetFiles } from '../zhytomyr-dataset-files';

const ROOT = path.resolve(__dirname, '../../../data/zhytomyr-transport');
const CITY = 'Zhytomyr';
const has = (flag: string): boolean => process.argv.includes(flag);
const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

function write(file: string, content: string): void {
  const full = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log(`${file}: ${content.length} chars`);
}

/** Знімок EasyWay → data/zhytomyr-transport/easyway/ (лише CSV, README і raw/; тека-джерело — тільки читання) */
function copyEasyway(from: string): void {
  const to = path.join(ROOT, EASYWAY_DIR);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const name of EASYWAY_FILES) if (fs.existsSync(path.join(from, name))) fs.copyFileSync(path.join(from, name), path.join(to, name));
  const raw = path.join(from, 'raw');
  if (fs.existsSync(raw)) fs.cpSync(raw, path.join(to, 'raw'), { recursive: true, filter: (src) => fs.statSync(src).isDirectory() || /\.(txt|json|psv|csv)$/.test(src) });
  console.log(`${EASYWAY_DIR}/: скопійовано з ${from}`);
}

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function apiBase(): string {
  if (process.env.API_BASE) return process.env.API_BASE.replace(/\/$/, '');
  const src = fs.readFileSync(path.resolve(__dirname, '../../../frontend/scripts/api-base.mjs'), 'utf8');
  const m = /'(https:\/\/[^']+)'/.exec(src);
  if (!m) throw new Error('API base not found in frontend/scripts/api-base.mjs');
  return m[1];
}

/** Порядок і поля, які повертає GET, — для порівняння «після PUT = кандидат» */
function canon(d: TransportDataset): string {
  const sort = <T>(xs: T[], key: (t: T) => string): T[] => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
  return JSON.stringify({
    stops: sort(d.stops ?? [], (s) => s.id).map((s) => [s.id, s.name, s.lat, s.lng]),
    routes: sort(d.routes ?? [], (r) => r.id).map((r) => [r.id, r.fromName, r.toName, r.shortName ?? '']),
    routeStops: sort(d.routeStops ?? [], (r) => `${r.routeId}|${r.stopId}`).map((r) => [r.routeId, r.stopId, r.orderThere, r.orderBack]),
    trips: sort(d.trips ?? [], (t) => t.id).map((t) => [t.id, t.routeId, t.serviceId, t.directionId, t.departureTime]),
    segments: sort(d.segments ?? [], (s) => `${s.routeId}|${s.fromStopId}|${s.toStopId}`).map((s) => [s.routeId, s.fromStopId, s.toStopId, s.seconds]),
  });
}

async function apply(candidate: TransportDataset, dry: boolean): Promise<void> {
  const token = process.env.ADMIN_TOKEN || process.env.VIBER_ADMIN_TOKEN || '';
  if (!token) throw new Error('ADMIN_TOKEN (або VIBER_ADMIN_TOKEN) не задано');
  const auth = { Authorization: token };
  const url = `${apiBase()}/transport/dataset?city=${CITY}`;
  const current = (await getJson(url, { headers: auth })) as TransportDataset & { revision?: string | null };
  const count = (d: Partial<TransportDataset>): string =>
    `зупинок ${d.stops?.length ?? 0}, маршрутів ${d.routes?.length ?? 0}, рейсів ${d.trips?.length ?? 0}, сегментів ${d.segments?.length ?? 0}`;
  console.log(`зараз у базі (${CITY}): ${count(current)}; ревізія ${current.revision ?? '—'}`);
  console.log(`датасет: ${count(candidate)}`);
  if (canon(current) === canon(candidate)) {
    console.log('у базі вже цей датасет — нічого не робимо');
    return;
  }
  if (dry) {
    console.log('без --apply нічого не записано');
    return;
  }
  const dir = path.join(os.homedir(), 'zhytomyr-backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(current, null, 2));
  console.log(`бекап: ${backup}`);
  const meta = { ...(current.meta ?? {}), ...candidate.meta };
  const put = (await getJson(url, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...candidate, meta, baseRevision: current.revision ?? undefined }),
  })) as { revision?: string };
  console.log(`PUT ok, ревізія ${put.revision ?? '—'}`);
  const after = (await getJson(url, { headers: auth })) as TransportDataset;
  if (canon(after) !== canon(candidate)) throw new Error('після PUT база відрізняється від датасету — перевірте бекап і звіт');
  console.log('перевірка: база = датасет');
}

async function main(): Promise<void> {
  const from = arg('--easyway-from');
  if (from) copyEasyway(path.resolve(from));
  const { files, result } = buildZhytomyrDatasetFiles(ROOT);
  const { errors } = validateTransportDataset(JSON.parse(JSON.stringify(result.dataset)));
  if (errors.length) throw new Error(`датасет не проходить валідацію PUT:\n${errors.join('\n')}`);
  for (const [file, content] of Object.entries(files)) write(file, content);
  const d = result.dataset;
  console.log(`${DATASET_FILE}: зупинок ${d.stops.length}, маршрутів ${d.routes.length}, рейсів ${d.trips.length}, сегментів ${d.segments.length}`);
  if (has('--apply') || has('--dry-run')) await apply(d, !has('--apply'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
