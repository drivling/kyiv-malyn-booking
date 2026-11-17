/**
 * Розклад Kyiv City Express для «Доведе»: `npm run dovede:ring [-- --fetch]` (у `frontend/`).
 *  - без прапорців — збирає `src/pages/DovedePage/data/kyivRingTimetable.json` із закоміченого знімка
 *    `data/kyiv-city-express/source/trains.json` і ручного `config.json` (строк дії додаткових рейсів);
 *  - `--fetch` — спершу оновлює знімок: сторінка «Рейси» kyivcityexpress.uz.gov.ua і сторінка кожного рейсу
 *    (близько 70 запитів з паузою). Локальний скрипт, не для CI: тести мережі не торкаються.
 * Після оновлення: `git diff` знімка покаже, які рейси змінились; `config.json` — перевірити дати рейсів «Д».
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTimetable, parseTrainList, parseTrainPage, timetableJson } from './kyiv-ring-parser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(root, 'data/kyiv-city-express');
const sourceFile = path.join(dataDir, 'source/trains.json');
const configFile = path.join(dataDir, 'config.json');
const outFile = path.join(root, 'frontend/src/pages/DovedePage/data/kyivRingTimetable.json');
const SITE = 'https://kyivcityexpress.uz.gov.ua';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function page(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function fetchSource() {
  const list = parseTrainList(await page(`${SITE}/train-routes`));
  if (list.stations.length !== 20 || list.trains.length < 40) throw new Error(`Сторінка «Рейси» змінилась: станцій ${list.stations.length}, рейсів ${list.trains.length}`);
  const trains = [];
  for (const t of list.trains) {
    const got = parseTrainPage(await page(t.url));
    if (got.name !== t.name) throw new Error(`${t.url}: у списку «${t.name}», на сторінці «${got.name}»`);
    trains.push(got);
    await new Promise((r) => setTimeout(r, 400));
  }
  return { fetchedAt: new Date().toISOString(), stations: list.stations, trains };
}

if (process.argv.includes('--fetch')) {
  const source = await fetchSource();
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  const body = `{\n  "fetchedAt": ${JSON.stringify(source.fetchedAt)},\n  "stations": [\n${source.stations.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ],\n  "trains": [\n${source.trains.map((t) => `    ${JSON.stringify(t)}`).join(',\n')}\n  ]\n}\n`;
  fs.writeFileSync(sourceFile, body);
  console.log(`Знімок: ${source.trains.length} рейсів, ${source.stations.length} станцій → ${path.relative(root, sourceFile)}`);
}

const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const tt = buildTimetable(source, config);
fs.writeFileSync(outFile, timetableJson(tt));
console.log(`Розклад: ${tt.trains.length} рейсів (${tt.trains.filter((t) => t.extra).length} додаткових) → ${path.relative(root, outFile)}`);
