#!/usr/bin/env node
/**
 * Export Malyn local transport runtime JSON → GTFS Static feed.
 *
 * Input:  data/malyn-transport/runtime/
 * Output: data/malyn-transport/gtfs/  (txt + malyn-gtfs.zip)
 *
 * Only trips with departure_time are exported (honest feed).
 * stop_times are synthesized from ordered passenger stops + segmentDurations.
 *
 * Usage:
 *   node scripts/export-malyn-gtfs.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const runtimeDir = path.join(rootDir, 'data/malyn-transport/runtime');
const outDir = path.join(rootDir, 'data/malyn-transport/gtfs');
const agencyPath = path.join(runtimeDir, 'agency.json');

const DEFAULT_SEC = 120;
const FALLBACK_MINS = 2;

const SERVICE_MAP = {
  'пн-вт-ср-чт-пт-сб-нд': 'everyday',
  everyday: 'everyday',
  weekdays: 'weekdays',
};

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeTable(filePath, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function toGtfsTime(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, '0');
  return `${hh}:${m[2]}:${m[3] || '00'}`;
}

function minutesToGtfs(mins) {
  const total = Math.max(0, Math.round(mins));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function parseMinutes(gtfsTime) {
  const m = gtfsTime.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getStopKey(s) {
  return (s.id && String(s.id).trim()) || s.name;
}

function orderedPassengerStops(stops, direction) {
  const key = direction === 'there' ? 'order_there' : 'order_back';
  return (stops || [])
    .filter((s) => !s.map_only && (s[key] ?? -1) > 0)
    .sort((a, b) => a[key] - b[key]);
}

function orderedAllStops(stops, direction) {
  const key = direction === 'there' ? 'order_there' : 'order_back';
  return (stops || [])
    .filter((s) => (s[key] ?? -1) > 0)
    .sort((a, b) => a[key] - b[key]);
}

function segmentSec(segments, defaultSec, routeId, fromKey, toKey) {
  const k1 = `${routeId}|${fromKey}|${toKey}`;
  const k2 = `${routeId}|${toKey}|${fromKey}`;
  return segments[k1] ?? segments[k2] ?? defaultSec;
}

function durationToStopMins(routeId, chainKeys, toIndex, segments, defaultSec) {
  let sec = 0;
  for (let i = 0; i < toIndex && i < chainKeys.length - 1; i++) {
    sec += segmentSec(segments, defaultSec, routeId, chainKeys[i], chainKeys[i + 1]);
  }
  if (sec === 0 && toIndex > 0 && Object.keys(segments).every((k) => !k.startsWith(`${routeId}|`))) {
    return toIndex * FALLBACK_MINS;
  }
  return sec / 60;
}

function loadAgency() {
  if (fs.existsSync(agencyPath)) {
    return JSON.parse(fs.readFileSync(agencyPath, 'utf8'));
  }
  return {
    agency_id: 'malyn',
    agency_name: 'Громадський транспорт міста Малина',
    agency_url: 'https://malyn-rada.gov.ua/',
    agency_timezone: 'Europe/Kyiv',
    agency_lang: 'uk',
    agency_phone: '',
  };
}

function main() {
  const transport = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'malyn_transport.json'), 'utf8'));
  const coordsData = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'stops_coords.json'), 'utf8'));
  const segmentsData = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'segmentDurations.json'), 'utf8'));
  const agency = loadAgency();

  const catalog = transport.supplement?.stops?.stops_catalog || {};
  const stopsByRoute = transport.supplement?.stops?.stops_by_route || {};
  const routesMeta = transport.supplement?.routes || {};
  const coords = coordsData.stops || {};
  const segments = segmentsData.segments || {};
  const defaultSec = segmentsData.defaultSec || DEFAULT_SEC;

  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(agencyPath)) {
    fs.writeFileSync(agencyPath, JSON.stringify(agency, null, 2) + '\n', 'utf8');
  }

  // --- agency.txt ---
  writeTable(path.join(outDir, 'agency.txt'), ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone'], [
    {
      agency_id: agency.agency_id || 'malyn',
      agency_name: agency.agency_name,
      agency_url: agency.agency_url,
      agency_timezone: agency.agency_timezone || 'Europe/Kyiv',
      agency_lang: agency.agency_lang || 'uk',
      agency_phone: agency.agency_phone || '',
    },
  ]);

  // --- calendar.txt ---
  writeTable(
    path.join(outDir, 'calendar.txt'),
    ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
    [
      {
        service_id: 'everyday',
        monday: 1,
        tuesday: 1,
        wednesday: 1,
        thursday: 1,
        friday: 1,
        saturday: 1,
        sunday: 1,
        start_date: '20240101',
        end_date: '20271231',
      },
      {
        service_id: 'weekdays',
        monday: 1,
        tuesday: 1,
        wednesday: 1,
        thursday: 1,
        friday: 1,
        saturday: 0,
        sunday: 0,
        start_date: '20240101',
        end_date: '20271231',
      },
    ]
  );

  // --- stops.txt ---
  const stopRows = [];
  const usedStopIds = new Set();
  for (const [stopId, meta] of Object.entries(catalog)) {
    const c = coords[stopId];
    if (!c || c.length < 2) continue;
    usedStopIds.add(stopId);
    stopRows.push({
      stop_id: stopId,
      stop_name: meta.name || stopId,
      stop_lat: Number(c[0]).toFixed(6),
      stop_lon: Number(c[1]).toFixed(6),
      location_type: 0,
    });
  }
  writeTable(path.join(outDir, 'stops.txt'), ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'], stopRows);

  // Collect timed trips first to know which routes appear
  const timedTrips = (transport.records || []).filter((r) => toGtfsTime(r.departure_time));
  const routeIds = [...new Set(timedTrips.map((t) => String(t.route_id)))].sort((a, b) => Number(a) - Number(b));

  // --- routes.txt ---
  const routeRows = routeIds.map((routeId) => {
    const meta = routesMeta[routeId] || {};
    const longName = [meta.from, meta.to].filter(Boolean).join(' — ') || `Маршрут ${routeId}`;
    return {
      route_id: routeId,
      agency_id: agency.agency_id || 'malyn',
      route_short_name: routeId,
      route_long_name: longName,
      route_type: 3, // Bus / marshrutka
    };
  });
  writeTable(
    path.join(outDir, 'routes.txt'),
    ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
    routeRows
  );

  // --- trips.txt + stop_times.txt ---
  const tripRows = [];
  const stopTimeRows = [];
  let skippedNoStops = 0;

  for (const rec of timedTrips) {
    const routeId = String(rec.route_id);
    const dep = toGtfsTime(rec.departure_time);
    const serviceId = SERVICE_MAP[rec.service_id] || 'everyday';
    const directionThere = String(rec.direction_id) === '1';
    const direction = directionThere ? 'there' : 'back';
    const routeStops = stopsByRoute[routeId] || [];
    const passenger = orderedPassengerStops(routeStops, direction);
    const chain = orderedAllStops(routeStops, direction);
    const chainKeys = chain.map(getStopKey);

    if (passenger.length < 2) {
      skippedNoStops++;
      continue;
    }

    tripRows.push({
      route_id: routeId,
      service_id: serviceId,
      trip_id: rec.trip_id,
      trip_headsign: rec.trip_headsign || '',
      direction_id: String(rec.direction_id) === '1' ? 1 : 0,
      block_id: rec.block_id || '',
    });

    const baseMins = parseMinutes(dep);
    passenger.forEach((stop, seq) => {
      const key = getStopKey(stop);
      if (!usedStopIds.has(key)) return;
      const idxInChain = chainKeys.indexOf(key);
      const offset = idxInChain >= 0
        ? durationToStopMins(routeId, chainKeys, idxInChain, segments, defaultSec)
        : seq * FALLBACK_MINS;
      const t = minutesToGtfs(baseMins + offset);
      stopTimeRows.push({
        trip_id: rec.trip_id,
        arrival_time: t,
        departure_time: t,
        stop_id: key,
        stop_sequence: seq + 1,
        timepoint: seq === 0 ? 1 : 0,
      });
    });
  }

  writeTable(
    path.join(outDir, 'trips.txt'),
    ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'block_id'],
    tripRows
  );
  writeTable(
    path.join(outDir, 'stop_times.txt'),
    ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'timepoint'],
    stopTimeRows
  );

  // Zip
  const zipPath = path.join(outDir, 'malyn-gtfs.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const files = ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt'];
  execFileSync('zip', ['-q', '-j', zipPath, ...files.map((f) => path.join(outDir, f))], { cwd: outDir });

  console.log(`GTFS written to ${outDir}`);
  console.log(`Routes: ${routeRows.length}, trips: ${tripRows.length}, stop_times: ${stopTimeRows.length}, stops: ${stopRows.length}`);
  console.log(`Skipped trips (no passenger stops): ${skippedNoStops}`);
  console.log(`Timed records in source: ${timedTrips.length}; plate-only trips omitted from feed.`);
  console.log(`Zip: ${zipPath}`);
}

main();
