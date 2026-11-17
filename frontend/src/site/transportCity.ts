/**
 * Місто міського транспорту для поточного сайту (Docs/korosten-transport-2026-11.md, фаза 5;
 * бекенд — Docs/transport-tenancy-2026-11.md). Без параметра бекенд віддає Малин, тому для Малина
 * адреси запитів лишаються такими, як були; інше місто йде з ?city=<TripPoint.code>.
 */
import { isPrerendering } from '@/utils/prerender';
import { readAdminToken } from '@/utils/adminTokenStorage';
import { SITES, getCurrentSite, siteForCityCode } from './siteConfig';

export const DEFAULT_TRANSPORT_CITY = 'Malyn';

/**
 * Параметр міста транспорту: в адмінці — яке місто редагуємо (/admin/route-schedule?city=Korosten),
 * на /transport — перегляд сторінок міста адміном до запуску. Той самий ключ, що в API;
 * рідне місто між доменами їде в `?homeCity=` (CITY_HANDOFF_PARAM).
 */
export const TRANSPORT_CITY_PARAM = 'city';
const PREVIEW_STORAGE_KEY = 'transport-preview-city';

/** Код міста з активного сайту (без урахування регістру) → TripPoint.code; null — такого міста нема */
export function canonicalTransportCity(raw: string | null | undefined): string | null {
  const wanted = (raw ?? '').trim().toLowerCase();
  if (!wanted) return null;
  const site = Object.values(SITES).find((s) => s.active && s.cityCode.toLowerCase() === wanted);
  return site ? site.cityCode : null;
}

/** Міста, між якими перемикається адмінка: активні сайти, головний першим */
export function transportCityOptions(): Array<{ cityCode: string; name: string }> {
  return Object.values(SITES)
    .filter((s) => s.active)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((s) => ({ cityCode: s.cityCode, name: s.cityNameUk }));
}

/** Той самий токен, що тримає apiClient */
function hasAdminToken(): boolean {
  return Boolean(readAdminToken());
}

