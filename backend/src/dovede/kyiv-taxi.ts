/**
 * «Доведе» · маршрутки Києва з переліку міста (Docs/dovede-learning-roadmap.md, крок 8б) — дані власника, як GTFS
 * «Київпастрансу»: номер, кінцеві, тривалість маршруту й частота відправлення. Знімок —
 * data/kyiv-transport/taxi/routes.json (`npm run kyiv:kpt -- --fetch-taxi` бере свіжий), генерований файл —
 * kyiv-taxi-data.ts. Чисті функції.
 */

export interface TaxiSnapshot {
  /** 'YYYY-MM-DD' */
  fetchedAt: string;
  routes: Array<{ no: string; description: string }>;
}

export interface KyivTaxi {
  /** номер, як на табличці («200К», «442Д») */
  no: string;
  /** кінцеві словами («вул. Милославська – Севастопольська площа») */
  name: string;
  /** тривалість маршруту від кінцевої до кінцевої, хв */
  minutes: number | null;
  /** частота відправлення, хв: від і до (однакові, коли в описі одне число) */
  every: [number, number] | null;
}

export interface KyivTaxiData {
  fetchedAt: string;
  routes: KyivTaxi[];
}

/** «вул. А – вул. Б. Тривалість маршруту 60 хв. Частота відправлення 10-20 хв.» → поля */
export function parseTaxiDescription(no: string, description: string): KyivTaxi {
  const text = description.replace(/\s+/g, ' ').trim();
  const dur = /Тривалість маршруту\s*(\d+)\s*хв/i.exec(text);
  const freq = /Частота відправлення\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*хв/i.exec(text);
  const cut = text.search(/\.\s*Тривалість маршруту/i);
  const lo = freq ? Number(freq[1]) : null;
  const hi = freq?.[2] ? Number(freq[2]) : lo;
  return {
    no: no.trim(),
    name: (cut > 0 ? text.slice(0, cut) : text).trim(),
    minutes: dur ? Number(dur[1]) : null,
    every: lo != null && hi != null && lo > 0 ? [Math.min(lo, hi), Math.max(lo, hi)] : null,
  };
}

export function buildTaxiData(snap: TaxiSnapshot): KyivTaxiData {
  return { fetchedAt: snap.fetchedAt, routes: snap.routes.map((r) => parseTaxiDescription(r.no, r.description)) };
}

/** Відповідь CKAN `datastore_search` → знімок (номер і опис; решта полів — службові) */
export function taxiSnapshotFrom(body: unknown, fetchedAt: string): TaxiSnapshot {
  const records = (body as { result?: { records?: Array<{ shortName?: unknown; description?: unknown; sortOrder?: unknown }> } })?.result?.records;
  if (!Array.isArray(records) || !records.length) throw new Error('Перелік маршруток порожній або не той формат');
  const routes = records
    .filter((r) => typeof r.shortName === 'string' && typeof r.description === 'string')
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
    .map((r) => ({ no: String(r.shortName), description: String(r.description) }));
  return { fetchedAt, routes };
}

export function renderTaxiSnapshot(snap: TaxiSnapshot): string {
  return `${JSON.stringify(snap, null, 1)}\n`;
}

export function renderTaxiDataTs(data: KyivTaxiData): string {
  return `/**
 * ЗГЕНЕРОВАНО: \`npm run kyiv:kpt\` у backend/ (dovede/kyiv-taxi.ts → buildTaxiData) з data/kyiv-transport/taxi/routes.json.
 * Руками не редагувати. Маршрутки Києва — дані власника: номер, кінцеві, тривалість маршруту, частота відправлення.
 */
import type { KyivTaxiData } from './kyiv-taxi';

// prettier-ignore
export const KYIV_TAXI: KyivTaxiData = ${JSON.stringify(data)};
`;
}
