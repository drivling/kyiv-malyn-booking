/**
 * Файли чернетки датасету Коростеня: читає data/korosten-transport/ (джерела ради, проєкт 2025, знімки OSM і Google,
 * dataset-config.json) і повертає вміст dataset/korosten-dataset.json і dataset/REPORT.md. Скрипт korosten-dataset
 * їх пише, тест порівнює із закоміченими. Docs/korosten-transport-data-2026-11.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadKorostenProject } from './korosten-project-files';
import { parseOfficialStops } from './korosten-stop-aliases';
import type { OsmSnapshot } from './korosten-osm';
import {
  buildKorostenDataset,
  type GoogleCheck,
  type KorostenDatasetConfig,
  type KorostenDatasetInput,
  type KorostenDatasetResult,
  type RouteCsvRow,
  type StreetPoint,
} from './korosten-dataset';

export const DATASET_FILE = 'dataset/korosten-dataset.json';
export const REPORT_FILE = 'dataset/REPORT.md';
export const OSM_SNAPSHOT_FILE = 'osm/snapshot.json';
export const OSM_STREETS_FILE = 'osm/streets.json';
export const GOOGLE_CHECK_FILE = 'google/check.json';
export const CONFIG_FILE = 'dataset-config.json';

/** routes.csv ради: роздільник «;», поля uid, fullName, description */
export function parseRoutesCsv(csv: string): RouteCsvRow[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(';');
  const col = (name: string): number => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cells = line.split(';');
    return { uid: cells[col('uid')].trim(), fullName: (cells[col('fullName')] ?? '').trim(), description: (cells[col('description')] ?? '').trim() };
  });
}

const readJson = <T>(file: string): T | null => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null);

export function loadKorostenDatasetInput(root: string): KorostenDatasetInput {
  const { directions, timetable, aliases } = loadKorostenProject(root);
  const streets = readJson<{ streets: Record<string, StreetPoint | null> }>(path.join(root, OSM_STREETS_FILE));
  return {
    official: parseOfficialStops(fs.readFileSync(path.join(root, 'source', 'stops.csv'), 'utf8')),
    aliases,
    directions,
    timetable,
    routesCsv: parseRoutesCsv(fs.readFileSync(path.join(root, 'source', 'routes.csv'), 'utf8')),
    config: readJson<KorostenDatasetConfig>(path.join(root, CONFIG_FILE)) as KorostenDatasetConfig,
    osm: readJson<OsmSnapshot>(path.join(root, OSM_SNAPSHOT_FILE)),
    streets: streets?.streets ?? null,
    google: readJson<GoogleCheck>(path.join(root, GOOGLE_CHECK_FILE)),
  };
}

export function buildKorostenDatasetFiles(root: string): { files: Record<string, string>; result: KorostenDatasetResult } {
  const result = buildKorostenDataset(loadKorostenDatasetInput(root));
  return {
    files: {
      [DATASET_FILE]: `${JSON.stringify(result.dataset, null, 2)}\n`,
      [REPORT_FILE]: `${result.report}\n`,
    },
    result,
  };
}
