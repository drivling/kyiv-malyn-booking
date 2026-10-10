import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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

/** Адреса без utm-міток (решта параметрів і hash — як є) */
export function stripUtm(search: string): string {
  const p = new URLSearchParams(search);
  for (const k of [...p.keys()]) if (k.startsWith('utm_')) p.delete(k);
  const q = p.toString();
  return q ? `?${q}` : '';
}

/** Стан переходу, який GoogleAnalyticsTracker не рахує як новий page_view */
export const GA_SKIP_STATE = { gaSkip: true } as const;

/**
 * Відкриття табло з наклейки: подія GA4 `transport_sticker_open` і запис у базу
 * (POST /transport/sticker-scans → лічильники в адмінці). Один раз за сесію браузера на наклейку —
 * перезавантаження й «назад» не рахуються; без sessionStorage повтори відсіює сервер.
 *
 * Потім мітку знімаємо з адреси: інакше вкладка, яку браузер відновить завтра, знову прийде
 * з `utm_source=sticker` і порахується як новий скан. Знімаємо після першого page_view (GA уже
 * записав кампанію в сесію) і заміною адреси, яку GoogleAnalyticsTracker не рахує повторно.
 */
export function useStickerScan(search: string): void {
  const navigate = useNavigate();
  const location = useLocation();
  // останні navigate/адреса: табло могло вже уточнити URL, а ефект не має перезапускатись від них
  const latest = useRef({ navigate, location });
  latest.current = { navigate, location };
  useEffect(() => {
    const scan = parseStickerCampaign(search);
    if (!scan) return;
    const key = `${SEEN_PREFIX}${scan.stopId}-${scan.side}`;
    let seen = false;
    try {
      seen = Boolean(sessionStorage.getItem(key));
      if (!seen) sessionStorage.setItem(key, '1');
    } catch {
      /* приватний режим — рахуємо, сервер відсіє повтори */
    }
    if (!seen) {
      gaTrackEvent('transport_sticker_open', { stop: scan.stopId, side: scan.side });
      void apiClient.trackStickerScan(scan).catch(() => undefined);
    }
    // після ефектів батьків, тобто вже після page_view з міткою
    const strip = window.setTimeout(() => {
      const { pathname, search: now, hash } = latest.current.location;
      latest.current.navigate({ pathname, search: stripUtm(now), hash }, { replace: true, state: GA_SKIP_STATE });
    }, 0);
    return () => window.clearTimeout(strip);
  }, [search]);
}
