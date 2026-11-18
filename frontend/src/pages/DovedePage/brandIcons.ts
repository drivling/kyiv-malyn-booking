/**
 * Іконка вкладки «Доведе» (scripts/dovede-brand.mjs). Хто відкрив /dovede напряму, і так отримує її зі статичного
 * dist/dovede/index.html; цей хук — для того, хто прийшов сюди з іншої сторінки сайту, і для виходу назад: тоді
 * повертаються іконки сайту з index.html.
 */
import { useEffect } from 'react';
import { DOVEDE_ICON_LINKS, type DovedeIconLink } from '../../../scripts/dovede-brand.mjs';

/** Іконки сайту — як в index.html (src/test/og-images.test.ts стежить, що вони там є) */
export const SITE_ICON_LINKS: DovedeIconLink[] = [
  { rel: 'icon', sizes: '32x32', href: '/favicon.ico' },
  { rel: 'icon', type: 'image/svg+xml', href: '/icons/yak-doikhaty.svg' },
  { rel: 'apple-touch-icon', href: '/icons/yak-doikhaty-apple-180.png' },
];

/** Браузер перемальовує іконку вкладки надійно, коли теги замінено, а не лише змінено їм href */
export function setIconLinks(links: DovedeIconLink[]): void {
  document.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => el.remove());
  for (const { rel, type, sizes, href } of links) {
    const el = document.createElement('link');
    el.rel = rel;
    if (type) el.type = type;
    if (sizes) el.setAttribute('sizes', sizes);
    el.href = href;
    document.head.appendChild(el);
  }
}

export function useDovedeIcons(): void {
  useEffect(() => {
    setIconLinks(DOVEDE_ICON_LINKS);
    return () => setIconLinks(SITE_ICON_LINKS);
  }, []);
}
