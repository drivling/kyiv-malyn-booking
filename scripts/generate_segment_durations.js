/**
 * Генерує frontend/src/pages/LocalTransportPage/segmentDurations.json
 * з тривалостями між сусідніми зупинками (секунди) для маршрутів 3, 5, 7, 9, 11.
 * Читає зупинки з frontend/public/data/malyn_transport.json.
 * Запуск: node scripts/generate_segment_durations.js
 *
 * JSON можна потім редагувати вручну (реальні дані замість 120 с).
 */

const fs = require('fs');
const path = require('path');

const VERIFIED_ROUTE_IDS = ['3', '5', '7', '9', '11'];
const DURATION_SEC = 120; // 2 хв

const jsonPath = path.join(__dirname, '../frontend/public/data/malyn_transport.json');
const outPath = path.join(__dirname, '../frontend/src/pages/LocalTransportPage/segmentDurations.json');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const stopsByRoute = data?.supplement?.stops?.stops_by_route || {};

function getOrderedStopNames(routeId, direction) {
  const stops = stopsByRoute[routeId];
  if (!Array.isArray(stops)) return [];
  const key = direction === 'there' ? 'order_there' : 'order_back';
  return stops
    .filter((s) => (s[key] ?? -1) > 0)
    .sort((a, b) => a[key] - b[key])
    .map((s) => s.name);
}

const segments = {};
for (const routeId of VERIFIED_ROUTE_IDS) {
  for (const dir of ['there', 'back']) {
    const names = getOrderedStopNames(routeId, dir);
    for (let i = 0; i < names.length - 1; i++) {
      const key = `${routeId}|${names[i]}|${names[i + 1]}`;
      segments[key] = DURATION_SEC;
    }
  }
}

const output = {
  defaultSec: 120,
  segments,
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log('Written', outPath, 'with', Object.keys(segments).length, 'segments');
console.log('Edit segmentDurations.json to set real durations (seconds). Run again after transport JSON changes.');
