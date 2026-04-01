#!/usr/bin/env node
/**
 * Одноразова міграція: додає supplement.stops.stops_catalog, поле id у кожній зупинці,
 * переводить ключі stops_coords.json та segmentDurations.json на id.
 *
 * Запуск з кореня репозиторію: node scripts/migrate-stop-ids.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PATHS = {
  transportBackend: path.join(ROOT, 'backend/localtransport-data/malyn_transport.json'),
  coordsBackend: path.join(ROOT, 'backend/localtransport-data/stops_coords.json'),
  segmentsBackend: path.join(ROOT, 'backend/localtransport-data/segmentDurations.json'),
  transportPublic: path.join(ROOT, 'frontend/public/data/malyn_transport.json'),
  coordsPublic: path.join(ROOT, 'frontend/public/data/stops_coords.json'),
  segmentsFrontend: path.join(ROOT, 'frontend/src/pages/LocalTransportPage/segmentDurations.json'),
};

function collectNamesFromSbr(sbr) {
  const names = new Set();
  if (!sbr || typeof sbr !== 'object') return names;
  for (const route of Object.values(sbr)) {
    if (!Array.isArray(route)) continue;
    for (const s of route) {
      if (typeof s === 'string') names.add(s);
      else if (s && typeof s === 'object' && s.name) names.add(s.name);
    }
  }
  return names;
}

function collectNamesFromSegments(segments) {
  const names = new Set();
  if (!segments || typeof segments !== 'object') return names;
  for (const key of Object.keys(segments)) {
    const parts = key.split('|');
    if (parts.length >= 3) {
      names.add(parts[1]);
      names.add(parts[2]);
    }
  }
  return names;
}

function assignIds(sortedNames) {
  const nameToId = new Map();
  const stopsCatalog = {};
  sortedNames.forEach((name, i) => {
    const id = `st_${String(i + 1).padStart(4, '0')}`;
    nameToId.set(name, id);
    stopsCatalog[id] = { name };
  });
  return { nameToId, stopsCatalog };
}

function injectIdsIntoSbr(sbr, nameToId) {
  const out = {};
  for (const [routeId, stops] of Object.entries(sbr || {})) {
    if (!Array.isArray(stops)) {
      out[routeId] = stops;
      continue;
    }
    const first = stops[0];
    if (typeof first === 'object' && first && 'name' in first) {
      out[routeId] = stops.map((s) => {
        const id = nameToId.get(s.name);
        if (!id) throw new Error(`No id for stop name: ${s.name}`);
        return { ...s, id };
      });
    } else {
      out[routeId] = (stops).map((name) => {
        const id = nameToId.get(name);
        if (!id) throw new Error(`No id for stop name: ${name}`);
        return {
          id,
          name,
          order_there: stops.indexOf(name) + 1,
          order_back: stops.length - stops.indexOf(name),
          belongs_to: 'both',
        };
      });
    }
  }
  return out;
}

function remapCoords(coordsData, nameToId) {
  const next = { ...coordsData, stops: {} };
  for (const [name, pos] of Object.entries(coordsData.stops || {})) {
    const id = nameToId.get(name);
    if (!id) throw new Error(`Coords: no id for "${name}"`);
    next.stops[id] = pos;
  }
  return next;
}

function remapSegments(segmentsObj, nameToId) {
  const next = {};
  for (const [key, sec] of Object.entries(segmentsObj.segments || {})) {
    const parts = key.split('|');
    if (parts.length < 3) {
      next[key] = sec;
      continue;
    }
    const [rid, a, b] = [parts[0], parts[1], parts.slice(2).join('|')];
    const idA = nameToId.get(a);
    const idB = nameToId.get(b);
    if (!idA || !idB) throw new Error(`Segment remap failed for ${key}`);
    next[`${rid}|${idA}|${idB}`] = sec;
  }
  return { ...segmentsObj, segments: next };
}

function main() {
  const transport = JSON.parse(fs.readFileSync(PATHS.transportBackend, 'utf8'));
  const coordsData = JSON.parse(fs.readFileSync(PATHS.coordsBackend, 'utf8'));
  const segmentsData = JSON.parse(fs.readFileSync(PATHS.segmentsBackend, 'utf8'));

  const sbr = transport.supplement?.stops?.stops_by_route;
  const nameSet = new Set([
    ...collectNamesFromSbr(sbr),
    ...Object.keys(coordsData.stops || {}),
    ...collectNamesFromSegments(segmentsData.segments),
  ]);

  const sortedNames = [...nameSet].sort((a, b) => a.localeCompare(b, 'uk'));
  const { nameToId, stopsCatalog } = assignIds(sortedNames);

  transport.supplement = transport.supplement || {};
  transport.supplement.stops = transport.supplement.stops || {};
  transport.supplement.stops.stops_catalog = stopsCatalog;
  transport.supplement.stops.stops_by_route = injectIdsIntoSbr(sbr, nameToId);

  const newCoords = remapCoords(coordsData, nameToId);
  const newSegments = remapSegments(segmentsData, nameToId);

  const outJson = (p, obj) => {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    console.log('Wrote', p);
  };

  outJson(PATHS.transportBackend, transport);
  outJson(PATHS.coordsBackend, newCoords);
  outJson(PATHS.segmentsBackend, newSegments);
  outJson(PATHS.transportPublic, transport);
  outJson(PATHS.coordsPublic, newCoords);
  outJson(PATHS.segmentsFrontend, newSegments);

  console.log('Done. Stops:', sortedNames.length);
}

main();
