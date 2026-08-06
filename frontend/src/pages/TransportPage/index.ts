/** Shared transport dataset loader + Local view-model adapter (public UI lives in LocalTransportPage). */
export { useTransportDataset, invalidateTransportDatasetCache, broadcastTransportDatasetInvalidate } from './useTransportDataset';
export {
  datasetToLocalViewModel,
  buildSegmentDurationsMap,
  getDurationFromStartSec,
  getSegmentDurationSec,
} from './datasetAdapter';
export type { LocalTransportViewModel, LocalCoords } from './datasetAdapter';
