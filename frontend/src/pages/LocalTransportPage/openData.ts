/**
 * Відкриті дані транспорту Малина (Docs/transport-open-data-2026-10.md, етап 3 «Дані належать людині»):
 * стабільні адреси фіду й знімка, ліцензія (дзеркало OPEN_DATA_LICENSE у backend/src/gtfs-feed.ts — міняти разом).
 */
/*
 * Посилання для людей — канонічні адреси на домені сайту (Docs/transport-open-protocols-2026-10.md, фаза 1): відносні
 * шляхи, що працюють на кожному домені й відповідають 302 на поточний бекенд (`apiRedirectPath` у serve-dist-rules.mjs,
 * у dev — proxy у vite.config.ts). Домен бекенду у посиланнях не друкуємо: він зміниться разом із хостингом.
 */

export const OPEN_DATA_LICENSE = {
  name: 'OwnNet Source License 1.1',
  url: 'https://own-net.com/license.html',
  attribution: 'Дані: malin.kiev.ua — Сергій Меренков / ТОВ «Технології» (technologies.llc)',
} as const;

/** GTFS Static (кеш за revision, ETag; Content-Disposition на бекенді робить клік завантаженням) */
export const GTFS_FEED_URL = '/transport/gtfs.zip';

/** OpenAPI 3.1 публічних ендпоінтів бекенду (етап 4) */
export const OPENAPI_URL = '/openapi.yaml';
/** Живий датасет (revision завжди поточна) — на відміну від знімка збірки DATASET_JSON_URL */
export const DATASET_LIVE_URL = '/transport/dataset';

/** RSS «зміни розкладу» — запис на кожну revision журналу з підсумком diff (Docs/transport-revisions-2026-10.md) */
export const CHANGES_RSS_URL = '/transport/changes.rss';
/** Журнал ревізій датасету у JSON (Docs/transport-revisions-2026-10.md) — ті самі записи, що в RSS, із diff */
export const REVISIONS_JSON_URL = '/transport/revisions';
/** iCalendar рейсів маршруту (подія на рейс, тижневий повтор, Europe/Kyiv) */
export const routeCalendarUrl = (routeId: string): string => `/transport/route/${encodeURIComponent(routeId)}/calendar.ics`;

/** Повний датасет у внутрішньому JSON — знімок збірки сайту (prerender-transport-stops.mjs, етап 1) */
export const DATASET_JSON_URL = '/transport/dataset.json';
export const DATASET_JSON_FILENAME = 'malyn-transport-dataset.json';

/** Як відкрити файли, ліцензія, атрибуція — для людей; репозиторій публічний */
export const OPEN_DATA_DOC_URL = 'https://github.com/drivling/kyiv-malyn-booking/blob/main/Docs/transport-open-data.md';

export type OpenDataFormat = 'gtfs' | 'json';
