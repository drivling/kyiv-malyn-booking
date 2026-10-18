/**
 * Відкриті дані транспорту Малина (Docs/transport-open-data-2026-10.md, етап 3 «Дані належать людині»):
 * стабільні адреси фіду й знімка, ліцензія (дзеркало OPEN_DATA_LICENSE у backend/src/gtfs-feed.ts — міняти разом).
 */
import { API_URL } from '@/utils/constants';

export const OPEN_DATA_LICENSE = {
  name: 'OwnNet Source License 1.1',
  url: 'https://own-net.com/license.html',
  attribution: 'Дані: malin.kiev.ua — Сергій Меренков / ТОВ «Технології» (technologies.llc)',
} as const;

/** GTFS Static із бекенду (кеш за revision, ETag; Content-Disposition робить клік завантаженням) */
export const GTFS_FEED_URL = `${API_URL}/transport/gtfs.zip`;

/** OpenAPI 3.1 публічних ендпоінтів бекенду (етап 4); канонічна адреса на сайті — /openapi.yaml (302 сюди) */
export const OPENAPI_URL = `${API_URL}/openapi.yaml`;
/** Живий датасет із бекенду (revision завжди поточна) — на відміну від знімка збірки DATASET_JSON_URL */
export const DATASET_LIVE_URL = `${API_URL}/transport/dataset`;

/** RSS «зміни розкладу» — запис на кожну revision журналу з підсумком diff (Docs/transport-revisions-2026-10.md); канонічна адреса /transport/changes.rss на сайті */
export const CHANGES_RSS_URL = `${API_URL}/transport/changes.rss`;
/** iCalendar рейсів маршруту (подія на рейс, тижневий повтор, Europe/Kyiv) */
export const routeCalendarUrl = (routeId: string): string => `${API_URL}/transport/route/${encodeURIComponent(routeId)}/calendar.ics`;

/** Повний датасет у внутрішньому JSON — знімок збірки сайту (prerender-transport-stops.mjs, етап 1) */
export const DATASET_JSON_URL = '/transport/dataset.json';
export const DATASET_JSON_FILENAME = 'malyn-transport-dataset.json';

/** Як відкрити файли, ліцензія, атрибуція — для людей; репозиторій публічний */
export const OPEN_DATA_DOC_URL = 'https://github.com/drivling/kyiv-malyn-booking/blob/main/Docs/transport-open-data.md';

export type OpenDataFormat = 'gtfs' | 'json';
