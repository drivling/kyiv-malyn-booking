/**
 * Ролик перед табло зупинки (Docs/dovede-roadmap.md, «Облік реклами»): хто відкрив табло, відсканувавши наклейку
 * (`utm_source=sticker`), один раз бачить 8-секундний ролик. Зазвичай це міні-тизер «Крапка» — на кожній зупинці
 * кожного міста; на вокзалах зі списку `WELCOME_STOPS` (туди приїздять) замість нього привітання міста — та сама
 * крапка друкує «Вітаємо в Малині» чи «Вітаємо в Коростені». Ролики три, і в кожного своя позначка «бачив»
 * (`AD_SEEN_KEYS`, за назвою ролика): привітання на вокзалі не скасовує тизер на іншій зупинці й навпаки, привітання
 * одного міста — привітання іншого, а на вокзалі «Крапку» не показуємо взагалі. Позначки браузер тримає окремо для
 * кожного домену (malin.kiev.ua, korosten.kiev.ua), тож людина з Малина в Коростені побачить і коростенські ролики.
 * Тут — лише легка перевірка для головного бандла; сам ролик (StickerAdIntro.tsx) вантажиться окремим чанком, коли
 * він справді потрібен.
 */
import { parseStickerCampaign } from '@/pages/LocalTransportPage/stickerScan';
import { DEFAULT_TRANSPORT_CITY, siteTransportCity } from '@/site/transportCity';
import { isPrerendering } from '@/utils/prerender';
import { isSeen } from './seen';

/** Ролики перед табло: тизер «Крапка» і привітання на вокзалах Малина й Коростеня */
export type StickerAdVideo = 'hint' | 'welcome' | 'welcomeKorosten';

/** Позначка «цей браузер досмотрів ролик» — своя в кожного ролика; новий ролик усім — `:v2` */
export const AD_SEEN_KEYS: Readonly<Record<StickerAdVideo, string>> = {
  hint: 'dovede-hint:v1',
  welcome: 'malyn-welcome:v1',
  welcomeKorosten: 'korosten-welcome:v1',
};
export const HINT_SEEN_KEY = AD_SEEN_KEYS.hint;
export const WELCOME_SEEN_KEY = AD_SEEN_KEYS.welcome;
export const KOROSTEN_WELCOME_SEEN_KEY = AD_SEEN_KEYS.welcomeKorosten;

/**
 * Вокзали, де замість тизера — привітання свого міста: «Залізничний вокзал» Малина (`st_0019`) і Коростеня
 * (`st_1001`, той самий, що `KOROSTEN_STATION` у «Доведе»). Id зупинок — у межах міста, тому ключ — місто сайту.
 */
export const WELCOME_STOPS: Readonly<Record<string, Readonly<Record<string, StickerAdVideo>>>> = {
  [DEFAULT_TRANSPORT_CITY]: { st_0019: 'welcome' },
  Korosten: { st_1001: 'welcomeKorosten' },
};

/** Який ролик належить зупинці на сайті міста `city` */
export function stickerAdVideoFor(stopId: string, city: string = siteTransportCity()): StickerAdVideo {
  const stops = WELCOME_STOPS[city];
  return stops && Object.prototype.hasOwnProperty.call(stops, stopId) ? stops[stopId] : 'hint';
}

/** Зупинка з наклейки й ролик, якщо його треба показати; null — ні (не зі скану, уже бачив, пререндер) */
export function stickerAdFor(search: string): { stopId: string; video: StickerAdVideo } | null {
  if (isPrerendering()) return null;
  const scan = parseStickerCampaign(search);
  if (!scan) return null;
  const video = stickerAdVideoFor(scan.stopId);
  if (isSeen(AD_SEEN_KEYS[video])) return null;
  return { stopId: scan.stopId, video };
}
