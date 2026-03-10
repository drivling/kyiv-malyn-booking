#!/usr/bin/env node
/**
 * Розрахунок часу між зупинками (секунди) для перевірених маршрутів.
 * Використовує реальні маршрути по дорогах (OSRM), не haversine.
 * Корекція по всьому маршруту вимкнена — лишаємо розрахований час по сегментах.
 *
 * Логіка:
 * - Відстань між зупинками: OSRM (router.project-osrm.org), відстань по дорозі.
 * - Час сегменту = час зупинки (12 с) + час руху (відстань / швидкість).
 * - Швидкість у місті 35 км/год, при перегоні > 600 м — 45 км/год.
 * - Корекція підвищення: якщо час маршруту при 24 км/год (відстань по дорозі / 24) більший
 *   за суму поточних сегментів — множимо час кожного сегменту на коефіцієнт (щоб сума ≈ час при 24 км/год).
 *
 * Використання:
 *   node scripts/calculate_segment_durations.js           # усі перевірені маршрути
 *   node scripts/calculate_segment_durations.js --route=11 # тільки маршрут 11
 *
 * Потрібні: мережевий доступ, frontend/public/data/stops_coords.json, malyn_transport.json.
 * Результат: frontend/src/pages/LocalTransportPage/segmentDurations.json
 */

const fs = require('fs');
const path = require('path');

const VERIFIED_ROUTE_IDS = ['2', '3', '5', '7', '9', '11'];
const DEFAULT_SEC = 120;
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const DELAY_MS = 300;

const STOP_TIME_SEC = 12;
const SPEED_KMH_URBAN = 35;
const SPEED_KMH_FAST = 45;
const SEGMENT_LONG_M = 600;
/** Швидкість для кореляції всього маршруту: якщо час при цій швидкості більший за суму сегментів — підвищуємо час сегментів */
const CORRELATION_SPEED_KMH = 24;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function segmentTimeSecFromDistanceM(distanceM) {
  const speedKmh = distanceM >= SEGMENT_LONG_M ? SPEED_KMH_FAST : SPEED_KMH_URBAN;
  const driveSec = (distanceM / 1000 / speedKmh) * 3600;
  return Math.round(STOP_TIME_SEC + driveSec);
}

async function fetchOsrmRoute(lon1, lat1, lon2, lat2) {
  const coords = `${lon1},${lat1};${lon2},${lat2}`;
  const url = `${OSRM_BASE}/${coords}?overview=false`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { distance: null, duration: null };
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) return { distance: null, duration: null };
    return {
      distance: data.routes[0].distance,
      duration: data.routes[0].duration,
    };
  } catch (e) {
    clearTimeout(timeout);
    return { distance: null, duration: null };
  }
}

async function main() {
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

  for (const routeId of routesToProcess) {
    Object.keys(existing.segments).forEach((k) => {
      if (k.startsWith(routeId + '|')) delete existing.segments[k];
    });
  }

  let requested = 0;
  let failed = 0;
  /** Відстань по дорозі (м) для кожного сегменту — для кореляції при 24 км/год */
  const segmentDistancesM = {};

  for (const routeId of routesToProcess) {
    for (const dir of ['there', 'back']) {
      const names = getOrderedStopNames(stopsByRoute, routeId, dir);
      for (let i = 0; i < names.length - 1; i++) {
        const a = names[i];
        const b = names[i + 1];
        const ca = stopsCoords[a];
        const cb = stopsCoords[b];
        const key = `${routeId}|${a}|${b}`;

        if (!ca || !cb || ca.length < 2 || cb.length < 2) {
          existing.segments[key] = DEFAULT_SEC;
          continue;
        }

        const [lat1, lon1] = ca;
        const [lat2, lon2] = cb;
        requested++;
        const { distance: distM } = await fetchOsrmRoute(lon1, lat1, lon2, lat2);
        await sleep(DELAY_MS);

        if (distM != null && distM > 0) {
          segmentDistancesM[key] = distM;
          existing.segments[key] = Math.max(30, segmentTimeSecFromDistanceM(distM));
        } else {
          existing.segments[key] = DEFAULT_SEC;
          failed++;
        }
      }
    }
  }

  // Корекція підвищення: якщо час при 24 км/год більший за суму сегментів — підвищуємо час сегментів
  for (const routeId of routesToProcess) {
    for (const dir of ['there', 'back']) {
      const names = getOrderedStopNames(stopsByRoute, routeId, dir);
      const keys = [];
      for (let i = 0; i < names.length - 1; i++) {
        keys.push(`${routeId}|${names[i]}|${names[i + 1]}`);
      }
      let totalDistM = 0;
      let totalTimeSec = 0;
      for (const k of keys) {
        if (segmentDistancesM[k] != null) totalDistM += segmentDistancesM[k];
        totalTimeSec += existing.segments[k] || 0;
      }
      if (totalDistM <= 0 || totalTimeSec <= 0) continue;
      const timeAt24Sec = (totalDistM / 1000 / CORRELATION_SPEED_KMH) * 3600;
      if (timeAt24Sec > totalTimeSec) {
        const factor = timeAt24Sec / totalTimeSec;
        for (const k of keys) {
          const v = existing.segments[k];
          if (v != null) existing.segments[k] = Math.max(30, Math.round(v * factor));
        }
        console.log(
          `Корекція ${routeId} ${dir}: час при ${CORRELATION_SPEED_KMH} км/год ${Math.round(timeAt24Sec)} с > сума ${totalTimeSec} с → фактор ${factor.toFixed(3)}`
        );
      }
    }
  }

  existing.defaultSec = existing.defaultSec || DEFAULT_SEC;
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2), 'utf8');
  console.log('Оновлено', outPath);
  console.log('Маршрути:', routesToProcess.join(', '));
  console.log('Сегментів у файлі:', Object.keys(existing.segments).length);
  console.log('Запитів OSRM:', requested, ', без відповіді (fallback ' + DEFAULT_SEC + ' с):', failed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
