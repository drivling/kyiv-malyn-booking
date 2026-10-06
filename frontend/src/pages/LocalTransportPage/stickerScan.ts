import { useEffect } from 'react';
import { apiClient } from '@/api/client';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import type { StickerSide } from '@/types';

/**
 * QR наклейки на зупинці (адмінка «Наклейки зупинок») веде на табло з
 * `?utm_source=sticker&utm_medium=qr&utm_campaign=<stopId>-<a|b|s>` → { stopId, side }.
 */
export function parseStickerCampaign(search: string): { stopId: string; side: StickerSide } | null {
  const p = new URLSearchParams(search);
  if (p.get('utm_source') !== 'sticker') return null;
  const m = /^([A-Za-z0-9_-]{1,40})-([abs])$/.exec(p.get('utm_campaign') ?? '');
  return m ? { stopId: m[1], side: m[2] as StickerSide } : null;
}

const SEEN_PREFIX = 'sticker-scan:';

/**
 * Відкриття табло з наклейки: подія GA4 `transport_sticker_open` і запис у базу
 * (POST /transport/sticker-scans → лічильники в адмінці). Один раз за сесію браузера на наклейку —
 * перезавантаження й «назад» не рахуються; без sessionStorage повтори відсіює сервер.
 */
export function useStickerScan(search: string): void {
  useEffect(() => {
    const scan = parseStickerCampaign(search);
    if (!scan) return;
    const key = `${SEEN_PREFIX}${scan.stopId}-${scan.side}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* приватний режим — рахуємо, сервер відсіє повтори */
    }
    gaTrackEvent('transport_sticker_open', { stop: scan.stopId, side: scan.side });
    void apiClient.trackStickerScan(scan).catch(() => undefined);
  }, [search]);
}
