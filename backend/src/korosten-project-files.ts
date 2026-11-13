/**
 * Похідні файли з проєкту власника 2025 року: читає data/korosten-transport/ (project-2025/html, source/,
 * stop-aliases.hints.json) і повертає вміст chains.json, stop-aliases.json і REPORT.md. Скрипт знімка їх пише,
 * тест порівнює із закоміченими. Docs/korosten-transport-2026-11.md, фаза 2б.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseProjectDirection, type ProjectDirection } from './korosten-project-parser';
import { buildProjectReport } from './korosten-project-report';
import type { SourceTimetable } from './korosten-source-parser';
import { buildStopAliases, parseOfficialStops, type AliasHints, type StopAliases } from './korosten-stop-aliases';

export function loadKorostenProject(root: string): { directions: ProjectDirection[]; timetable: SourceTimetable; aliases: StopAliases } {
  const htmlDir = path.join(root, 'project-2025', 'html');
  const directions = fs
    .readdirSync(htmlDir)
    .filter((f) => /^\d\d\.html$/.test(f))
    .sort()
    .map((f) => parseProjectDirection(fs.readFileSync(path.join(htmlDir, f), 'utf8'), f.slice(0, 2)));
  const timetable = JSON.parse(fs.readFileSync(path.join(root, 'source', 'timetable.json'), 'utf8')) as SourceTimetable;
  const hints = JSON.parse(fs.readFileSync(path.join(root, 'stop-aliases.hints.json'), 'utf8')) as AliasHints;
  const names = directions.flatMap((d) => d.stops.map((s) => ({ name: s.name, source: `project-2025:${d.code}` })));
  for (const route of timetable.routes) {
    for (const run of route.runs) {
      for (const name of [run.from, run.to, ...run.via]) names.push({ name, source: `rada:№${route.number}` });
    }
  }
  const official = parseOfficialStops(fs.readFileSync(path.join(root, 'source', 'stops.csv'), 'utf8'));
  return { directions, timetable, aliases: buildStopAliases(names, official, hints) };
}

/** Шлях відносно data/korosten-transport/ → вміст файлу */
export function buildKorostenProjectFiles(root: string): Record<string, string> {
  const { directions, timetable, aliases } = loadKorostenProject(root);
  return {
    'project-2025/chains.json': `${JSON.stringify({ directions }, null, 2)}\n`,
    'stop-aliases.json': `${JSON.stringify(aliases, null, 2)}\n`,
    'project-2025/REPORT.md': buildProjectReport(directions, timetable, aliases),
  };
}
