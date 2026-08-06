/**
 * Контракт датасету /transport/dataset і адаптер до формату MapEditorTab.
 */

export interface TransportStopDto {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface TransportRouteDto {
  id: string;
  fromName?: string;
  toName?: string;
  scheme?: string;
  note?: string;
  sourceUrl?: string;
  schedule?: unknown;
}

export interface TransportRouteStopDto {
  routeId: string;
  stopId: string;
  orderThere?: number;
  orderBack?: number;
  mapOnly?: boolean;
}

export interface TransportTripDto {
  id: string;
  routeId: string;
  serviceId?: string;
  headsign?: string;
  directionId?: string;
  departureTime?: string | null;
  blockId?: string | null;
  wheelchairAccessible?: string;
  bikesAllowed?: string;
}

export interface TransportSegmentDto {
  routeId: string;
  fromStopId: string;
  toStopId: string;
  seconds: number;
}

export interface TransportDataset {
  stops: TransportStopDto[];
  routes: TransportRouteDto[];
  routeStops: TransportRouteStopDto[];
  trips: TransportTripDto[];
  segments: TransportSegmentDto[];
  meta: Record<string, unknown>;
}

/** Формат, з яким працює MapEditorTab (легасі JSON). */
export interface EditorTransportData {
  records?: unknown[];
  supplement?: {
    routes?: Record<string, { from?: string; to?: string; scheme?: string; note?: string; source_url?: string; schedule?: unknown }>;
    stops?: {
      stops_by_route?: Record<string, Array<{
        id?: string;
        name: string;
        order_there?: number;
        order_back?: number;
        map_only?: boolean;
      }>>;
      stops_catalog?: Record<string, { name: string }>;
    };
    fare?: unknown;
    contacts?: unknown;
    news?: unknown;
    sources?: unknown;
    description?: unknown;
  };
  [key: string]: unknown;
}

export interface EditorCoordsData {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

export function datasetToEditor(dataset: TransportDataset): {
  transport: EditorTransportData;
  coords: EditorCoordsData;
} {
  const catalog: Record<string, { name: string }> = {};
  const coordsStops: Record<string, [number, number]> = {};
  for (const s of dataset.stops) {
    catalog[s.id] = { name: s.name };
    coordsStops[s.id] = [s.lat, s.lng];
  }

  const routes: Record<
    string,
    { from?: string; to?: string; scheme?: string; note?: string; source_url?: string; schedule?: unknown }
  > = {};
  for (const r of dataset.routes) {
    routes[r.id] = {
      from: r.fromName,
      to: r.toName,
      scheme: r.scheme,
      note: r.note,
      source_url: r.sourceUrl,
      schedule: r.schedule,
    };
  }

  const stopsByRoute: Record<string, Array<{
    id?: string;
    name: string;
    order_there?: number;
    order_back?: number;
    map_only?: boolean;
  }>> = {};
  for (const rs of dataset.routeStops) {
    if (!stopsByRoute[rs.routeId]) stopsByRoute[rs.routeId] = [];
    stopsByRoute[rs.routeId].push({
      id: rs.stopId,
      name: catalog[rs.stopId]?.name || rs.stopId,
      order_there: rs.orderThere ?? -1,
      order_back: rs.orderBack ?? -1,
      ...(rs.mapOnly ? { map_only: true } : {}),
    });
  }

  const center = (dataset.meta.center as [number, number] | null) ?? [50.768, 29.242];

  return {
    transport: {
      records: dataset.trips.map((t) => ({
        route_id: t.routeId,
        trip_id: t.id,
        service_id: t.serviceId,
        trip_headsign: t.headsign,
        direction_id: t.directionId,
        departure_time: t.departureTime,
        block_id: t.blockId,
        wheelchair_accessible: t.wheelchairAccessible,
        bikes_allowed: t.bikesAllowed,
      })),
      supplement: {
        routes,
        stops: { stops_catalog: catalog, stops_by_route: stopsByRoute },
        fare: dataset.meta.fare,
        contacts: dataset.meta.contacts,
        news: dataset.meta.news,
        sources: dataset.meta.sources,
        description: dataset.meta.description,
      },
    },
    coords: { center, stops: coordsStops },
  };
}

/** Збирає нормалізований датасет з поточного стану редактора + незмінених trips/segments/meta.agency. */
export function editorToDataset(
  transport: EditorTransportData,
  coords: EditorCoordsData,
  base: TransportDataset
): TransportDataset {
  const catalog = transport.supplement?.stops?.stops_catalog || {};
  const stops: TransportStopDto[] = [];
  for (const [id, pos] of Object.entries(coords.stops)) {
    stops.push({
      id,
      name: catalog[id]?.name || id,
      lat: pos[0],
      lng: pos[1],
    });
  }

  const routesMeta = transport.supplement?.routes || {};
  const routeIds = new Set<string>([
    ...Object.keys(routesMeta),
    ...Object.keys(transport.supplement?.stops?.stops_by_route || {}),
    ...base.routes.map((r) => r.id),
  ]);
  const baseRouteById = new Map(base.routes.map((r) => [r.id, r]));
  const routes: TransportRouteDto[] = [...routeIds].map((id) => {
    const m = routesMeta[id] || {};
    const prev = baseRouteById.get(id);
    return {
      id,
      fromName: m.from ?? prev?.fromName ?? '',
      toName: m.to ?? prev?.toName ?? '',
      scheme: m.scheme ?? prev?.scheme ?? '',
      note: m.note ?? prev?.note ?? '',
      sourceUrl: m.source_url ?? prev?.sourceUrl ?? '',
      schedule: m.schedule ?? prev?.schedule ?? null,
    };
  });

  const routeStops: TransportRouteStopDto[] = [];
  const sbr = transport.supplement?.stops?.stops_by_route || {};
  for (const [routeId, entries] of Object.entries(sbr)) {
    for (const e of entries) {
      const stopId = (e.id && String(e.id).trim()) || null;
      if (!stopId || !coords.stops[stopId]) continue;
      routeStops.push({
        routeId,
        stopId,
        orderThere: e.order_there ?? -1,
        orderBack: e.order_back ?? -1,
        mapOnly: e.map_only === true,
      });
    }
  }

  return {
    stops,
    routes,
    routeStops,
    trips: base.trips,
    segments: base.segments,
    meta: {
      ...base.meta,
      center: coords.center,
      fare: transport.supplement?.fare ?? base.meta.fare,
      contacts: transport.supplement?.contacts ?? base.meta.contacts,
      news: transport.supplement?.news ?? base.meta.news,
      sources: transport.supplement?.sources ?? base.meta.sources,
      description: transport.supplement?.description ?? base.meta.description,
    },
  };
}
