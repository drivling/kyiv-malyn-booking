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

/** Чи зупинка є тільки в одному напрямку */
export type StopBelongsTo = 'there' | 'back' | 'both';

/** Зупинка з порядком у напрямках "туди" та "назад" */
export interface RouteStopWithOrder {
  name: string;
  /** Номер зупинки в маршруті туди (from → to) */
  order_there: number;
  /** Номер зупинки в маршруті назад (to → from) */
  order_back: number;
  /** Чи зупинка є тільки в одному напрямку. За замовчуванням: both */
  belongs_to?: StopBelongsTo;
}

export interface SupplementStops {
  source?: string;
  source_url?: string;
  /** Зупинки по маршрутах з порядком у кожному напрямку */
  stops_by_route?: Record<string, RouteStopWithOrder[]>;
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
