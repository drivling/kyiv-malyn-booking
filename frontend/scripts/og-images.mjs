/**
 * Картки посилань (og:image) — що бачать Telegram, LinkedIn, Facebook, Viber, коли вставляють адресу сайту.
 * Малює їх `npm run pwa:icons` (scripts/gen-pwa-icons.mjs) у стилі іконки «Як доїхати»; PNG закомічені в public/og.
 * Нова картинка — нове ім'я файлу: месенджери кешують прев'ю за адресою картинки.
 *
 * Plain ESM без залежностей: імпортують і Node (генератор, prerender-*.mjs, seo-smoke), і SPA (usePageSeo).
 * Дефолтна картка ще й прописана статично в index.html — тест src/test/og-images.test.ts стежить за збігом.
 */
import { PRIMARY_ORIGIN } from './site-hosts.mjs';

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export const OG_IMAGES = {
  /** Увесь сайт, крім /transport*: головна, міжміські, коридори, підтримка, «Про нас» */
  site: {
    path: '/og/yak-doikhaty-site.png',
    label: 'malin.kiev.ua',
    title: 'Як доїхати',
    lead: ['Попутки, маршрутки й електрички', 'Малин · Київ · Житомир · Коростень'],
    alt: 'Як доїхати — попутки, маршрутки й електрички: Малин, Київ, Житомир, Коростень',
  },
  /** Міський транспорт: планер, маршрути, табло зупинок, схема (застосунок «Як доїхати») */
  transport: {
    path: '/og/yak-doikhaty-transport.png',
    label: 'malin.kiev.ua/transport',
    title: 'Як доїхати',
    lead: ['Міські маршрутки Малина:', 'табло зупинок, розклад і схема'],
    alt: 'Як доїхати — міські маршрутки Малина: табло зупинок, розклад і схема',
  },
};

/** Картка для шляху сторінки: /transport і все під ним — транспортна, решта — загальна */
export function ogImageForPath(pathname) {
  return /^\/transport(\/|$)/.test(pathname || '/') ? OG_IMAGES.transport : OG_IMAGES.site;
}

/** Абсолютна адреса (месенджери не приймають відносну) — завжди головний домен */
export function ogImageUrl(image) {
  return `${PRIMARY_ORIGIN}${image.path}`;
}
