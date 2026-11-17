export interface RingSource {
  fetchedAt: string;
  stations: Array<{ name: string; slug: string; badges: string[] }>;
  trains: Array<{ name: string; runs: 'daily' | 'weekdays'; stops: Array<[string, string]> }>;
}

export interface RingConfig {
  extra?: Array<{ match: string; from: string; fromTime?: string; to: string }>;
  arrivals?: Record<string, Record<string, string>>;
}

export interface RingTimetable {
  checkedAt: string;
  stations: string[];
  trains: Array<{ no: string; dir: 'cw' | 'ccw'; days: 'daily' | 'weekdays'; extra?: boolean; from?: string; fromMins?: number; to?: string; stops: number[][] }>;
}

export declare function parseTrainList(html: string): { trains: Array<{ url: string; name: string }>; stations: RingSource['stations'] };
export declare function parseTrainPage(html: string): RingSource['trains'][number];
export declare function buildTimetable(source: RingSource, config: RingConfig): RingTimetable;
export declare function timetableJson(tt: RingTimetable): string;
