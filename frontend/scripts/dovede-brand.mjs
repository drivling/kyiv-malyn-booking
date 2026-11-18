/**
 * «Доведе» у вкладці браузера й у прев'ю посилання (Telegram, Viber, Facebook): логотип із ролика-вступу — «Доведе» Golos
 * Text 900 кольору сторінки і блакитна крапка. Малює їх `npm run dovede:icons` (scripts/dovede-icons.mjs), PNG закомічені
 * в public/dovede/.
 *
 * Telegram і інші месенджери не виконують JS, тож прев'ю береться зі статичного HTML: крок збірки
 * scripts/dovede-html.mjs пише dist/dovede/index.html — ту саму оболонку SPA (скрипти з SRI ті самі), але з шапкою
 * «Доведе» (`dovedeHtml`). serve-dist віддає її на /dovede (і з dovede.online — через 302 Cloudflare). У SPA ту саму
 * картку ставить usePageSeo, іконку вкладки — DovedePage (`useDovedeIcons`), коли людина прийшла сюди з іншої сторінки.
 *
 * Новий малюнок = нові імена файлів (`-v2`): браузери тримають favicon, месенджери кешують прев'ю за адресою картинки.
 * Plain ESM без залежностей: імпортують і Node (генератор, крок збірки), і SPA (DovedePage).
 */

/** Колір слова й крапки — токени сторінки (DovedePage.css: --dv-ink, --dv-accent), як у ролику */
export const DOVEDE_INK = '#054752';
export const DOVEDE_DOT = '#00aff5';

/** Іконки вкладки: плитка з «Д» і крапкою (32 — вкладка, 192 — Android / великі екрани), 180 — iOS «На Початковий екран» */
export const DOVEDE_ICONS = {
  png32: '/dovede/icon-v1-32.png',
  png192: '/dovede/icon-v1-192.png',
  apple180: '/dovede/icon-v1-180.png',
};

/** Картка посилання 1200×630: як останній кадр ролика — «Доведе.», «Спитайте своїми словами.», dovede.online */
export const DOVEDE_OG = {
  path: '/dovede/og-v1.png',
  alt: 'Доведе. Спитайте своїми словами. dovede.online',
};

export const DOVEDE_TITLE = 'Доведе';
export const DOVEDE_SITE_NAME = 'dovede.online';
export const DOVEDE_DESCRIPTION =
  'Спитайте своїми словами — і доведе: маршрутки, електрички, попутки й міські автобуси. Малин · Київ · Житомир · Коростень.';

/** Посилання <link rel="icon">, які сторінка «Доведе» ставить замість іконок сайту (і в статичному HTML, і в SPA) */
export const DOVEDE_ICON_LINKS = [
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: DOVEDE_ICONS.png32 },
  { rel: 'icon', type: 'image/png', sizes: '192x192', href: DOVEDE_ICONS.png192 },
  { rel: 'apple-touch-icon', href: DOVEDE_ICONS.apple180 },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const linkTag = ({ rel, type, sizes, href }) =>
  `<link rel="${rel}"${type ? ` type="${type}"` : ''}${sizes ? ` sizes="${sizes}"` : ''} href="${href}" />`;

/**
 * Шапка оболонки (index.html) → шапка /dovede. Кожен тег має знайтися рівно раз: змінили index.html так, що заміна
 * не спрацювала б, — збірка падає, а не тихо віддає картку «Як доїхати».
 * @param {string} indexHtml dist/index.html (уже з SRI)
 * @param {string} origin абсолютна адреса картинки — месенджери не приймають відносну
 */
export function dovedeHtml(indexHtml, origin = 'https://malin.kiev.ua') {
  const og = `${origin}${DOVEDE_OG.path}`;
  const swaps = [
    [/<link rel="icon" href="\/favicon\.ico"[^>]*\/>/, linkTag(DOVEDE_ICON_LINKS[0])],
    [/<link rel="icon" type="image\/svg\+xml"[^>]*\/>/, linkTag(DOVEDE_ICON_LINKS[1])],
    [/<link rel="apple-touch-icon"[^>]*\/>/, linkTag(DOVEDE_ICON_LINKS[2])],
    // маніфест «Як доїхати» (scope /transport) сторінці «Доведе» ні до чого
    [/\s*<link rel="manifest"[^>]*\/>/, ''],
    [/<meta name="apple-mobile-web-app-title"[^>]*\/>/, `<meta name="apple-mobile-web-app-title" content="${DOVEDE_TITLE}" />`],
    [/<meta name="description"[^>]*\/>/, `<meta name="description" content="${esc(DOVEDE_DESCRIPTION)}" />`],
    [/<meta property="og:title"[^>]*\/>/, `<meta property="og:title" content="${DOVEDE_TITLE}" />`],
    [/<meta property="og:description"[^>]*\/>/, `<meta property="og:description" content="${esc(DOVEDE_DESCRIPTION)}" />`],
    [/<meta property="og:site_name"[^>]*\/>/, `<meta property="og:site_name" content="${DOVEDE_SITE_NAME}" />`],
    [/<meta property="og:image" [^>]*\/>/, `<meta property="og:image" content="${og}" />`],
    [/<meta property="og:image:alt"[^>]*\/>/, `<meta property="og:image:alt" content="${esc(DOVEDE_OG.alt)}" />`],
    [/<meta name="robots"[^>]*\/>/, '<meta name="robots" content="noindex, nofollow" />'],
    [/<title>[^<]*<\/title>/, `<title>${DOVEDE_TITLE}</title>`],
  ];
  let html = indexHtml;
  for (const [re, to] of swaps) {
    const hits = html.match(new RegExp(re.source, 'g'))?.length ?? 0;
    if (hits !== 1) throw new Error(`dovede-html: у index.html ${hits} збігів для ${re} (очікую рівно 1)`);
    html = html.replace(re, to);
  }
  // коментарі шапки оболонки пояснюють іконки й картку «Як доїхати» — тут вони б уводили в оману
  const headEnd = html.indexOf('</head>');
  return html.slice(0, headEnd).replace(/\s*<!--[\s\S]*?-->/g, '') + html.slice(headEnd);
}
