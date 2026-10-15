/**
 * Відкриті дані транспорту Малина (Docs/transport-open-data-2026-10.md, етап 3 «Дані належать людині»):
 * стабільні адреси фіду й знімка, ліцензія (дзеркало OPEN_DATA_LICENSE у backend/src/gtfs-feed.ts — міняти разом).
 */
import { API_URL } from '@/utils/constants';

export const OPEN_DATA_LICENSE = {
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
} as const;

/** GTFS Static із бекенду (кеш за revision, ETag; Content-Disposition робить клік завантаженням) */
export const GTFS_FEED_URL = `${API_URL}/transport/gtfs.zip`;

/** Повний датасет у внутрішньому JSON — знімок збірки сайту (prerender-transport-stops.mjs, етап 1) */
export const DATASET_JSON_URL = '/transport/dataset.json';
export const DATASET_JSON_FILENAME = 'malyn-transport-dataset.json';

/** Як відкрити файли, ліцензія, атрибуція — для людей; репозиторій публічний */
export const OPEN_DATA_DOC_URL = 'https://github.com/drivling/kyiv-malyn-booking/blob/main/Docs/transport-open-data.md';

export type OpenDataFormat = 'gtfs' | 'json';
