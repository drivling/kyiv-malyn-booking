#!/usr/bin/env node
/**
 * Конвертує stops_by_route з string[] до RouteStopWithOrder[].
 * order_there = 1..N (туди: from → to), order_back = N..1 (назад: to → from).
 */
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '../frontend/public/data/malyn_transport.json');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const sbr = data.supplement?.stops?.stops_by_route;
if (!sbr) {
  console.error('stops_by_route не знайдено');
  process.exit(1);
}

const converted = {};
for (const [routeId, stops] of Object.entries(sbr)) {
  if (Array.isArray(stops) && stops.length > 0) {
    const first = stops[0];
    if (typeof first === 'string') {
      const n = stops.length;
      converted[routeId] = stops.map((name, i) => ({
        name,
        order_there: i + 1,
        order_back: n - i,
        belongs_to: 'both',
      }));
    } else {
      converted[routeId] = stops;
    }
  }
}

data.supplement.stops.stops_by_route = converted;
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Конвертовано маршрутів:', Object.keys(converted).length);
