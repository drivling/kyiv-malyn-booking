"use strict";
/**
 * «Доведе» · маршрутки Києва з переліку міста (Docs/dovede-learning-roadmap.md, крок 8б) — дані власника, як GTFS
 * «Київпастрансу»: номер, кінцеві, тривалість маршруту й частота відправлення. Знімок —
 * data/kyiv-transport/taxi/routes.json (`npm run kyiv:kpt -- --fetch-taxi` бере свіжий), генерований файл —
 * kyiv-taxi-data.ts. Чисті функції.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTaxiDescription = parseTaxiDescription;
exports.buildTaxiData = buildTaxiData;
exports.taxiSnapshotFrom = taxiSnapshotFrom;
exports.renderTaxiSnapshot = renderTaxiSnapshot;
exports.renderTaxiDataTs = renderTaxiDataTs;
/** «вул. А – вул. Б. Тривалість маршруту 60 хв. Частота відправлення 10-20 хв.» → поля */
function parseTaxiDescription(no, description) {
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
function buildTaxiData(snap) {
    return { fetchedAt: snap.fetchedAt, routes: snap.routes.map((r) => parseTaxiDescription(r.no, r.description)) };
}
/** Відповідь CKAN `datastore_search` → знімок (номер і опис; решта полів — службові) */
function taxiSnapshotFrom(body, fetchedAt) {
    const records = body?.result?.records;
    if (!Array.isArray(records) || !records.length)
        throw new Error('Перелік маршруток порожній або не той формат');
    const routes = records
        .filter((r) => typeof r.shortName === 'string' && typeof r.description === 'string')
        .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
        .map((r) => ({ no: String(r.shortName), description: String(r.description) }));
    return { fetchedAt, routes };
}
function renderTaxiSnapshot(snap) {
    return `${JSON.stringify(snap, null, 1)}\n`;
}
function renderTaxiDataTs(data) {
    return `/**
 * ЗГЕНЕРОВАНО: \`npm run kyiv:kpt\` у backend/ (dovede/kyiv-taxi.ts → buildTaxiData) з data/kyiv-transport/taxi/routes.json.
 * Руками не редагувати. Маршрутки Києва — дані власника: номер, кінцеві, тривалість маршруту, частота відправлення.
 */
import type { KyivTaxiData } from './kyiv-taxi';

// prettier-ignore
export const KYIV_TAXI: KyivTaxiData = ${JSON.stringify(data)};
`;
}
