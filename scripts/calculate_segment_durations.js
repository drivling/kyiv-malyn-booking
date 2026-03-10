#!/usr/bin/env node
/**
 * Розрахунок часу між зупинками (секунди) для перевірених маршрутів за координатами.
 *
 * Логіка:
 * - Відстань між зупинками: haversine (простіший варіант).
 *   Складний варіант на потім: відстань по дорозі (shape/GTFS або OSRM), якщо з’явиться дані.
 * - Час сегменту = час зупинки (10–15 с) + час руху (відстань / швидкість).
 * - Швидкість у місті 30–40 км/год, при великій відстані між зупинками — до 40–50 км/год.
 * - Після розрахунку всього маршруту порівнюємо суму сегментів з часом "від першої до останньої по прямій";
 *   якщо сума значно більша — корекція: зменшуємо час на зупинках не більше ніж на 5–10%.
 *
 * Використання:
 *   node scripts/calculate_segment_durations.js           # усі перевірені маршрути
 *   node scripts/calculate_segment_durations.js --route=11  # тільки маршрут 11
 *
 * Потрібні файли:
 *   frontend/public/data/stops_coords.json
 *   frontend/public/data/malyn_transport.json
 *   frontend/src/pages/LocalTransportPage/segmentDurations.json (буде оновлено)
 */

const fs = require('fs');
const path = require('path');

const VERIFIED_ROUTE_IDS = ['3', '5', '7', '9', '11'];
const DEFAULT_SEC = 120;

// Час на зупинці: добратися, зупинитися, рушити (сек)
const STOP_TIME_SEC = 12; // 10–15 с, беремо 12

// Швидкість (км/год): у місті переважно 30–40, при довшому перегоні — до 50
const SPEED_KMH_URBAN = 35;
const SPEED_KMH_FAST = 45;
const SEGMENT_LONG_M = 600; // якщо перегон > 600 м, використовуємо FAST

// Корекція: якщо сума сегментів більша за direct_time на цей коефіцієнт — застосовуємо зменшення
const CORRECTION_THRESHOLD = 1.15; // 15% більше
const MAX_CORRECTION_FACTOR = 0.95; // не зменшувати час на зупинках більше ніж на 5%

function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // метри
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getOrderedStopNames(stopsByRoute, routeId, direction) {
  const stops = stopsByRoute[routeId];
  if (!Array.isArray(stops)) return [];
  const key = direction === 'there' ? 'order_there' : 'order_back';
  return stops
    .filter((s) => (s[key] ?? -1) > 0)
    .sort((a, b) => a[key] - b[key])
    .map((s) => s.name);
}

function segmentTimeSec(distanceM, stopTimeSec = STOP_TIME_SEC) {
  const speedKmh = distanceM >= SEGMENT_LONG_M ? SPEED_KMH_FAST : SPEED_KMH_URBAN;
  const driveSec = (distanceM / 1000 / speedKmh) * 3600;
  return Math.round(stopTimeSec + driveSec);
}

