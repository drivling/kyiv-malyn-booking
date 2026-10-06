/**
 * Підкладка карти — стандартні тайли OpenStreetMap (без ключа, як в адмінському редакторі карти).
 * CARTO Positron віддає базові карти лише з API-ключем: без нього кожен тайл — напис «API KEY REQUIRED».
 * Інший провайдер (напр. CARTO з ключем) вмикається змінними VITE_MAP_TILES_URL / VITE_MAP_TILES_ATTRIBUTION
 * (Railway Variables фронтенду, див. .env.example).
 */
export const DEFAULT_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DEFAULT_TILES_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface MapTilesConfig {
  url: string;
  attribution: string;
  /** Стандартні OSM-тайли (не кастомний провайдер) — лише до них застосовується приглушувальний фільтр */
  isDefault: boolean;
}

/**
 * Адресний рядок браузера кодує фігурні дужки (`{z}` → `%7Bz%7D`), а Leaflet підставляє значення лише в
 * літеральні `{z}/{x}/{y}` — шаблон, скопійований звідти, повертаємо до робочого вигляду.
 */
export function normalizeTileTemplate(url: string): string {
  return url.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
}

/** Підкладка зі змінних середовища (VITE_MAP_TILES_URL / VITE_MAP_TILES_ATTRIBUTION) або стандартна OSM */
export function resolveMapTiles(env: { url?: string; attribution?: string }): MapTilesConfig {
  const url = normalizeTileTemplate((env.url ?? '').trim()) || DEFAULT_TILES;
  const attribution = (env.attribution ?? '').trim() || DEFAULT_TILES_ATTRIBUTION;
  return { url, attribution, isDefault: url === DEFAULT_TILES };
}
