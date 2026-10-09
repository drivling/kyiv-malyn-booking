/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Тайли публічної карти /transport — за замовчуванням OpenStreetMap (див. RouteMap.tsx) */
  readonly VITE_MAP_TILES_URL?: string;
  readonly VITE_MAP_TILES_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
