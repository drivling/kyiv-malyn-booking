#!/usr/bin/env node
/**
 * Sync canonical local-transport runtime JSON to web + API consumers.
 *
 * Canonical: data/malyn-transport/runtime/
 * Targets:
 *   - frontend/public/data/          (static site)
 *   - frontend/src/pages/LocalTransportPage/segmentDurations.json (bundled)
 *
 * Usage:
 *   node scripts/sync-localtransport-data.mjs
 *   node scripts/sync-localtransport-data.mjs --check   # exit 1 if out of sync
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const runtimeDir = path.join(rootDir, 'data/malyn-transport/runtime');

const FILES = ['malyn_transport.json', 'stops_coords.json', 'segmentDurations.json'];

const TARGETS = [
  {
    name: 'frontend/public/data',
    dir: path.join(rootDir, 'frontend/public/data'),
    files: ['malyn_transport.json', 'stops_coords.json'],
  },
  {
    name: 'frontend LocalTransportPage',
    dir: path.join(rootDir, 'frontend/src/pages/LocalTransportPage'),
    files: ['segmentDurations.json'],
  },
];

function md5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureRuntime() {
  if (!fs.existsSync(runtimeDir)) {
    console.error('Canonical runtime missing:', runtimeDir);
    process.exit(1);
  }
  for (const f of FILES) {
    const p = path.join(runtimeDir, f);
    if (!fs.existsSync(p)) {
      console.error('Missing canonical file:', p);
      process.exit(1);
    }
  }
}

function checkSync() {
  let ok = true;
  for (const target of TARGETS) {
    for (const f of target.files) {
      const src = path.join(runtimeDir, f);
      const dest = path.join(target.dir, f);
      if (!fs.existsSync(dest)) {
        console.error(`[missing] ${target.name}/${f}`);
        ok = false;
        continue;
      }
      const a = md5(src);
      const b = md5(dest);
      if (a !== b) {
        console.error(`[drift] ${target.name}/${f}`);
        console.error(`  runtime ${a}`);
        console.error(`  target  ${b}`);
        ok = false;
      } else {
        console.log(`[ok] ${target.name}/${f}`);
      }
    }
  }
  return ok;
}

function sync() {
  for (const target of TARGETS) {
    fs.mkdirSync(target.dir, { recursive: true });
    for (const f of target.files) {
      const src = path.join(runtimeDir, f);
      const dest = path.join(target.dir, f);
      fs.copyFileSync(src, dest);
      console.log(`synced ${f} → ${target.name}/`);
    }
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  ensureRuntime();
  if (checkOnly) {
    const ok = checkSync();
    process.exit(ok ? 0 : 1);
  }
  sync();
  const ok = checkSync();
  if (!ok) {
    console.error('Sync finished but verification failed.');
    process.exit(1);
  }
  console.log('Local transport data is in sync.');
}

main();
