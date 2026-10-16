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
}

export declare const OG_IMAGE_WIDTH: number;
export declare const OG_IMAGE_HEIGHT: number;
export declare const OG_IMAGES: { site: OgImage; transport: OgImage };
export declare function ogImageForPath(pathname: string | undefined | null): OgImage;
export declare function ogImageUrl(image: OgImage): string;