function storedPreview(): string | null {
  try {
    return sessionStorage.getItem(PREVIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Місто, чиї сторінки транспорту адмін переглядає до запуску (null — перегляду нема). Береться з
 * ?city= в адресі, далі тримається в sessionStorage цієї вкладки, тож переходи всередині
 * /transport* його не гублять. Без адмін-токена в браузері й під пререндером — завжди null: відвідувачу
 * параметр нічого не змінює, а бекенд і так віддає неопубліковане місто лише з токеном.
 */
export function transportPreviewCity(): string | null {
  if (typeof window === 'undefined' || isPrerendering() || !hasAdminToken()) return null;
  const fromUrl = new URLSearchParams(window.location.search).get(TRANSPORT_CITY_PARAM);
  const city = canonicalTransportCity(fromUrl ?? storedPreview());
  if (!city || city === getCurrentSite().cityCode) return null;
  return city;
}

/** Запам'ятати місто перегляду з адреси для цієї вкладки (або забути, коли в адресі місто сайту) */
export function rememberTransportPreview(): void {
  if (typeof window === 'undefined') return;
  const fromUrl = new URLSearchParams(window.location.search).get(TRANSPORT_CITY_PARAM);
  if (fromUrl === null) return;
  try {
    const city = transportPreviewCity();
    if (city) sessionStorage.setItem(PREVIEW_STORAGE_KEY, city);
    else sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  } catch {
    /* без sessionStorage перегляд живе, поки параметр в адресі */
  }
}

export function exitTransportPreview(): void {
  try {
    sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  } catch {
    /* нічого */
  }
}

/**
 * Місто, чий транспорт показує цей сайт: malin.kiev.ua → Malyn, korosten.kiev.ua → Korosten;
 * в адміна в режимі перегляду — місто перегляду.
 */
export function siteTransportCity(): string {
  return transportPreviewCity() ?? (getCurrentSite().cityCode || DEFAULT_TRANSPORT_CITY);
}

export const isDefaultTransportCity = (city: string | null | undefined): boolean => !city || city === DEFAULT_TRANSPORT_CITY;

/** '' для Малина, '?city=Korosten' (або '&city=…', коли в адресі вже є запит) для іншого міста */
export function cityQuery(city: string | null | undefined, separator: '?' | '&' = '?'): string {
  return isDefaultTransportCity(city) ? '' : `${separator}city=${encodeURIComponent(city as string)}`;
}

/** Поле city для тіла POST: нічого для Малина */
export function cityField(city: string | null | undefined): { city?: string } {
  return isDefaultTransportCity(city) ? {} : { city: city as string };
}

/** Чіп «Куди їдете?»: вузол з однією чи кількома зупинками датасету (головна перша) */
export interface TransportQuickNode {
  id: string;
  kind: 'hub' | 'terminal';
  name: string;
  stopIds: string[];
}

export interface TransportProfile {
  cityCode: string;
  /** «Малин» — у підзаголовках («Малин · місцевий транспорт») */
  name: string;
  /** «Малина» — «Транспорт Малина», «Маршрути Малина» */
  nameGenitive: string;
  /** «Малині» — «як доїхати у Малині» */
  nameLocative: string;
  /** Домен сайту міста (canonical, тексти «на malin.kiev.ua/transport») */
  domain: string;
  /** https://<домен> */
  siteUrl: string;
  /** Відкриті дані (GTFS, RSS, ICS) — поки лише Малин; в іншого міста блок посилань на фід ховаємо */
  hasOpenData: boolean;
  /**
   * Чіпи «Куди їдете?»: вибрані головні точки міста; [] — вузли й кінцеві схеми (Малин), а в міста без
   * схеми — лише «Поруч зі мною»
   */
  quickNodes: readonly TransportQuickNode[];
  /** Джерело розкладу в підвалі сторінок міста без відкритих даних; null — нема */
  sourceLink: { href: string; label: string } | null;
  /** Центр карти, поки датасет не дав свого (meta.center) */
  center: [number, number] | null;
  /**
   * Є намальована схема маршрутів (сторінка /transport/scheme, міні-схеми, кольори ліній з її легенди);
   * сама схема — LocalTransportPage/scheme/registry.ts, тут лише прапорець, щоб профіль не тягнув SVG
   */
  hasScheme: boolean;
  /** Є статті зупинок у src/content/stops */
  hasStopArticles: boolean;
  /** Старі народні назви зупинок, які пошук має знати завжди */
  legacyStopNames: readonly string[];
}

function names(city: string): Pick<TransportProfile, 'name' | 'nameGenitive' | 'nameLocative' | 'domain' | 'siteUrl'> {
  const site = Object.values(SITES).find((s) => s.cityCode === city);
  const domain = siteForCityCode(city).domain;
  return {
    name: site?.cityNameUk ?? city,
    nameGenitive: site?.cityNameUkGenitive ?? city,
    nameLocative: site?.cityNameUkLocative ?? city,
    domain,
    siteUrl: `https://${domain}`,
  };
}

const MALYN_PROFILE: TransportProfile = {
  cityCode: DEFAULT_TRANSPORT_CITY,
  ...names(DEFAULT_TRANSPORT_CITY),
  hasOpenData: true,
  quickNodes: [],
  sourceLink: null,
  center: [50.768, 29.242],
  hasScheme: true,
  hasStopArticles: true,
  legacyStopNames: ['Малинівка', 'Юрівка', 'БАМ', 'Царське село'],
};

/** Центри міст без власного профілю — для порожньої карти, поки в датасеті нема meta.center */
const CITY_CENTERS: Record<string, [number, number]> = {
  Korosten: [50.9506, 28.6384],
};

/** Міста, крім Малина, зі схемою маршрутів (LocalTransportPage/scheme/registry.ts; Docs/korosten-scheme-2026-11.md) */
const CITIES_WITH_SCHEME = new Set(['Korosten']);

/** Міста, крім Малина, зі статтями зупинок (src/content/stops: Коростень — з переліку зупинок ради) */
const CITIES_WITH_STOP_ARTICLES = new Set(['Korosten']);

/** Звідки розклад міста (підвал сторінок транспорту) — з мапи сайтів, її ж читає статичний пререндер */
function citySource(city: string): { href: string; label: string } | null {
  const site = Object.values(SITES).find((s) => s.cityCode === city) as { transportSource?: { href: string; label: string } } | undefined;
  return site?.transportSource ?? null;
}

/** Чіпи «Куди їдете?»: головні точки міста (id зупинок датасету міста) */
const CITY_QUICK_NODES: Record<string, readonly TransportQuickNode[]> = {
  Korosten: [
    { id: 'st_1001', kind: 'hub', name: 'Залізничний вокзал', stopIds: ['st_1001'] },
    { id: 'st_1002', kind: 'hub', name: 'Міський ринок', stopIds: ['st_1002'] },
    { id: 'st_1003', kind: 'hub', name: 'Центр міста', stopIds: ['st_1003'] },
    { id: 'st_1079', kind: 'hub', name: 'Міська лікарня', stopIds: ['st_1079'] },
    { id: 'st_1073', kind: 'hub', name: 'Районна лікарня', stopIds: ['st_1073'] },
    { id: 'st_1015', kind: 'terminal', name: 'Поліське водосховище', stopIds: ['st_1015'] },
  ],
};

/** Що в транспорті прив'язане до конкретного міста: назви, домен, схема, статті зупинок, відкриті дані */
export function transportProfile(city: string = siteTransportCity()): TransportProfile {
  if (isDefaultTransportCity(city)) return MALYN_PROFILE;
  return {
    cityCode: city,
    ...names(city),
    hasOpenData: false,
    quickNodes: CITY_QUICK_NODES[city] ?? [],
    sourceLink: citySource(city),
    center: CITY_CENTERS[city] ?? null,
    hasScheme: CITIES_WITH_SCHEME.has(city),
    hasStopArticles: CITIES_WITH_STOP_ARTICLES.has(city),
    legacyStopNames: [],
  };
}
