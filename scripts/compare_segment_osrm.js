#!/usr/bin/env node
/**
 * Порівняння: відстань по прямій (haversine) vs відстань по дорозі (OSRM).
 * Отримує реальний маршрут між зупинками через OSRM, рахує час за тією ж формулою
 * (зупинка 12 с + рух за швидкістю 35/45 км/год), зберігає результат у segmentDurations_osrm.json
 * і виводить найбільші різниці з поточним segmentDurations.json.
 *
 * Потрібен мережевий доступ. Запуск: node scripts/compare_segment_osrm.js
 */

const fs = require('fs');
const path = require('path');

const VERIFIED_ROUTE_IDS = ['2', '3', '5', '7', '8', '9', '11', '12'];
const DELAY_MS = 250;
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

const STOP_TIME_SEC = 12;
const SPEED_KMH_URBAN = 35;
const SPEED_KMH_FAST = 45;
const SEGMENT_LONG_M = 600;

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

async function fetchOsmRoute(lon1, lat1, lon2, lat2) {
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
  const rootDir = path.join(__dirname, '..');
  const coordsPath = path.join(rootDir, 'frontend/public/data/stops_coords.json');
  const transportPath = path.join(rootDir, 'frontend/public/data/malyn_transport.json');
  const currentPath = path.join(rootDir, 'frontend/src/pages/LocalTransportPage/segmentDurations.json');
  const outPath = path.join(rootDir, 'frontend/src/pages/LocalTransportPage/segmentDurations_osrm.json');

  const coordsData = JSON.parse(fs.readFileSync(coordsPath, 'utf8'));
  const stopsCoords = coordsData?.stops || {};
  const transport = JSON.parse(fs.readFileSync(transportPath, 'utf8'));
  const stopsByRoute = transport?.supplement?.stops?.stops_by_route || {};
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const segmentsHaversine = current.segments || {};

  const segmentsOsrm = { ...segmentsHaversine };
  const comparisons = [];

  let requested = 0;
  let failed = 0;

  let routesToUse = VERIFIED_ROUTE_IDS;
  let limitSegments = Infinity;
  process.argv.forEach((a) => {
    if (a.startsWith('--route=')) {
      const id = a.slice(8).trim();
      if (VERIFIED_ROUTE_IDS.includes(id)) routesToUse = [id];
    }
    if (a.startsWith('--limit=')) limitSegments = parseInt(a.slice(8), 10) || Infinity;
  });

  let segmentCount = 0;
  for (const routeId of routesToUse) {
    if (segmentCount >= limitSegments) break;
    for (const dir of ['there', 'back']) {
      const names = getOrderedStopNames(stopsByRoute, routeId, dir);
      for (let i = 0; i < names.length - 1; i++) {
        if (segmentCount >= limitSegments) break;
        const a = names[i];
        const b = names[i + 1];
        const ca = stopsCoords[a];
        const cb = stopsCoords[b];
        const key = `${routeId}|${a}|${b}`;
        const haversineSec = segmentsHaversine[key] ?? 120;

        if (!ca || !cb || ca.length < 2 || cb.length < 2) {
          comparisons.push({ key, routeId, from: a, to: b, haversineSec, osrmSec: haversineSec, diff: 0, noCoords: true });
          continue;
        }

        const [lat1, lon1] = ca;
        const [lat2, lon2] = cb;
        segmentCount++;
        requested++;
        const { distance: distM } = await fetchOsmRoute(lon1, lat1, lon2, lat2);
        await sleep(DELAY_MS);

        let osrmSec = 120;
        if (distM != null && distM > 0) {
          osrmSec = Math.max(30, segmentTimeSecFromDistanceM(distM));
          segmentsOsrm[key] = osrmSec;
        } else {
          failed++;
        }

        const diff = osrmSec - haversineSec;
        const diffPct = haversineSec > 0 ? (diff / haversineSec) * 100 : 0;
        comparisons.push({
          key,
          routeId,
          from: a,
          to: b,
          haversineSec,
          osrmSec,
          diff,
          diffPct,
        });
      }
    }
  }

  fs.writeFileSync(
    outPath,
    JSON.stringify({ defaultSec: current.defaultSec || 120, segments: segmentsOsrm }, null, 2),
    'utf8'
  );
  console.log('Збережено OSRM-варіант:', outPath);
  console.log('Запитів OSRM:', requested, ', не вдалося:', failed);
  console.log('');

  const withDiff = comparisons.filter((c) => !c.noCoords && c.haversineSec > 0);
  const byAbsDiff = [...withDiff].sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  const avgDiff = withDiff.length ? withDiff.reduce((s, c) => s + c.diff, 0) / withDiff.length : 0;
  const maxDiff = byAbsDiff[0];
  const minDiff = byAbsDiff[byAbsDiff.length - 1];

  console.log('--- Підсумок ---');
  console.log('Середня різниця (OSRM − haversine):', avgDiff.toFixed(1), 'с');
  if (maxDiff) {
    console.log('Макс. різниця:', maxDiff.diff, 'с', `(${maxDiff.diffPct.toFixed(0)}%)`, '—', maxDiff.routeId, '|', maxDiff.from, '→', maxDiff.to);
  }
  console.log('');

  console.log('--- Топ-25 сегментів з найбільшою різницею (OSRM довший за haversine) ---');
  const topLonger = byAbsDiff.filter((c) => c.diff > 0).slice(0, 25);
  topLonger.forEach((c, i) => {
    console.log(`${i + 1}. [${c.routeId}] ${c.from} → ${c.to}: haversine=${c.haversineSec} с, OSRM=${c.osrmSec} с, +${c.diff} с (${c.diffPct.toFixed(0)}%)`);
  });

  console.log('');
  console.log('--- Топ-25 сегментів де OSRM коротший за haversine ---');
  const topShorter = byAbsDiff.filter((c) => c.diff < 0).slice(0, 25);
  topShorter.forEach((c, i) => {
    console.log(`${i + 1}. [${c.routeId}] ${c.from} → ${c.to}: haversine=${c.haversineSec} с, OSRM=${c.osrmSec} с, ${c.diff} с (${c.diffPct.toFixed(0)}%)`);
  });

  const byRoute = {};
  withDiff.forEach((c) => {
    if (!byRoute[c.routeId]) byRoute[c.routeId] = { sumAbs: 0, count: 0 };
    byRoute[c.routeId].sumAbs += Math.abs(c.diff);
    byRoute[c.routeId].count += 1;
  });
  console.log('');
  console.log('--- Середня абсолютна різниця по маршрутах ---');
  Object.entries(byRoute)
    .sort((a, b) => b[1].sumAbs / b[1].count - a[1].sumAbs / a[1].count)
    .forEach(([routeId, v]) => {
      console.log(`Маршрут ${routeId}: ${(v.sumAbs / v.count).toFixed(1)} с (середнє), сегментів ${v.count}`);
    });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
