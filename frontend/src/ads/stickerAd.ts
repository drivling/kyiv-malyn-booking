/**
 * Ролик перед табло зупинки (Docs/dovede-roadmap.md, «Облік реклами»): хто відкрив табло, відсканувавши наклейку
 * (`utm_source=sticker`), один раз бачить 8-секундний ролик. Зазвичай це міні-тизер «Крапка»; на зупинках зі списку
 * `WELCOME_STOPS` (вокзал Малина — туди приїздять) замість нього привітання «Вітаємо в Малині» — та сама крапка
 * друкує напис. У кожного ролика своя позначка «бачив»: привітання на вокзалі не скасовує тизер на іншій зупинці й
 * навпаки, а на вокзалі «Крапку» не показуємо взагалі. Тут — лише легка перевірка для головного бандла; сам ролик
 * (StickerAdIntro.tsx) вантажиться окремим чанком, коли він справді потрібен.
 */
import { parseStickerCampaign } from '@/pages/LocalTransportPage/stickerScan';
import { DEFAULT_TRANSPORT_CITY, siteTransportCity } from '@/site/transportCity';
import { isPrerendering } from '@/utils/prerender';
import { isSeen } from './seen';

/** Цей браузер уже бачив тизер (досмотрів до кінця); новий тизер усім — `:v2` */
export const HINT_SEEN_KEY = 'dovede-hint:v1';
/** Те саме для привітання на вокзалі */
export const WELCOME_SEEN_KEY = 'malyn-welcome:v1';

/** Зупинки міста, де замість тизера — привітання: «Залізничний вокзал» Малина */
export const WELCOME_STOPS: Record<string, readonly string[]> = { [DEFAULT_TRANSPORT_CITY]: ['st_0019'] };

export type StickerAdVideo = 'hint' | 'welcome';

/** Який ролик належить зупинці на сайті міста `city` */
export function stickerAdVideoFor(stopId: string, city: string = siteTransportCity()): StickerAdVideo {
  return WELCOME_STOPS[city]?.includes(stopId) ? 'welcome' : 'hint';
}

/** Зупинка з наклейки й ролик, якщо його треба показати; null — ні (не зі скану, уже бачив, пререндер) */
export function stickerAdFor(search: string): { stopId: string; video: StickerAdVideo } | null {
  if (isPrerendering()) return null;
  const scan = parseStickerCampaign(search);
  if (!scan) return null;
  const video = stickerAdVideoFor(scan.stopId);
  if (isSeen(video === 'welcome' ? WELCOME_SEEN_KEY : HINT_SEEN_KEY)) return null;
  return { stopId: scan.stopId, video };
}
