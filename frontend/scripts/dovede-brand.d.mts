export interface DovedeIconLink {
  rel: 'icon' | 'apple-touch-icon';
  type?: string;
  sizes?: string;
  href: string;
}

export declare const DOVEDE_INK: string;
export declare const DOVEDE_DOT: string;
export declare const DOVEDE_ICONS: { png32: string; png192: string; apple180: string };
export declare const DOVEDE_OG: { path: string; alt: string };
export declare const DOVEDE_TITLE: string;
export declare const DOVEDE_SITE_NAME: string;
export declare const DOVEDE_DESCRIPTION: string;
export declare const DOVEDE_ICON_LINKS: DovedeIconLink[];
export declare function dovedeHtml(indexHtml: string, origin?: string): string;
