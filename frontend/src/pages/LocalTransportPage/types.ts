export interface TransportRecord {
  route_id: string;
  service_id?: string;
  trip_id: string;
  trip_headsign: string;
  direction_id: string;
  block_id?: string;
  shape_id?: string;
  wheelchair_accessible?: string;
  bikes_allowed?: string;
}

export interface SupplementRoute {
  from?: string;
  to?: string;
  scheme?: string;
  special?: string;
  interval_min?: number;
  interval_max?: number;
  note?: string;
  source_url?: string;
  streets?: string[];
  schedule?: {
    from_bazar?: string;
    from_oleksy_tikh?: string;
    first_trip?: string;
    to_center?: string;
    lunch_break?: string;
    schedule_entries?: Array<{ label: string; times: string }>;
    note?: string;
  };
}

export interface SupplementStops {
  source?: string;
  source_url?: string;
  stops_by_route?: Record<string, string[]>;
}

export interface Supplement {
  fare?: { amount: number; currency: string; note?: string };
  routes?: Record<string, SupplementRoute>;
  stops?: SupplementStops;
  news?: Array<{ date: string; title: string; url: string }>;
  sources?: Record<string, string>;
  contacts?: Record<string, string>;
}

export interface TransportData {
  source: string;
  records: TransportRecord[];
  supplement?: Supplement;
  stats?: {
    total_rows: number;
    routes_count: number;
    route_ids: string[];
  };
}

export interface RouteInfo {
  id: string;
  from: string | null;
  to: string | null;
  trips: TransportRecord[];
  supplement?: SupplementRoute;
}
