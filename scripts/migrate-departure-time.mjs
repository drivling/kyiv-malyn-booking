#!/usr/bin/env node
/**
 * Normalize trip records: move clock times out of block_id into departure_time.
 *
 * Rules:
 * - HH:MM / HH:MM:SS in block_id → departure_time (HH:MM:SS), clear block_id
 * - Otherwise keep block_id as vehicle/block; leave departure_time unset
 * - Existing departure_time is kept; if block_id is still a time, clear it
 *
 * Usage:
 *   node scripts/migrate-departure-time.mjs
 *   node scripts/migrate-departure-time.mjs --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const transportPath = path.join(rootDir, 'data/malyn-transport/runtime/malyn_transport.json');
const dryRun = process.argv.includes('--dry-run');

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function toGtfsTime(raw) {
  const m = TIME_RE.exec(String(raw).trim());
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, '0');
  const mm = m[2];
  const ss = m[3] || '00';
  return `${hh}:${mm}:${ss}`;
}

function main() {
  const data = JSON.parse(fs.readFileSync(transportPath, 'utf8'));
  let moved = 0;
  let keptPlate = 0;
  let already = 0;

  for (const rec of data.records || []) {
    if (rec.departure_time && TIME_RE.test(String(rec.departure_time).trim())) {
      rec.departure_time = toGtfsTime(rec.departure_time);
      if (rec.block_id && toGtfsTime(rec.block_id)) {
        delete rec.block_id;
        moved++;
      } else {
        already++;
      }
      continue;
    }

    const fromBlock = rec.block_id ? toGtfsTime(rec.block_id) : null;
    if (fromBlock) {
      rec.departure_time = fromBlock;
      delete rec.block_id;
      moved++;
    } else if (rec.block_id) {
      keptPlate++;
    }
  }

  // Prefer departure_time in headers for documentation
  if (Array.isArray(data.headers) && !data.headers.includes('departure_time')) {
    const idx = data.headers.indexOf('block_id');
    if (idx >= 0) data.headers.splice(idx, 0, 'departure_time');
    else data.headers.push('departure_time');
  }
  if (data.headers_uk && !data.headers_uk.departure_time) {
    data.headers_uk.departure_time = 'Час відправлення з першої зупинки';
  }

  console.log(`Moved time → departure_time: ${moved}`);
  console.log(`Kept vehicle block_id: ${keptPlate}`);
  console.log(`Already had departure_time: ${already}`);

  if (dryRun) {
    console.log('Dry run — not writing.');
    return;
  }

  fs.writeFileSync(transportPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('Wrote', transportPath);
  execFileSync(process.execPath, [path.join(rootDir, 'scripts/sync-localtransport-data.mjs')], {
    stdio: 'inherit',
  });
}

main();
