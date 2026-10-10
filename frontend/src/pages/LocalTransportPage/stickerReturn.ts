import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { visitorId } from '@/analytics/visitorId';
import { isPrerendering } from '@/utils/prerender';
import type { StickerReturnBody, StickerSide } from '@/types';

/**
 * Люди, що прийшли з QR-наклейки й користуються сайтом далі. При скані (stickerScan.ts) браузер
 * запамʼятовує наклейку, з якої людина прийшла вперше. Коли вона знову відкриває сайт після перерви
 * ≥ 30 хв (як сесія GA) — подія GA4 `transport_sticker_return` і POST /transport/sticker-returns
 * (таблиця StickerReturn) з анонімним id браузера. Так в адмінці видно, скільки людей зі стовпа
 * повертаються. Не sessionStorage: Chrome відновлює його разом із вкладками.
 *
 * via: reload — відновлена вкладка табло (адреса після скану має `utm_source=reload`),
 * tab — повернулись до вже відкритої вкладки, direct — відкрили сайт інакше.
 */

const ORIGIN_KEY = 'sticker-origin';
/** Перерва, після якої відкриття сайту — новий візит */
export const RETURN_GAP_MS = 30 * 60 * 1000;

type Origin = { stopId: string; side: StickerSide; firstAt: number; lastSeenAt: number };

function readOrigin(): Origin | null {
  try {
    const raw = localStorage.getItem(ORIGIN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Origin>;
    if (typeof o.stopId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(o.stopId)) return null;
    if (o.side !== 'a' && o.side !== 'b' && o.side !== 's') return null;
    return { stopId: o.stopId, side: o.side, firstAt: Number(o.firstAt) || 0, lastSeenAt: Number(o.lastSeenAt) || 0 };
  } catch {
    return null;
  }
}

function writeOrigin(o: Origin): void {
  try {
    localStorage.setItem(ORIGIN_KEY, JSON.stringify(o));
  } catch {
    /* без localStorage повернень не рахуємо */
  }
}

/** Скан наклейки: запамʼятати першу наклейку людини (наступні — лише оновлюють час візиту) */
export function rememberStickerOrigin(scan: { stopId: string; side: StickerSide }, now = Date.now()): void {
  const prev = readOrigin();
  writeOrigin(prev ? { ...prev, lastSeenAt: now } : { ...scan, firstAt: now, lastSeenAt: now });
}

/**
 * Людина з наклейки на сайті: якщо від попереднього візиту минуло ≥ 30 хв — це повернення
 * (повертає наклейку, з якої прийшла), інакше — той самий візит. Час візиту оновлюється завжди.
 */
export function noteStickerVisit(now = Date.now()): Origin | null {
  const o = readOrigin();
  if (!o) return null;
  writeOrigin({ ...o, lastSeenAt: now });
  return now - o.lastSeenAt >= RETURN_GAP_MS ? o : null;
}

/** Перший сегмент шляху: /transport/stop/st_1 → transport, / → home */
export function returnPage(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)[0] ?? '';
  return /^[a-z0-9-]{1,30}$/.test(seg) ? seg : seg ? 'other' : 'home';
}

function sendReturn(origin: Origin, via: StickerReturnBody['via'], pathname: string): void {
  const clientId = visitorId();
  if (!clientId) return;
  gaTrackEvent('transport_sticker_return', { stop: origin.stopId, side: origin.side, via });
  void apiClient
    .trackStickerReturn({ stopId: origin.stopId, side: origin.side, clientId, via, page: returnPage(pathname) })
    .catch(() => undefined);
}

/** У корені застосунку: повернення людини з наклейки — при відкритті сайту й при поверненні до вкладки */
export function useStickerReturn(): void {
  const { pathname, search } = useLocation();

  // Відкриття сайту (перше завантаження сторінки)
  useEffect(() => {
    if (isPrerendering() || pathname.startsWith('/admin')) return;
    const source = new URLSearchParams(search).get('utm_source');
    // новий скан рахує табло (stickerScan.ts), він же оновлює час візиту
    if (source === 'sticker') return;
    const origin = noteStickerVisit();
    if (origin) sendReturn(origin, source === 'reload' ? 'reload' : 'direct', pathname);
    // лише стартова адреса: далі — переходи всередині того самого візиту
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Повернення до відкритої вкладки після перерви
  useEffect(() => {
    if (isPrerendering()) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || window.location.pathname.startsWith('/admin')) return;
      const origin = noteStickerVisit();
      if (origin) sendReturn(origin, 'tab', window.location.pathname);
    };
    const onHidden = () => {
      // час виходу — точка відліку перерви
      if (document.visibilityState === 'hidden' && readOrigin()) noteStickerVisit();
    };
    document.addEventListener('visibilitychange', onHidden);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
