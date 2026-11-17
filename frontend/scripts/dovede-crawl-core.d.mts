export type CrawlCity = 'Kyiv' | 'Zhytomyr';
export type CrawlDayType = 'weekday' | 'saturday' | 'sunday';
export type CrawlDir = 'to' | 'from';

export interface CrawlSlot {
  dayType: CrawlDayType;
  /** 'HH:MM' */
  time: string;
}

/** Крок у журналі: пішки або поїздка */
export type CrawlStep = { walk: number; m?: number } | { walk?: undefined; mode: string; line: string; from: string; to: string; head?: string; n?: number; min: number };

export interface CrawlNode {
  city: CrawlCity;
  /** id точки висадки / посадки: «kyiv.akadem» */
  origin: string;
  /** to — від точки до місця; from — від місця до точки */
  dir: CrawlDir;
  place: string;
  depth: number;
  via: string;
}

export interface CrawlSeed {
  city: CrawlCity;
  origin: string;
  place: string;
  dir?: CrawlDir;
  depth?: number;
  via?: string;
}

export interface CrawlAsk {
  city: CrawlCity;
  from: string;
  to: string;
  date: string;
  time: string;
}

export interface CrawlTask {
  node: CrawlNode;
  slot: CrawlSlot;
  slotIdx: number;
  ask: CrawlAsk;
}

export interface CrawlRecord {
  at: string;
  city: CrawlCity;
  origin: string;
  dir: CrawlDir;
  place: string;
  depth: number;
  via: string;
  dayType: CrawlDayType;
  hour: number;
  date: string;
  time: string;
  ok: boolean;
  source?: string;
  minutes?: number;
  steps?: CrawlStep[];
  reason?: string;
}

export interface CrawlResult {
  ok: boolean;
  source?: string;
  minutes?: number;
  steps?: unknown[];
  reason?: string;
}

export declare const ARRIVAL_POINTS: Record<CrawlCity, string[]>;
export declare const POINT_LABEL: Record<string, string>;
export declare const DAY_TYPES: CrawlDayType[];
export declare const DEFAULT_FRESH_DAYS: number;
export declare function normalizeKey(text: string): string;
export declare function resolveOrigins(city: CrawlCity, spec?: string): string[];
export declare function dayTypeOf(isoDate: string): CrawlDayType;
export declare function kyivToday(now?: Date): string;
export declare function slotDate(dayType: CrawlDayType, today: string): string;
export declare function parseSlots(spec?: string): CrawlSlot[];
export declare function seedFromIntent(intent: unknown): { city: CrawlCity; place: string; dir: CrawlDir } | null;
export declare function compactSteps(steps: unknown): CrawlStep[];
export declare function looksLikeMetro(name: string): boolean;
export declare function candidates(
  steps: CrawlStep[],
  opts?: { dir?: CrawlDir; siteForm?: (name: string) => string | null; headsigns?: boolean; exclude?: string[] },
): Array<{ name: string; via: 'stop' | 'headsign' }>;
export declare function describeSteps(steps: CrawlStep[]): string;
export declare function askOf(node: CrawlNode, slot: CrawlSlot, today: string): CrawlAsk;
export declare function taskKey(node: Pick<CrawlNode, 'city' | 'origin' | 'dir' | 'place'>, dayType: CrawlDayType, hour: number): string;
export declare function seedsFromUnanswered(rows: unknown): CrawlSeed[];
export declare function rootsFromRecords(records: CrawlRecord[]): CrawlNode[];
export declare function createCrawl(opts: {
  records?: CrawlRecord[];
  seeds?: CrawlSeed[];
  slots: CrawlSlot[];
  maxDepth?: number;
  freshDays?: number;
  now?: () => Date;
  siteForm?: (city: CrawlCity, name: string) => string | null;
  headsigns?: boolean;
}): {
  stats: { skipped: number; found: number; nodes: number };
  pending(): number;
  next(): CrawlTask | null;
  done(task: CrawlTask, result: CrawlResult): { record: CrawlRecord; added: number };
};
export declare function summarizeRecords(
  records: CrawlRecord[],
  opts?: { freshDays?: number; now?: () => Date },
): {
  total: number;
  pairs: number;
  lines: number;
  stops: number;
  by: Record<string, number>;
  stale: number;
  expiring: number;
};
