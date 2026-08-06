#!/usr/bin/env node
/**
 * Обгортка: перерахунок сегментів міського транспорту через OSRM → PostgreSQL.
 *
 *   node scripts/calculate_segment_durations.js
 *   node scripts/calculate_segment_durations.js --route=11
 *
 * Реалізація: backend/src/scripts/calculate-segment-durations.ts
 * (після правок у адмінці спочатку «Зберегти в базу», потім цей скрипт).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const result = spawnSync(
  'npx',
  ['ts-node', 'src/scripts/calculate-segment-durations.ts', ...process.argv.slice(2)],
  { cwd: backendDir, stdio: 'inherit', shell: process.platform === 'win32' }
);
process.exit(result.status == null ? 1 : result.status);
