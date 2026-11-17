/**
 * Міні-тизер «Доведе» перед табло зупинки (Docs/dovede-roadmap.md, «Облік реклами»): хто відкрив табло, відсканувавши
 * наклейку (`utm_source=sticker`), один раз бачить 8-секундний ролик «Крапка». Тут — лише легка перевірка для
 * головного бандла; сам ролик (StickerAdIntro.tsx) вантажиться окремим чанком, коли він справді потрібен.
 */
import { parseStickerCampaign } from '@/pages/LocalTransportPage/stickerScan';
import { isPrerendering } from '@/utils/prerender';
import { isSeen } from './seen';

/** Цей браузер уже бачив тизер (досмотрів до кінця); новий тизер усім — `:v2` */
export const HINT_SEEN_KEY = 'dovede-hint:v1';

/** Зупинка з наклейки, якщо тизер треба показати; null — ні (не зі скану, уже бачив, пререндер) */
export function stickerAdFor(search: string): { stopId: string } | null {
  if (isPrerendering()) return null;
  const scan = parseStickerCampaign(search);
  if (!scan || isSeen(HINT_SEEN_KEY)) return null;
  return { stopId: scan.stopId };
}
