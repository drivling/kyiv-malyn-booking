/**
 * Файли датасету міського транспорту Житомира: читає data/zhytomyr-transport/ (знімок zt.rozklad.in.ua, точки
 * зупинок, OSM, знімок EasyWay у easyway/, dataset-config.json) і повертає вміст dataset/zhytomyr-dataset.json і
 * dataset/REPORT.md. Скрипт zhytomyr-dataset їх пише, тест порівнює із закоміченими. Docs/zhytomyr-transport-2026-11.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { zhytomyrTimedDirections } from './zhytomyr-routes';
import type { OsmNamedStop } from './zhytomyr-stops';
import { parseEasywaySnapshot, type EwFiles, type EwSnapshot } from './zhytomyr-easyway';
import { buildZhytomyrDataset, type ZhytomyrDatasetConfig, type ZhytomyrDatasetResult } from './zhytomyr-dataset';

export const DATASET_FILE = 'dataset/zhytomyr-dataset.json';
export const REPORT_FILE = 'dataset/REPORT.md';
export const CONFIG_FILE = 'dataset-config.json';
export const EASYWAY_DIR = 'easyway';
/** що копіюємо зі знімка EasyWay у репозиторій (решта — службове) */
export const EASYWAY_FILES = ['README.md', 'routes.csv', 'stop_sequence.csv', 'departures.csv', 'electric_routes.csv'];

const read = (file: string): string | null => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function listRaw(dir: string, prefix = 'raw'): Record<string, string> {
  const out: Record<string, string> = {};
  const full = path.join(dir, prefix);
  if (!fs.existsSync(full)) return out;
  for (const name of fs.readdirSync(full).sort()) {
    const rel = `${prefix}/${name}`;
    if (fs.statSync(path.join(dir, rel)).isDirectory()) Object.assign(out, listRaw(dir, rel));
    else out[rel] = fs.readFileSync(path.join(dir, rel), 'utf8');
  }
  return out;
}

export function loadEasywayFiles(dir: string): EwFiles | null {
  if (!fs.existsSync(dir)) return null;
  return {
    routesCsv: read(path.join(dir, 'routes.csv')),
    stopSequenceCsv: read(path.join(dir, 'stop_sequence.csv')),
    departuresCsv: read(path.join(dir, 'departures.csv')),
    electricRoutesCsv: read(path.join(dir, 'electric_routes.csv')),
    raw: listRaw(dir),
  };
}

export function loadEasyway(root: string): EwSnapshot | null {
  const files = loadEasywayFiles(path.join(root, EASYWAY_DIR));
  return files ? parseEasywaySnapshot(files) : null;
}

export function buildZhytomyrDatasetFiles(root: string): { files: Record<string, string>; result: ZhytomyrDatasetResult } {
  const { routes, stops, dirs } = zhytomyrTimedDirections(root);
  const osm = (JSON.parse(fs.readFileSync(path.join(root, 'osm/stops.json'), 'utf8')) as { stops: OsmNamedStop[] }).stops;
  const fileConfig = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8')) as Omit<ZhytomyrDatasetConfig, 'zt'> & { zt?: Partial<ZhytomyrDatasetConfig['zt']> };
  const validFrom = routes.routes.flatMap((r) => r.directions.map((d) => d.validFrom)).find(Boolean) ?? null;
  const config: ZhytomyrDatasetConfig = { ...fileConfig, zt: { sourceUrl: routes.source, fetchedAt: routes.fetchedAt, validFrom, ...(fileConfig.zt ?? {}) } };
  const result = buildZhytomyrDataset({ timed: dirs, ztStops: stops, osm, easyway: loadEasyway(root), config });
  return {
    files: {
      [DATASET_FILE]: `${JSON.stringify(result.dataset, null, 2)}\n`,
      [REPORT_FILE]: `${result.report}\n`,
    },
    result,
  };
}
