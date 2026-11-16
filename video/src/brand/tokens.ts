/** Кадр і кольори тизера — ті самі, що на сторінці /dovede (`--dv-*` у DovedePage.css) */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const COLORS = {
  ink: '#054752',
  accent: '#00aff5',
  accentInk: '#0079ad',
  paper: '#ffffff',
  bg: '#f1f4f5',
  muted: '#4f6f75',
  line: '#dde3e6',
  night: '#0b1416',
  phone: '#10191b',
} as const;

/** Безпечні зони реклами Meta (частки кадру): зверху й знизу інтерфейс Reels перекриває кадр */
export const SAFE = { top: 0.14, bottom: 0.35, side: 0.06 } as const;

/** Безпечні зони сторіс Facebook / Instagram: зверху імʼя й смужки прогресу, знизу рядок відповіді */
export const SAFE_STORY = { top: 0.14, bottom: 0.2, side: 0.06 } as const;
