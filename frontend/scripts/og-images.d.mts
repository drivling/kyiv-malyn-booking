export interface OgImage {
  /** Шлях від кореня сайту: /og/….png */
  path: string;
  /** Підпис біля іконки на картці */
  label: string;
  title: string;
  /** Підзаголовок картки, по рядку (переноси задані руками, щоб текст не зачіпав лінії) */
  lead: string[];
  /** og:image:alt */
  alt: string;
  /** Генератор: легенда схеми міста (`<legend>-scheme-routes.ts`) і id ліній на картці; без них — Малин */
  legend?: string;
  lines?: string[];
}

export declare const OG_IMAGE_WIDTH: number;
export declare const OG_IMAGE_HEIGHT: number;
export declare const OG_IMAGES: { site: OgImage; transport: OgImage; transportKorosten: OgImage };
export declare function ogImageForPath(pathname: string | undefined | null, siteKey?: string): OgImage;
export declare function ogImageForUrl(url: string): OgImage;
export declare function ogImageUrl(image: { path: string }): string;
