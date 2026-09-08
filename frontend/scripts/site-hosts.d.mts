export type SiteKey = 'malyn' | 'korosten';

export interface SiteHostConfig {
  key: SiteKey;
  domain: string;
  cityCode: string;
  cityNameUk: string;
  cityNameUkGenitive: string;
  isPrimary: boolean;
}

export declare const SITES: Record<SiteKey, SiteHostConfig>;
export declare const PRIMARY_SITE: SiteHostConfig;
export declare const PRIMARY_ORIGIN: string;
export declare const PRIMARY_ONLY_PATHS: string[];
export declare function normalizeHost(host: string | undefined | null): string;
export declare function resolveSiteKey(host: string | undefined | null): SiteKey;
export declare function resolveSite(host: string | undefined | null): SiteHostConfig;
export declare function isPrimaryOnlyPath(pathname: string | undefined | null): boolean;
export declare function primaryUrl(pathname: string, search?: string): string;
