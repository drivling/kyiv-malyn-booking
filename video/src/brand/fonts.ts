import { loadFont } from '@remotion/google-fonts/GolosText';

/** Golos Text — шрифт сайту й постів (OFL). Рендер чекає, доки шрифт завантажиться */
export const { fontFamily: GOLOS } = loadFont('normal', { weights: ['400', '600', '800'], subsets: ['cyrillic', 'latin'] });
