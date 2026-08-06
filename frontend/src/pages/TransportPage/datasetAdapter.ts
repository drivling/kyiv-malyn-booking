/**
 * TransportDataset (API) → LocalTransport view-model
 * (TransportData + coords + segments lookup for Local helpers).
 */

import type { TransportDataset } from '../../api/transportDataset.ts';
import { datasetToEditor } from '../../api/transportDataset.ts';
import type { Supplement, TransportData, TransportRecord } from '../LocalTransportPage/types.ts';

export interface LocalCoords {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

export interface LocalTransportViewModel {
  data: TransportData;
  coords: LocalCoords;
  /** Keys: "routeId|fromStopId|toStopId" → seconds */
  segmentDurations: Record<string, number>;
  defaultSec: number;
}

export function buildSegmentDurationsMap(dataset: TransportDataset): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of dataset.segments) {
    map[`${s.routeId}|${s.fromStopId}|${s.toStopId}`] = s.seconds;
  }
  return map;
}

export function defaultSegmentSec(dataset: TransportDataset): number {
  const n = Number(dataset.meta.defaultSec);
  return Number.isFinite(n) && n > 0 ? n : 120;
}

/** Compatible with LocalTransportPage segmentDurations.getSegmentDurationSec */
export function getSegmentDurationSec(
  segmentDurations: Record<string, number>,
  defaultSec: number,
  routeId: string,
  stopFrom: string,
  stopTo: string
): number {
  const key1 = `${routeId}|${stopFrom}|${stopTo}`;
  const key2 = `${routeId}|${stopTo}|${stopFrom}`;
  return segmentDurations[key1] ?? segmentDurations[key2] ?? defaultSec;
}

/** Compatible with LocalTransportPage segmentDurations.getDurationFromStartSec */
export function getDurationFromStartSec(
  segmentDurations: Record<string, number>,
  defaultSec: number,
  routeId: string,
  orderedStopKeys: string[],
  toIndex: number
): number {
  let sec = 0;
  for (let i = 0; i < toIndex && i < orderedStopKeys.length - 1; i++) {
    sec += getSegmentDurationSec(
      segmentDurations,
      defaultSec,
      routeId,
      orderedStopKeys[i],
      orderedStopKeys[i + 1]
    );
  }
  return sec;
}

export function datasetToLocalViewModel(dataset: TransportDataset): LocalTransportViewModel {
  const { transport, coords } = datasetToEditor(dataset);
  const records = (transport.records || []) as TransportRecord[];
  const supplement = transport.supplement as Supplement | undefined;

  const data: TransportData = {
    source: 'api:/transport/dataset',
    records,
    supplement,
    stats: {
      total_rows: records.length,
      routes_count: dataset.routes.length,
      route_ids: dataset.routes.map((r) => r.id),
    },
  };

  return {
    data,
    coords: {
      center: coords.center,
      stops: coords.stops,
    },
    segmentDurations: buildSegmentDurationsMap(dataset),
    defaultSec: defaultSegmentSec(dataset),
  };
}