function main() {
  const args = process.argv.slice(2);
  let routeFilter = null;
  for (const a of args) {
    if (a.startsWith('--route=')) routeFilter = a.slice(8).trim();
  }

  const rootDir = path.join(__dirname, '..');
  const coordsPath = path.join(rootDir, 'frontend/public/data/stops_coords.json');
  const transportPath = path.join(rootDir, 'frontend/public/data/malyn_transport.json');
  const outPath = path.join(rootDir, 'frontend/src/pages/LocalTransportPage/segmentDurations.json');

  if (!fs.existsSync(coordsPath)) {
    console.error('Не знайдено:', coordsPath);
    process.exit(1);
  }
  if (!fs.existsSync(transportPath)) {
    console.error('Не знайдено:', transportPath);
    process.exit(1);
  }

  const coordsData = JSON.parse(fs.readFileSync(coordsPath, 'utf8'));
  const stopsCoords = coordsData?.stops || {};
  const transport = JSON.parse(fs.readFileSync(transportPath, 'utf8'));
  const stopsByRoute = transport?.supplement?.stops?.stops_by_route || {};

  let existing = { defaultSec: DEFAULT_SEC, segments: {} };
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  }

  const routesToProcess = routeFilter
    ? (VERIFIED_ROUTE_IDS.includes(routeFilter) ? [routeFilter] : [])
    : VERIFIED_ROUTE_IDS;

  if (routesToProcess.length === 0) {
    console.error('Маршрут не перевірений або не вказано. Перевірені:', VERIFIED_ROUTE_IDS.join(', '));
    process.exit(1);
  }

  // Видаляємо з existing.segments усі ключі для маршрутів, які зараз перераховуємо
  for (const routeId of routesToProcess) {
    Object.keys(existing.segments).forEach((k) => {
      if (k.startsWith(routeId + '|')) delete existing.segments[k];
    });
  }

  for (const routeId of routesToProcess) {
    const segmentsForRoute = [];
    for (const dir of ['there', 'back']) {
      const names = getOrderedStopNames(stopsByRoute, routeId, dir);
      for (let i = 0; i < names.length - 1; i++) {
        const a = names[i];
        const b = names[i + 1];
        const ca = stopsCoords[a];
        const cb = stopsCoords[b];
        let sec = DEFAULT_SEC;
        if (ca && cb && ca.length >= 2 && cb.length >= 2) {
          const distM = haversineDistanceM(ca[0], ca[1], cb[0], cb[1]);
          sec = Math.max(30, segmentTimeSec(distM));
        }
        const key = `${routeId}|${a}|${b}`;
        existing.segments[key] = sec;
        segmentsForRoute.push({ key, sec, names, dir, index: i });
      }
    }

    // Повний маршрут "туди": час від першої до останньої по прямій (без проміжних зупинок)
    const namesThere = getOrderedStopNames(stopsByRoute, routeId, 'there');
    if (namesThere.length >= 2) {
      const first = stopsCoords[namesThere[0]];
      const last = stopsCoords[namesThere[namesThere.length - 1]];
      if (first && last && first.length >= 2 && last.length >= 2) {
        const directDistM = haversineDistanceM(first[0], first[1], last[0], last[1]);
        const directTimeSec = (directDistM / 1000 / SPEED_KMH_URBAN) * 3600;

        const segmentKeysThere = [];
        for (let i = 0; i < namesThere.length - 1; i++) {
          segmentKeysThere.push(`${routeId}|${namesThere[i]}|${namesThere[i + 1]}`);
        }
        const sumSegmentSec = segmentKeysThere.reduce((s, k) => s + (existing.segments[k] || 0), 0);
        let driveTotal = 0;
        let stopTotal = 0;
        for (const k of segmentKeysThere) {
          const v = existing.segments[k];
          const stopPart = Math.min(v, STOP_TIME_SEC);
          driveTotal += v - stopPart;
          stopTotal += stopPart;
        }

        // Якщо сума сегментів значно більша за "прямий" час — зменшуємо тільки час на зупинках (не більше 5–10%)
        if (directTimeSec > 0 && sumSegmentSec > directTimeSec * CORRECTION_THRESHOLD && stopTotal > 0) {
          const targetTotalSec = directTimeSec * 1.08; // ціль: до 8% над прямим часом
          const targetStopTotal = Math.max(0, targetTotalSec - driveTotal);
          const factor = Math.max(0.90, Math.min(1, targetStopTotal / stopTotal)); // зменшення не більше 10%
          for (const k of segmentKeysThere) {
            const v = existing.segments[k];
            const stopPart = Math.min(v, STOP_TIME_SEC);
            const drivePart = v - stopPart;
            const newStopPart = Math.round(stopPart * factor);
            existing.segments[k] = Math.max(30, drivePart + newStopPart);
          }
        }
      }
    }
  }

  existing.defaultSec = existing.defaultSec || DEFAULT_SEC;
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2), 'utf8');
  console.log('Оновлено', outPath);
  console.log('Маршрути:', routesToProcess.join(', '));
  console.log('Сегментів у файлі:', Object.keys(existing.segments).length);
}

main();
